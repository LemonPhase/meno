import { beforeEach, describe, expect, it } from "vitest";
import { clearScriptedResponses, scriptModelResponse } from "@/ai/scripted";
import { POST as postAdvance } from "@/app/api/session/advance/route";
import { POST as postCheck } from "@/app/api/session/check/route";
import { POST as postAnswer } from "@/app/api/session/check/answer/route";
import { db } from "@/lib/firebase-admin";
import { graphRef } from "@/lib/store";
import {
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
  it("a failed answer takes the detour at once, in front of the Concept", async () => {
    await reachLearning();
    const state = await answerWith(
      {
        verdict: "fail",
        feedback: "You're missing what a vector even is.",
        adjustment: "insert_remedial",
        remedial: { label: "Vectors", summary: "Ordered lists of numbers." },
      },
      // The divert teaches the detour in the same request.
      ["Vectors exposition", JSON.stringify({ question: "What is a vector?" })],
    );

    // The learner is stuck on dot-product now, so the prerequisite is taught
    // now — at order 0, in front of the Concept it unblocks.
    expect(state.session.phase).toBe("learning");
    const remedial = byLabel(state, "Vectors");
    expect(remedial.origin).toBe("remedial");
    expect(remedial.status).toBe("active");
    expect(remedial.order).toBe(0);
    expect(byLabel(state, "Dot product").order).toBe(1);
    expect(byLabel(state, "Softmax").order).toBe(2);
    expect(byLabel(state, "Attention").order).toBe(3);

    // Interrupted, not finished: the Concept keeps its unlearned state, and
    // the gap is recorded as its own.
    const left = byLabel(state, "Dot product");
    expect(left.status).toBe("locked");
    expect(left.unlocked).toBe(false);
    expect(left.requires).toContain(remedial.id);

    // Its feedback is still on its own page, waiting for the way back.
    const lesson = state.lessons.find((l) => l.conceptId === left.id)!;
    expect(lesson.messages.some((m) => m.kind === "check-feedback")).toBe(true);
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

  it("Path order stays consistent through a remedial detour to Completion", async () => {
    await reachLearning();
    // Fail dot-product with a remedial inserted, which is taught at once…
    await answerWith(
      {
        verdict: "fail",
        feedback: "Gap found.",
        adjustment: "insert_remedial",
        remedial: { label: "Vectors", summary: "Ordered lists." },
      },
      ["E-vectors", JSON.stringify({ question: "Q-vectors?" })],
    );

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
