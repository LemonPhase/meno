import { beforeEach, describe, expect, it } from "vitest";
import { clearScriptedResponses, scriptModelResponse } from "@/ai/scripted";
import { POST as postBreakdown } from "@/app/api/session/breakdown/route";
import { POST as postCheck } from "@/app/api/session/check/route";
import { POST as postAnswer } from "@/app/api/session/check/answer/route";
import { POST as postLesson } from "@/app/api/session/lesson/route";
import { DELETE as deleteConcept } from "@/app/api/concepts/[id]/route";
import { db } from "@/lib/firebase-admin";
import { graphRef, humanizeLabel } from "@/lib/store";
import {
  FIRST_CHECK_QUESTION,
  USER,
  authed,
  jsonRequest,
  passAndMoveOn,
  reachLearning,
  type StateBody,
} from "./helpers";

// "Break it down": too hard means a prerequisite is missing, so the answer
// is an insert_remedial Adjustment (ADR-0001) — never a restructuring of
// the Concept itself. The remedial goes in *front* of the Concept it
// unblocks and is taught at once; the Concept the learner is pulled off
// keeps everything and is returned to after. Path after reachLearning():
// dot-product → softmax → attention, with dot-product Active.

/** The two calls a divert makes: the remedial's exposition and its Check. */
const teachesRemedial = (exposition: string, question: string) =>
  scriptModelResponse(exposition, JSON.stringify({ question }));

beforeEach(async () => {
  clearScriptedResponses();
  await db.recursiveDelete(graphRef(USER));
});

const byLabel = (s: StateBody, label: string) =>
  s.concepts.find((c) => c.label === label)!;

describe("POST /api/session/breakdown", () => {
  it("is refused once the Concept's Check is passed", async () => {
    const state = await reachLearning();
    await postCheck(authed("/api/session/check"));
    scriptModelResponse(JSON.stringify({ verdict: "pass", feedback: "Yes." }));
    await postAnswer(
      jsonRequest("/api/session/check/answer", { answer: "right" }),
    );

    // The control is gone from a client that has seen the pass, so this can
    // only come from one that has not. Nothing scripted: it must not reach
    // the model, let alone splice a prerequisite in front of a Concept the
    // learner has just demonstrated.
    const res = await postBreakdown(authed("/api/session/breakdown"));
    expect(res.status).toBe(409);
    const after: StateBody = await (await postCheck(authed("/api/session/check"))).json();
    expect(after.concepts).toHaveLength(state.concepts.length);
  });

  it("splices the remedial in front of the Concept and teaches it at once", async () => {
    const state = await reachLearning();
    const active = byLabel(state, "Dot product");

    scriptModelResponse(
      JSON.stringify({
        action: "insert_remedial",
        message: "Vectors themselves are the gap — a short detour first.",
        remedial: { label: "Vectors", summary: "Ordered lists of numbers." },
      }),
    );
    teachesRemedial("Vectors exposition", "What is a vector?");
    const after: StateBody = await (await postBreakdown(authed("/api/session/breakdown"))).json();

    const remedial = byLabel(after, "Vectors");
    expect(remedial.origin).toBe("remedial");
    // In front of the Concept it unblocks — a prerequisite taught after the
    // thing it holds up is no prerequisite at all.
    expect(after.session.path.map((e) => e.conceptId)).toEqual([
      remedial.id,
      active.id,
      byLabel(after, "Softmax").id,
      byLabel(after, "Attention").id,
    ]);
    expect(byLabel(after, "Dot product").requires).toContain(remedial.id);

    // And taught now: the detour is Active, with its own Lesson open — and
    // that Lesson opens by saying where the learner has been taken from and
    // why, since they land on it without having chosen it.
    expect(after.session.activeConceptId).toBe(remedial.id);
    expect(remedial.status).toBe("active");
    const detour = after.lessons.find((l) => l.conceptId === remedial.id)!;
    expect(detour.messages.map((m) => m.kind)).toEqual([
      "event",
      "reply",
      "exposition",
    ]);
    expect(detour.messages[0].text).toContain("Dot product");
    expect(detour.messages[1].text).toBe(
      "Vectors themselves are the gap — a short detour first.",
    );
    expect(detour.messages[2].text).toBe("Vectors exposition");

    // The Concept left behind is interrupted, not finished: still unlearned,
    // and its transcript ends with why the learner left it.
    const left = byLabel(after, "Dot product");
    expect(left.status).toBe("locked");
    expect(left.unlocked).toBe(false);
    const lesson = after.lessons.find((l) => l.conceptId === active.id)!;
    expect(lesson.messages.map((m) => m.kind)).toEqual([
      "exposition",
      "user",
      "event",
    ]);
    expect(lesson.messages.at(-1)!.text).toContain("Vectors");
  });

  it("comes back to the interrupted Concept with its Lesson and question intact", async () => {
    const state = await reachLearning();
    const active = byLabel(state, "Dot product");
    // Something of the learner's own on the page before the detour, so a
    // clobbered Lesson would be unmistakable rather than merely shorter.
    scriptModelResponse("Because it projects.");
    await postLesson(
      jsonRequest("/api/session/lesson", { message: "Why a dot product?" }),
    );

    scriptModelResponse(
      JSON.stringify({
        action: "insert_remedial",
        message: "Vectors first.",
        remedial: { label: "Vectors", summary: "Ordered lists of numbers." },
      }),
    );
    teachesRemedial("Vectors exposition", "What is a vector?");
    await postBreakdown(authed("/api/session/breakdown"));

    // Pass the detour and leave it: the way back is the Concept it unblocked,
    // and returning to it generates nothing at all — no exposition to script.
    const after = await passAndMoveOn({ resume: true });

    expect(after.session.activeConceptId).toBe(active.id);
    expect(byLabel(after, "Vectors").status).toBe("unlocked");

    const lesson = after.lessons.find((l) => l.conceptId === active.id)!;
    expect(lesson.messages[0].text).toBe("Exposition 1");
    expect(lesson.messages.some((m) => m.text === "Why a dot product?")).toBe(
      true,
    );
    expect(lesson.messages.some((m) => m.text === "Because it projects.")).toBe(
      true,
    );
    // One exposition, not two: a Concept is taught once.
    expect(lesson.messages.filter((m) => m.kind === "exposition")).toHaveLength(
      1,
    );

    // And it is still asked what it was always going to ask (CONTEXT.md,
    // Check): the question is written with the exposition and never rewritten.
    const questions = after.checks
      .filter((c) => c.phase === "mastery" && c.conceptIds.includes(active.id))
      .map((c) => c.question);
    expect(new Set(questions)).toEqual(new Set([FIRST_CHECK_QUESTION]));
  });

  it("stacks a second detour in front of the first, and unwinds in order", async () => {
    const start = await reachLearning();
    const outer = byLabel(start, "Dot product");

    for (const [label, summary] of [
      ["Vectors", "Ordered lists of numbers."],
      ["Numbers in a row", "What a list of numbers even is."],
    ]) {
      scriptModelResponse(
        JSON.stringify({
          action: "insert_remedial",
          message: `${label} first.`,
          remedial: { label, summary },
        }),
      );
      teachesRemedial(`${label} exposition`, `${label} check?`);
      const res = await postBreakdown(authed("/api/session/breakdown"));
      expect(res.status).toBe(200);
    }

    const deep: StateBody = await (await postCheck(authed("/api/session/check"))).json();
    // Each gap seats itself in front of the thing it holds up, so the Path
    // reads bottom-up: the deepest prerequisite first.
    expect(
      deep.session.path.map(
        (e) => deep.concepts.find((c) => c.id === e.conceptId)!.label,
      ),
    ).toEqual([
      "Numbers in a row",
      "Vectors",
      "Dot product",
      "Softmax",
      "Attention",
    ]);
    expect(deep.session.activeConceptId).toBe(byLabel(deep, "Numbers in a row").id);

    // And unwinds the way it wound: the inner detour, then the outer, then
    // the Concept they were on all along — none of them re-taught.
    let state = await passAndMoveOn({ resume: true });
    expect(state.session.activeConceptId).toBe(byLabel(state, "Vectors").id);
    state = await passAndMoveOn({ resume: true });
    expect(state.session.activeConceptId).toBe(outer.id);
    expect(
      state.lessons.find((l) => l.conceptId === outer.id)!.messages.filter(
        (m) => m.kind === "exposition",
      ),
    ).toHaveLength(1);
  });

  it("cannot delete the Concept a detour interrupted", async () => {
    const start = await reachLearning();
    const stuck = byLabel(start, "Dot product");

    scriptModelResponse(
      JSON.stringify({
        action: "insert_remedial",
        message: "Vectors first.",
        remedial: { label: "Vectors", summary: "Ordered lists." },
      }),
    );
    teachesRemedial("Vectors exposition", "Vectors check?");
    await postBreakdown(authed("/api/session/breakdown"));

    // It is Locked and not Active, so the old "is it Active?" guard let it
    // through — and deleting it takes the Lesson the learner is coming back
    // to with it.
    const res = await deleteConcept(authed(`/api/concepts/${stuck.id}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: stuck.id }),
    });
    expect(res.status).toBe(409);

    const after: StateBody = await (await postCheck(authed("/api/session/check"))).json();
    expect(after.concepts.some((c) => c.id === stuck.id)).toBe(true);
    expect(
      after.lessons.find((l) => l.conceptId === stuck.id)!.messages.length,
    ).toBeGreaterThan(0);
  });

  it("asks a question instead when the lesson gives nothing to go on", async () => {
    const state = await reachLearning();
    const before = state.session.path.length;

    scriptModelResponse(
      JSON.stringify({
        action: "ask",
        message: "Which part loses you — the vectors, or what the number means?",
      }),
    );
    const after: StateBody = await (await postBreakdown(authed("/api/session/breakdown"))).json();

    expect(after.session.path).toHaveLength(before);
    const lesson = after.lessons.find(
      (l) => l.conceptId === after.session.activeConceptId,
    )!;
    expect(lesson.messages.at(-1)!.kind).toBe("reply");
    expect(lesson.messages.at(-1)!.text).toContain("Which part");
  });

  it("refuses a Session that is not Learning", async () => {
    const res = await postBreakdown(authed("/api/session/breakdown"));
    expect(res.status).toBe(409);
  });
});

describe("humanizeLabel", () => {
  it("turns an identifier the model returned into a readable name", () => {
    expect(humanizeLabel("mutually_exclusive_events")).toBe(
      "Mutually exclusive events",
    );
    expect(humanizeLabel("vector_norms")).toBe("Vector norms");
  });

  it("leaves a name a person would write alone", () => {
    expect(humanizeLabel("Mutually exclusive events")).toBe(
      "Mutually exclusive events",
    );
    expect(humanizeLabel("Query, key, value")).toBe("Query, key, value");
  });

  // Hyphens carry meaning in real names, so they are never stripped.
  it("keeps a hyphenated name hyphenated", () => {
    expect(humanizeLabel("t-test")).toBe("t-test");
    expect(humanizeLabel("chi-squared")).toBe("chi-squared");
    expect(humanizeLabel("non-linear")).toBe("non-linear");
    expect(humanizeLabel("p-values")).toBe("p-values");
  });
});
