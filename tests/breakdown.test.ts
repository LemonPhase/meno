import { beforeEach, describe, expect, it } from "vitest";
import { clearScriptedResponses, scriptModelResponse } from "@/ai/scripted";
import { POST as postBreakdown } from "@/app/api/session/breakdown/route";
import { db } from "@/lib/firebase-admin";
import { graphRef } from "@/lib/store";
import { reachLearning, type StateBody } from "./helpers";

// "Break it down": too hard means a prerequisite is missing, so the answer
// is an insert_remedial Adjustment (ADR-0001) — never a restructuring of
// the Concept itself. Path after reachLearning(): dot-product → softmax →
// attention, with dot-product Active.

beforeEach(async () => {
  clearScriptedResponses();
  await db.recursiveDelete(graphRef());
});

const byLabel = (s: StateBody, label: string) =>
  s.concepts.find((c) => c.label === label)!;

describe("POST /api/session/breakdown", () => {
  it("splices a remedial in after the Active Concept and leaves it Active", async () => {
    const state = await reachLearning();
    const active = byLabel(state, "Dot product");

    scriptModelResponse(
      JSON.stringify({
        action: "insert_remedial",
        message: "Vectors themselves are the gap — a short detour first.",
        remedial: { label: "Vectors", summary: "Ordered lists of numbers." },
      }),
    );
    const after: StateBody = await (await postBreakdown()).json();

    const remedial = byLabel(after, "Vectors");
    expect(remedial.origin).toBe("remedial");
    expect(after.session.path.map((e) => e.conceptId)).toEqual([
      active.id,
      remedial.id,
      byLabel(after, "Softmax").id,
      byLabel(after, "Attention").id,
    ]);

    // The Concept itself is untouched, and still being learned.
    expect(after.session.activeConceptId).toBe(active.id);
    expect(byLabel(after, "Dot product").status).toBe("active");
    expect(byLabel(after, "Softmax").requires).toContain(remedial.id);

    // The transcript says what happened.
    const lesson = after.lessons.find((l) => l.conceptId === active.id)!;
    const kinds = lesson.messages.map((m) => m.kind);
    expect(kinds).toContain("event");
    expect(lesson.messages.at(-1)!.text).toContain("Vectors");
    expect(lesson.messages.some((m) => m.kind === "reply")).toBe(true);
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
    const after: StateBody = await (await postBreakdown()).json();

    expect(after.session.path).toHaveLength(before);
    const lesson = after.lessons.find(
      (l) => l.conceptId === after.session.activeConceptId,
    )!;
    expect(lesson.messages.at(-1)!.kind).toBe("reply");
    expect(lesson.messages.at(-1)!.text).toContain("Which part");
  });

  it("refuses a Session that is not Learning", async () => {
    const res = await postBreakdown();
    expect(res.status).toBe(409);
  });
});
