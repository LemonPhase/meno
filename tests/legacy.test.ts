import { beforeEach, describe, expect, it } from "vitest";
import { clearScriptedResponses, scriptModelResponse } from "@/ai/scripted";
import { GET } from "@/app/api/session/route";
import { GET as getSessions } from "@/app/api/sessions/route";
import { POST as postLesson } from "@/app/api/session/lesson/route";
import { POST as postCheck } from "@/app/api/session/check/route";
import { POST as postAnswer } from "@/app/api/session/check/answer/route";
import { POST as postAdvance } from "@/app/api/session/advance/route";
import { db } from "@/lib/firebase-admin";
import { graphRef } from "@/lib/store";
import type { SessionSummary } from "@/lib/types";
import { jsonRequest, type StateBody } from "./helpers";

// A Graph written before ADR-0004 kept Path state on the Concept and keyed
// Lessons by Concept alone. The new code has to read it as it stands —
// production data outlives a schema change, and a deploy must not need a
// migration to have run first. scripts/migrate-adr-0004.mjs rewrites it.

beforeEach(async () => {
  clearScriptedResponses();
  await db.recursiveDelete(graphRef());
});

const SESSION = "legacy-session-1";

/** Seed the exact document shape the pre-ADR-0004 code wrote. */
async function seedLegacyGraph() {
  const now = Date.now();
  const concept = (
    key: string,
    label: string,
    status: string,
    order: number | null,
    extra: Record<string, unknown> = {},
  ) => ({
    id: key,
    label,
    summary: `About ${label}.`,
    status,
    skipped: false,
    origin: "planned",
    requires: [],
    sessionId: SESSION,
    order,
    extractionIndex: order ?? 0,
    createdAt: now,
    ...extra,
  });

  await graphRef().collection("sessions").doc(SESSION).set({
    id: SESSION,
    topic: "Legacy topic",
    phase: "learning",
    activeConceptId: "c_active",
    recap: null,
    createdAt: now,
  });
  await graphRef()
    .collection("concepts")
    .doc("c_known")
    .set(concept("c_known", "Known already", "unlocked", null, { skipped: true }));
  await graphRef()
    .collection("concepts")
    .doc("c_active")
    .set(concept("c_active", "Being learned", "active", 0));
  await graphRef()
    .collection("concepts")
    .doc("c_next")
    .set(concept("c_next", "Still to come", "locked", 1));
  // Keyed by Concept alone, as the old code wrote it.
  await graphRef().collection("lessons").doc("c_active").set({
    conceptId: "c_active",
    sessionId: SESSION,
    messages: [{ kind: "exposition", text: "Legacy exposition.", createdAt: now }],
  });
}

describe("a Graph written before ADR-0004", () => {
  it("reads as a Session with a Path reconstructed from the old orders", async () => {
    await seedLegacyGraph();

    const body: StateBody = await (await GET()).json();
    expect(body.session.id).toBe(SESSION);
    expect(body.session.path.map((e) => e.conceptId)).toEqual([
      "c_active",
      "c_next",
    ]);
    expect(body.session.conceptIds.sort()).toEqual([
      "c_active",
      "c_known",
      "c_next",
    ]);

    const byId = new Map(body.concepts.map((c) => [c.id, c]));
    expect(byId.get("c_active")!.status).toBe("active");
    expect(byId.get("c_next")!.status).toBe("locked");
    // Unlocked off the Path is "already yours", exactly as it was.
    expect(byId.get("c_known")!.status).toBe("unlocked");
    expect(byId.get("c_known")!.order).toBeNull();
    expect(byId.get("c_known")!.skipped).toBe(true);
  });

  it("lists its progress in the sidebar", async () => {
    await seedLegacyGraph();

    const { sessions }: { sessions: SessionSummary[] } = await (
      await getSessions()
    ).json();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].pathLength).toBe(2);
    expect(sessions[0].pathDone).toBe(0);
    expect(sessions[0].unlockedCount).toBe(1);
  });

  it("carries a legacy Session through the whole Learning flow", async () => {
    await seedLegacyGraph();

    // Its Concepts predate primed Checks, so the first "Test me" is the
    // fallback that writes one. From there the new flow has to hold: the
    // pass offers the move, the move Unlocks and activates, and the last
    // one closes with a Recap.
    scriptModelResponse(JSON.stringify({ question: "Legacy check?" }));
    expect((await postCheck()).status).toBe(200);

    scriptModelResponse(JSON.stringify({ verdict: "pass", feedback: "Yes." }));
    const graded: StateBody = await (
      await postAnswer(
        jsonRequest("/api/session/check/answer", { answer: "right" }),
      )
    ).json();
    // A pass moves nobody, legacy Graph or not.
    expect(graded.session.activeConceptId).toBe("c_active");

    scriptModelResponse("Next exposition", JSON.stringify({ question: "Q?" }));
    const moved: StateBody = await (await postAdvance()).json();
    expect(moved.session.activeConceptId).toBe("c_next");
    expect(moved.concepts.find((c) => c.id === "c_active")!.status).toBe(
      "unlocked",
    );

    await postCheck();
    scriptModelResponse(JSON.stringify({ verdict: "pass", feedback: "Yes." }));
    await postAnswer(
      jsonRequest("/api/session/check/answer", { answer: "right" }),
    );
    scriptModelResponse("A legacy recap.");
    const done: StateBody = await (await postAdvance()).json();
    expect(done.session.phase).toBe("complete");
    expect(done.session.recap).toBe("A legacy recap.");
    expect(done.concepts.every((c) => c.status === "unlocked")).toBe(true);
  });

  it("appends to a Lesson that is still keyed by Concept alone", async () => {
    await seedLegacyGraph();

    scriptModelResponse("A reply onto the legacy lesson.");
    const res = await postLesson(
      jsonRequest("/api/session/lesson", { message: "why?" }),
    );
    expect(res.status).toBe(200);

    const body: StateBody = await res.json();
    const lesson = body.lessons.find((l) => l.conceptId === "c_active")!;
    expect(lesson.messages.map((m) => m.kind)).toEqual([
      "exposition",
      "user",
      "reply",
    ]);
  });
});
