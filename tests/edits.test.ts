import { beforeEach, describe, expect, it } from "vitest";
import {
  clearScriptedResponses,
  promptText,
  scriptModelResponse,
} from "@/ai/scripted";
import { PATCH, DELETE } from "@/app/api/concepts/[id]/route";
import { POST as postCheck } from "@/app/api/session/check/route";
import { POST as postAnswer } from "@/app/api/session/check/answer/route";
import { db } from "@/lib/firebase-admin";
import { graphRef } from "@/lib/store";
import type { Edit } from "@/lib/types";
import {
  EXTRACTION,
  RESEARCH_NOTES,
  diagnosticQuestionsResponder,
  jsonRequest,
  reachLearning,
  startInvestigatedSession,
  type StateBody,
} from "./helpers";
import { POST as postSession } from "@/app/api/session/route";

// Edits (#7, ADR-0003): rename/delete on any status, never blocked, never
// cascaded, recorded append-only, and fed to later agent calls as context.

beforeEach(async () => {
  clearScriptedResponses();
  await db.recursiveDelete(graphRef());
});

const byLabel = (s: StateBody, label: string) =>
  s.concepts.find((c) => c.label === label)!;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function storedEdits(): Promise<Edit[]> {
  const snap = await graphRef().collection("edits").get();
  return snap.docs
    .map((d) => d.data() as Edit)
    .sort((a, b) => a.createdAt - b.createdAt);
}

describe("PATCH /api/concepts/[id] (rename)", () => {
  it("renames a Locked Concept and records the Edit", async () => {
    const started = await startInvestigatedSession();
    const softmax = byLabel(started, "Softmax");

    const res = await PATCH(
      jsonRequest(`/api/concepts/${softmax.id}`, { label: "Squash-o-matic" }),
      ctx(softmax.id),
    );
    expect(res.status).toBe(200);
    const state: StateBody = await res.json();
    expect(state.concepts.find((c) => c.id === softmax.id)!.label).toBe(
      "Squash-o-matic",
    );

    const edits = await storedEdits();
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({
      conceptId: softmax.id,
      kind: "rename",
      before: "Softmax",
      after: "Squash-o-matic",
    });
  });

  it("renames an Unlocked Concept too — any status is editable", async () => {
    const state = await reachLearning();
    const active = byLabel(state, "Dot product");
    const res = await PATCH(
      jsonRequest(`/api/concepts/${active.id}`, { label: "Scalar product" }),
      ctx(active.id),
    );
    expect(res.status).toBe(200);
  });

  it("404s on an unknown Concept and 400s on a blank label", async () => {
    const started = await startInvestigatedSession();
    expect(
      (
        await PATCH(jsonRequest("/api/concepts/nope", { label: "X" }), ctx("nope"))
      ).status,
    ).toBe(404);

    const softmax = byLabel(started, "Softmax");
    expect(
      (
        await PATCH(
          jsonRequest(`/api/concepts/${softmax.id}`, { label: "   " }),
          ctx(softmax.id),
        )
      ).status,
    ).toBe(400);

    // Neither failed attempt is recorded as an Edit.
    expect(await storedEdits()).toHaveLength(0);
  });
});

describe("DELETE /api/concepts/[id]", () => {
  it("prunes a Locked Concept from the Path and cleans dependents' requires", async () => {
    // After reachLearning: dot-product Active (order 0), softmax order 1,
    // attention order 2 (requires softmax). Deleting softmax: attention
    // shifts to order 1 and loses the edge; no cascade, no block.
    const state = await reachLearning();
    const softmax = byLabel(state, "Softmax");
    const res = await DELETE(
      new Request(`http://test/api/concepts/${softmax.id}`, {
        method: "DELETE",
      }),
      ctx(softmax.id),
    );
    expect(res.status).toBe(200);
    const after: StateBody = await res.json();

    expect(after.concepts.map((c) => c.label).sort()).toEqual([
      "Attention",
      "Dot product",
    ]);
    const attention = byLabel(after, "Attention");
    expect(attention.requires).not.toContain(softmax.id);
    expect(attention.order).toBe(1);

    const edits = await storedEdits();
    expect(edits[0]).toMatchObject({
      kind: "delete",
      before: "Softmax",
      after: null,
    });
  });

  it("deleting the Active Concept hands off to the next Locked one", async () => {
    const state = await reachLearning();
    const active = byLabel(state, "Dot product");

    scriptModelResponse("Softmax exposition");
    const res = await DELETE(
      new Request(`http://test/api/concepts/${active.id}`, {
        method: "DELETE",
      }),
      ctx(active.id),
    );
    const after: StateBody = await res.json();

    expect(after.concepts.find((c) => c.id === active.id)).toBeUndefined();
    const next = byLabel(after, "Softmax");
    expect(next.status).toBe("active");
    expect(after.session.activeConceptId).toBe(next.id);
    // The deleted Concept's Lesson went with it.
    expect(after.lessons.find((l) => l.conceptId === active.id)).toBeUndefined();
  });

  it("deleting the last remaining Concepts completes the Session", async () => {
    const state = await reachLearning();
    // Delete softmax and attention (locked), then the active dot-product:
    // nothing remains, so the Session completes with a Recap.
    for (const label of ["Softmax", "Attention"]) {
      const c = byLabel(state, label);
      await DELETE(
        new Request(`http://test/api/concepts/${c.id}`, { method: "DELETE" }),
        ctx(c.id),
      );
    }
    const active = byLabel(state, "Dot product");
    scriptModelResponse("An empty but honest recap.");
    const res = await DELETE(
      new Request(`http://test/api/concepts/${active.id}`, {
        method: "DELETE",
      }),
      ctx(active.id),
    );
    const after: StateBody = await res.json();
    expect(after.session.phase).toBe("complete");
    expect(after.session.recap).toBe("An empty but honest recap.");
  });
});

describe("Edits reach later agent calls as context", () => {
  it("the grading call sees recent Edits", async () => {
    const state = await reachLearning();
    const softmax = byLabel(state, "Softmax");
    await PATCH(
      jsonRequest(`/api/concepts/${softmax.id}`, { label: "Squasher" }),
      ctx(softmax.id),
    );

    scriptModelResponse(JSON.stringify({ question: "Q?" }));
    await postCheck();

    let gradingPrompt = "";
    scriptModelResponse((req) => {
      gradingPrompt = promptText(req);
      return JSON.stringify({ verdict: "fail", feedback: "No." });
    });
    await postAnswer(
      jsonRequest("/api/session/check/answer", { answer: "hm" }),
    );

    expect(gradingPrompt).toContain('renamed "Softmax" to "Squasher"');
  });

  it("a new Session's investigation sees Edits from the previous one", async () => {
    const state = await reachLearning();
    const attention = byLabel(state, "Attention");
    await DELETE(
      new Request(`http://test/api/concepts/${attention.id}`, {
        method: "DELETE",
      }),
      ctx(attention.id),
    );

    let extractionPrompt = "";
    scriptModelResponse(
      RESEARCH_NOTES,
      (req) => {
        extractionPrompt = promptText(req);
        return EXTRACTION;
      },
      diagnosticQuestionsResponder,
    );
    await postSession(jsonRequest("/api/session", { topic: "round two" }));

    expect(extractionPrompt).toContain('deleted "Attention"');
  });
});
