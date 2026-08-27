import { beforeEach, describe, expect, it } from "vitest";
import { clearScriptedResponses, scriptModelResponse } from "@/ai/scripted";
import { POST as postDiagnostic } from "@/app/api/session/diagnostic/route";
import { db } from "@/lib/firebase-admin";
import { graphRef } from "@/lib/store";
import type { Concept } from "@/lib/types";
import {
  jsonRequest,
  startInvestigatedSession,
  type StateBody,
} from "./helpers";

beforeEach(async () => {
  clearScriptedResponses();
  await db.recursiveDelete(graphRef());
});

function answersFor(state: StateBody) {
  return state.checks.map((c) => ({ checkId: c.id, answer: "my answer" }));
}

function byLabel(state: StateBody, label: string): Concept {
  const c = state.concepts.find((c) => c.label === label);
  if (!c) throw new Error(`no concept labeled ${label}`);
  return c;
}

describe("POST /api/session/diagnostic", () => {
  it("unlocks known Concepts as Skipped and linearizes the rest into the Path", async () => {
    const started = await startInvestigatedSession();
    const dotProduct = byLabel(started, "Dot product");

    // The grader judges the learner already knows the dot product.
    scriptModelResponse(
      JSON.stringify({ knownConceptIds: [dotProduct.id] }),
    );

    const res = await postDiagnostic(
      jsonRequest("/api/session/diagnostic", { answers: answersFor(started) }),
    );
    expect(res.status).toBe(200);
    const state: StateBody = await res.json();

    expect(state.session.phase).toBe("previewing");

    // Known → Unlocked + Skipped, never on the Path.
    const known = byLabel(state, "Dot product");
    expect(known.status).toBe("unlocked");
    expect(known.skipped).toBe(true);
    expect(known.order).toBeNull();

    // The rest get Path order respecting requires: softmax before attention.
    const softmax = byLabel(state, "Softmax");
    const attention = byLabel(state, "Attention");
    expect(softmax.status).toBe("locked");
    expect(attention.status).toBe("locked");
    expect(softmax.order).toBe(0);
    expect(attention.order).toBe(1);

    // Answers were recorded on the diagnostic Checks.
    for (const check of state.checks) {
      expect(check.answer).toBe("my answer");
    }
  });

  it("orders the whole Path topologically when nothing is known", async () => {
    const started = await startInvestigatedSession();
    scriptModelResponse(JSON.stringify({ knownConceptIds: [] }));

    const res = await postDiagnostic(
      jsonRequest("/api/session/diagnostic", { answers: answersFor(started) }),
    );
    const state: StateBody = await res.json();

    expect(byLabel(state, "Dot product").order).toBe(0);
    expect(byLabel(state, "Softmax").order).toBe(1);
    expect(byLabel(state, "Attention").order).toBe(2);
  });

  it("ignores hallucinated concept ids from the grader", async () => {
    const started = await startInvestigatedSession();
    scriptModelResponse(
      JSON.stringify({ knownConceptIds: ["made-up-id"] }),
    );

    const res = await postDiagnostic(
      jsonRequest("/api/session/diagnostic", { answers: answersFor(started) }),
    );
    const state: StateBody = await res.json();
    expect(state.concepts.every((c) => c.status === "locked")).toBe(true);
  });

  it("rejects submission when no Session is Diagnosing", async () => {
    const res = await postDiagnostic(
      jsonRequest("/api/session/diagnostic", { answers: [] }),
    );
    expect(res.status).toBe(409);
  });

  it("rejects malformed answers", async () => {
    await startInvestigatedSession();
    const res = await postDiagnostic(
      jsonRequest("/api/session/diagnostic", { answers: [{ nope: true }] }),
    );
    expect(res.status).toBe(400);
  });
});
