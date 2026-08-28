import { beforeEach, describe, expect, it } from "vitest";
import { clearScriptedResponses, scriptModelResponse } from "@/ai/scripted";
import { GET } from "@/app/api/session/route";
import { GET as getSessions } from "@/app/api/sessions/route";
import { GET as getSession } from "@/app/api/sessions/[id]/route";
import { POST as postDiagnostic } from "@/app/api/session/diagnostic/route";
import { POST as postAdvance } from "@/app/api/session/advance/route";
import { POST as postLesson } from "@/app/api/session/lesson/route";
import { POST as postCheck } from "@/app/api/session/check/route";
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
  scriptModelResponse("First exposition");
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

    scriptModelResponse("A reply in the second session.");
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

    scriptModelResponse(JSON.stringify({ question: "Which dot product?" }));
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
