import { beforeEach, describe, expect, it } from "vitest";
import { clearScriptedResponses, scriptModelResponse } from "@/ai/scripted";
import { GET } from "@/app/api/session/route";
import { GET as getSessions } from "@/app/api/sessions/route";
import { GET as getSession } from "@/app/api/sessions/[id]/route";
import { POST as postDiagnostic } from "@/app/api/session/diagnostic/route";
import { POST as postAdvance } from "@/app/api/session/advance/route";
import { POST as postLesson } from "@/app/api/session/lesson/route";
import { POST as postCheck } from "@/app/api/session/check/route";
import {
  DELETE as deleteConcept,
  PATCH as patchConcept,
} from "@/app/api/concepts/[id]/route";
import { db } from "@/lib/firebase-admin";
import { graphRef } from "@/lib/store";
import type { SessionSummary } from "@/lib/types";
import {
  jsonRequest,
  startInvestigatedSession,
  startOverlappingSession,
  type StateBody,
} from "./helpers";

// Sessions behave like conversations: several may be in progress at once,
// and any of them can be reopened and resumed where it left off.

beforeEach(async () => {
  clearScriptedResponses();
  await db.recursiveDelete(graphRef());
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

/** Take a Session from Diagnosing into Learning on its first Concept. */
async function intoLearning(sessionId: string, checks: { id: string }[]) {
  scriptModelResponse(JSON.stringify({ knownConceptIds: [] }));
  await postDiagnostic(
    jsonRequest("/api/session/diagnostic", {
      sessionId,
      answers: checks.map((c) => ({ checkId: c.id, answer: "no idea" })),
    }),
  );
  scriptModelResponse("First exposition", JSON.stringify({ question: "Q?" }));
  await postAdvance(
    new Request(`http://test/api/session/advance?session=${sessionId}`, {
      method: "POST",
    }),
  );
}

describe("Concurrent Sessions", () => {
  it("keeps two Sessions in progress, each at its own position", async () => {
    const first = await startInvestigatedSession();
    await intoLearning(first.session.id, first.checks);
    const second = await startOverlappingSession();
    await intoLearning(second.session.id, second.checks);

    const a: StateBody = await (
      await getSession(new Request("http://test"), ctx(first.session.id))
    ).json();
    const b: StateBody = await (
      await getSession(new Request("http://test"), ctx(second.session.id))
    ).json();

    expect(a.session.phase).toBe("learning");
    expect(b.session.phase).toBe("learning");
    expect(a.session.activeConceptId).not.toBe(b.session.activeConceptId);
    // Each Session's Path is its own; neither sees the other's.
    expect(a.session.path).not.toEqual(b.session.path);
  });

  it("talking in one Session leaves the other untouched", async () => {
    const first = await startInvestigatedSession();
    await intoLearning(first.session.id, first.checks);
    const second = await startOverlappingSession();
    await intoLearning(second.session.id, second.checks);

    const before: StateBody = await (
      await getSession(new Request("http://test"), ctx(first.session.id))
    ).json();

    scriptModelResponse(
      "A reply in the second session.",
      JSON.stringify({ question: "Q, revised?" }),
    );
    await postLesson(
      jsonRequest("/api/session/lesson", {
        sessionId: second.session.id,
        message: "why?",
      }),
    );

    const after: StateBody = await (
      await getSession(new Request("http://test"), ctx(first.session.id))
    ).json();
    expect(after.lessons).toEqual(before.lessons);
    expect(after.session).toEqual(before.session);
  });

  it("opens on the newest Session still in progress", async () => {
    const first = await startInvestigatedSession();
    await intoLearning(first.session.id, first.checks);
    const second = await startOverlappingSession();

    const landing: StateBody = await (await GET()).json();
    expect(landing.session.id).toBe(second.session.id);
  });

  it("mastery check targets the Session named in the body, not the newest", async () => {
    const first = await startInvestigatedSession();
    await intoLearning(first.session.id, first.checks);
    const second = await startOverlappingSession();
    await intoLearning(second.session.id, second.checks);

    // "Test me" is sent with the viewed Session in the body, not the URL.
    const firstState: StateBody = await (
      await getSession(new Request("http://test"), ctx(first.session.id))
    ).json();

    // Already primed alongside intoLearning()'s advance — no script needed.
    const res = await postCheck(
      jsonRequest("/api/session/check", { sessionId: first.session.id }),
    );
    expect(res.status).toBe(200);
    const after: StateBody = await res.json();

    const check = after.checks.find(
      (c) => c.phase === "mastery" && c.verdict === null,
    )!;
    expect(check.sessionId).toBe(first.session.id);
    expect(check.conceptIds).toEqual([firstState.session.activeConceptId]);
  });

  // An Edit is made from a Session's own screen, so the state it hands
  // back must be that Session's — not merely the newest in progress.
  it("removing a Concept answers with the viewed Session, not the newest", async () => {
    const first = await startInvestigatedSession();
    const second = await startOverlappingSession();
    expect(second.session.id).not.toBe(first.session.id);

    const doomed = first.concepts.find((c) => c.status !== "active")!;
    const res = await deleteConcept(
      new Request(
        `http://test/api/concepts/${doomed.id}?session=${first.session.id}`,
        { method: "DELETE" },
      ),
      { params: Promise.resolve({ id: doomed.id }) },
    );
    expect(res.status).toBe(200);

    const after: StateBody = await res.json();
    expect(after.session.id).toBe(first.session.id);
    expect(after.concepts.some((c) => c.id === doomed.id)).toBe(false);
  });

  it("renaming a Concept answers with the viewed Session, not the newest", async () => {
    const first = await startInvestigatedSession();
    const second = await startOverlappingSession();
    expect(second.session.id).not.toBe(first.session.id);

    const target = first.concepts[0];
    const res = await patchConcept(
      jsonRequest(`/api/concepts/${target.id}`, {
        label: "Renamed",
        sessionId: first.session.id,
      }),
      { params: Promise.resolve({ id: target.id }) },
    );
    expect(res.status).toBe(200);

    const after: StateBody = await res.json();
    expect(after.session.id).toBe(first.session.id);
    expect(after.concepts.find((c) => c.id === target.id)?.label).toBe(
      "Renamed",
    );
  });

  it("lists every Session with its own progress", async () => {
    const first = await startInvestigatedSession();
    await intoLearning(first.session.id, first.checks);
    const second = await startOverlappingSession();

    const { sessions }: { sessions: SessionSummary[] } = await (
      await getSessions()
    ).json();
    expect(sessions.map((s) => s.id)).toEqual([
      second.session.id,
      first.session.id,
    ]);
    expect(sessions[1].pathLength).toBe(3);
    expect(sessions[1].pathDone).toBe(0);
    // The second hasn't been diagnosed, so it has no Path yet.
    expect(sessions[0].pathLength).toBe(0);
  });
});
