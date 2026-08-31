import { beforeEach, describe, expect, it } from "vitest";
import { clearScriptedResponses, scriptModelResponse } from "@/ai/scripted";
import { POST as postAdvance } from "@/app/api/session/advance/route";
import { POST as postBreakdown } from "@/app/api/session/breakdown/route";
import { POST as postCheck } from "@/app/api/session/check/route";
import { POST as postAnswer } from "@/app/api/session/check/answer/route";
import { db } from "@/lib/firebase-admin";
import { graphRef } from "@/lib/store";
import {
  FIRST_CHECK_QUESTION,
  USER,
  authed,
  jsonRequest,
  passAndMoveOn,
  reachLearning,
  type StateBody,
} from "./helpers";

// ADR-0001: Adjustments are bounded to insert_remedial and skip_next,
// riding on the grading call. Path starts as: dot-product → softmax →
// attention, with dot-product Active after reachLearning().

beforeEach(async () => {
  clearScriptedResponses();
  await db.recursiveDelete(graphRef(USER));
});

const byLabel = (s: StateBody, label: string) =>
  s.concepts.find((c) => c.label === label)!;

async function answerWith(
  grade: { verdict: "pass" | "fail" } & Record<string, unknown>,
  /** What a divert generates after grading, when this answer causes one. */
  after: string[] = [],
): Promise<StateBody> {
  // Whatever Check is Active already has one primed — from reachLearning()
  // or the previous turn — so revealing it costs no model call.
  await postCheck(authed("/api/session/check"));
  scriptModelResponse(JSON.stringify(grade), ...after);
  const res = await postAnswer(
    jsonRequest("/api/session/check/answer", { answer: "my attempt" }),
  );
  return res.json();
}

describe("Adjustment: insert_remedial", () => {
  it("a failing answer changes nothing: the detour is suggested, not taken", async () => {
    // Leaving a Concept is the learner's act everywhere else in Meno, and a
    // detour is the one place the agent could take that from them — swapping
    // the page out from under an answer they had just pressed, on its own
    // reading of one wrong answer. So grading says what looks missing and
    // names the control; the control is the learner's to press.
    const start = await reachLearning();
    const before = start.session.path.map((e) => e.conceptId);

    const state = await answerWith({
      verdict: "fail",
      feedback:
        "This is really about vectors — press Break it down and we will do those first.",
      adjustment: "insert_remedial",
      remedial: { label: "Vectors", summary: "Ordered lists of numbers." },
    });

    expect(state.concepts.some((c) => c.label === "Vectors")).toBe(false);
    expect(state.session.path.map((e) => e.conceptId)).toEqual(before);
    expect(state.session.activeConceptId).toBe(
      byLabel(state, "Dot product").id,
    );
    expect(byLabel(state, "Dot product").status).toBe("active");

    // The suggestion itself lands, where the learner is reading.
    const lesson = state.lessons.find(
      (l) => l.conceptId === state.session.activeConceptId,
    )!;
    expect(lesson.messages.at(-1)!.kind).toBe("check-feedback");
    expect(lesson.messages.at(-1)!.text).toContain("Break it down");
  });

  it("a passing answer stays put — nothing is blocking the learner", async () => {
    await reachLearning();
    // A gap the answer revealed, on an answer that passed: the learner is
    // through this Concept and stays on it, as a pass always leaves them.
    // Nothing is generated here, so nothing beyond the grade is scripted.
    const graded = await answerWith({
      verdict: "pass",
      feedback: "Right, though shakily.",
      adjustment: "insert_remedial",
      remedial: { label: "Vectors", summary: "Ordered lists of numbers." },
    });
    expect(graded.session.activeConceptId).toBe(
      byLabel(graded, "Dot product").id,
    );
    expect(byLabel(graded, "Vectors").status).toBe("locked");
    // Behind the Concept it came out of, not in front of it: seating it
    // ahead of the Concept the learner is standing on would shuffle the
    // Path — and their folio — backwards underneath them.
    expect(byLabel(graded, "Dot product").order).toBe(0);
    expect(byLabel(graded, "Vectors").order).toBe(1);
    expect(byLabel(graded, "Softmax").order).toBe(2);

    // And it is what they get when they choose to move on.
    scriptModelResponse(
      "Remedial exposition",
      JSON.stringify({ question: "Vectors check?" }),
    );
    const state: StateBody = await (
      await postAdvance(authed("/api/session/advance"))
    ).json();

    expect(byLabel(state, "Dot product").status).toBe("unlocked");
    const remedial = byLabel(state, "Vectors");
    expect(remedial.status).toBe("active");
    expect(state.session.activeConceptId).toBe(remedial.id);
    expect(
      state.lessons.find((l) => l.conceptId === remedial.id)!.messages[0].text,
    ).toBe("Remedial exposition");
  });

  it("leaves an interrupted Concept one question, primed for the way back", async () => {
    // A failed attempt re-primes this Concept's question; a detour then
    // takes the learner off it. A Concept has exactly one mastery question
    // and keeps it (CONTEXT.md, Check) — two waiting to be asked, or two
    // different ones, would both be corruption no screen would ever show.
    const start = await reachLearning();
    const stuck = byLabel(start, "Dot product");
    await answerWith({ verdict: "fail", feedback: "Not yet — try vectors." });

    scriptModelResponse(
      JSON.stringify({
        action: "insert_remedial",
        message: "Vectors first.",
        remedial: { label: "Vectors", summary: "Ordered lists." },
      }),
      "E-vectors",
      JSON.stringify({ question: "Q-vectors?" }),
    );
    await postBreakdown(authed("/api/session/breakdown"));
    const state = await passAndMoveOn({ resume: true });

    expect(state.session.activeConceptId).toBe(stuck.id);
    const mastery = state.checks.filter(
      (c) => c.phase === "mastery" && c.conceptIds.includes(stuck.id),
    );
    expect(new Set(mastery.map((c) => c.question))).toEqual(
      new Set([FIRST_CHECK_QUESTION]),
    );
    expect(mastery.filter((c) => c.verdict === null)).toHaveLength(1);
  });

  it("ignores insert_remedial when the model omits the remedial payload", async () => {
    await reachLearning();
    const state = await answerWith({
      verdict: "fail",
      feedback: "No.",
      adjustment: "insert_remedial",
      // no remedial object
    });
    expect(state.concepts).toHaveLength(3);
  });
});

describe("Adjustment: skip_next", () => {
  it("marks the next Concept Unlocked + Skipped on a pass, and moving on passes it by", async () => {
    // The safety net it is meant to be: this answer passed *and* covered
    // the next Concept, so teaching that one would waste the learner's time.
    await reachLearning();
    const state = await passAndMoveOn(
      { exposition: "Attention exposition", question: "Attention check?" },
      {
        grade: {
          feedback: "You clearly know softmax too.",
          adjustment: "skip_next",
        },
      },
    );

    expect(byLabel(state, "Dot product").status).toBe("unlocked");
    expect(byLabel(state, "Dot product").skipped).toBe(false);

    const softmax = byLabel(state, "Softmax");
    expect(softmax.status).toBe("unlocked");
    expect(softmax.skipped).toBe(true);

    const attention = byLabel(state, "Attention");
    expect(attention.status).toBe("active");
    expect(state.session.activeConceptId).toBe(attention.id);
  });

  it("ignores skip_next on a fail, however often it is offered", async () => {
    await reachLearning();

    // The Path is a prerequisite claim: knowing Softmax while failing Dot
    // product says the Path was built wrong, not that Softmax may be handed
    // over. Attempts re-ask the same question and are uncapped, so a model
    // that keeps offering the skip must not get it — three fails would
    // otherwise unlock three untaught Concepts, Graph-wide and for good.
    let state: StateBody | null = null;
    for (let i = 0; i < 3; i++) {
      state = await answerWith({
        verdict: "fail",
        feedback: "Current concept shaky, but you clearly know softmax.",
        adjustment: "skip_next",
      });
    }

    expect(byLabel(state!, "Dot product").status).toBe("active");
    expect(byLabel(state!, "Softmax").status).toBe("locked");
    expect(byLabel(state!, "Softmax").skipped).toBe(false);
    expect(byLabel(state!, "Attention").status).toBe("locked");
    expect(state!.session.phase).toBe("learning");
  });

  it("never skips the Concept a detour pulled the learner off", async () => {
    // The Path is a prerequisite claim, and mid-detour the "next" Concept is
    // the one the learner just failed — with their failure on its own page.
    // A skip there would Unlock it Graph-wide and for good, on the strength
    // of an answer about something else entirely.
    const start = await reachLearning();
    const stuck = byLabel(start, "Dot product");
    scriptModelResponse(
      JSON.stringify({
        action: "insert_remedial",
        message: "Vectors first.",
        remedial: { label: "Vectors", summary: "Ordered lists." },
      }),
      "E-vectors",
      JSON.stringify({ question: "Q-vectors?" }),
    );
    await postBreakdown(authed("/api/session/breakdown"));

    const state = await answerWith({
      verdict: "pass",
      feedback: "And you clearly have dot products too.",
      adjustment: "skip_next",
    });

    const after = byLabel(state, "Dot product");
    expect(after.id).toBe(stuck.id);
    expect(after.unlocked).toBe(false);
    expect(after.skipped).toBe(false);
    expect(after.status).toBe("locked");
  });

  it("Path order stays consistent through a remedial detour to Completion", async () => {
    await reachLearning();
    // Ask for a detour off dot-product, which is taught at once…
    scriptModelResponse(
      JSON.stringify({
        action: "insert_remedial",
        message: "Vectors first.",
        remedial: { label: "Vectors", summary: "Ordered lists." },
      }),
      "E-vectors",
      JSON.stringify({ question: "Q-vectors?" }),
    );
    await postBreakdown(authed("/api/session/breakdown"));

    // …then pass everything in the adjusted order:
    // Vectors → dot-product (returned to, so nothing is generated) →
    // Softmax → Attention.
    let state: StateBody | null = null;
    for (const next of [
      { resume: true } as const,
      { exposition: "E-softmax", question: "Q-softmax?" },
      { exposition: "E-attention", question: "Q-attention?" },
    ]) {
      state = await passAndMoveOn(next);
    }
    // Attention is the last Concept on the Path: leaving it completes the
    // Session with a Recap instead of priming another Check.
    state = await passAndMoveOn({ recap: "Recap!" });

    expect(state!.session.phase).toBe("complete");
    expect(state!.session.recap).toBe("Recap!");
    expect(state!.concepts.every((c) => c.status === "unlocked")).toBe(true);
    expect(state!.concepts).toHaveLength(4);
  });
});
