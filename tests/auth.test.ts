import { beforeEach, describe, expect, it } from "vitest";
import { clearScriptedResponses } from "@/ai/scripted";
import { GET as getSessionState } from "@/app/api/session/route";
import { GET as getGraph } from "@/app/api/graph/route";
import { GET as getSessions } from "@/app/api/sessions/route";
import { GET as getSessionById } from "@/app/api/sessions/[id]/route";
import {
  DELETE as deleteConcept,
  PATCH as patchConcept,
} from "@/app/api/concepts/[id]/route";
import { POST as postSession } from "@/app/api/session/route";
import { isBadToken } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";
import { graphRef } from "@/lib/store";
import type { SessionSummary } from "@/lib/types";
import {
  OTHER,
  USER,
  authed,
  jsonRequest,
  startInvestigatedSession,
} from "./helpers";

// Sessions and Graphs are scoped by user. The uid *is* the graphId, so
// this is a claim about the Firestore path a request can reach at all —
// not about a filter applied afterwards. Worth a test because getting it
// wrong leaks one learner's Graph into another's silently.

beforeEach(async () => {
  clearScriptedResponses();
  await db.recursiveDelete(graphRef(USER));
  await db.recursiveDelete(graphRef(OTHER));
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const anonymous = (url: string, init: RequestInit = {}) =>
  new Request(`http://test${url}`, init);

describe("signed out", () => {
  it("refuses every route that touches a Graph", async () => {
    const calls: [string, Promise<Response>][] = [
      ["GET /api/sessions", getSessions(anonymous("/api/sessions"))],
      ["GET /api/graph", getGraph(anonymous("/api/graph"))],
      ["GET /api/session", getSessionState(anonymous("/api/session"))],
      [
        "GET /api/sessions/[id]",
        getSessionById(anonymous("/api/sessions/x"), ctx("x")),
      ],
      [
        "POST /api/session",
        postSession(
          new Request("http://test/api/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ topic: "anything" }),
          }),
        ),
      ],
      [
        "PATCH /api/concepts/[id]",
        patchConcept(
          new Request("http://test/api/concepts/x", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ label: "Mine now" }),
          }),
          ctx("x"),
        ),
      ],
      [
        "DELETE /api/concepts/[id]",
        deleteConcept(
          anonymous("/api/concepts/x", { method: "DELETE" }),
          ctx("x"),
        ),
      ],
    ];
    for (const [name, call] of calls) {
      expect((await call).status, name).toBe(401);
    }
  });

  it("writes nothing while refusing", async () => {
    await postSession(
      new Request("http://test/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: "attention mechanisms" }),
      }),
    );
    // No scripted responses were consumed and no Graph was created: the
    // refusal happens before the model or Firestore are touched.
    const sessions = await graphRef(USER).collection("sessions").get();
    expect(sessions.empty).toBe(true);
  });
});

// Regression: signing in ran two Google calls with different credential
// needs — verifyIdToken needs none, createSessionCookie needs a service
// account — and one blanket catch reported the second one's failure as 401
// "could not verify sign-in". That points whoever is debugging at the token,
// which was fine, instead of at the credential, which was not. Only a bad
// token may be classified as the browser's fault.
describe("sign-in failures", () => {
  it("blames the token only for token errors", () => {
    for (const code of [
      "auth/argument-error",
      "auth/id-token-expired",
      "auth/id-token-revoked",
      "auth/invalid-id-token",
      "auth/user-disabled",
      "auth/user-not-found",
    ]) {
      expect(isBadToken({ code }), code).toBe(true);
    }
  });

  it("blames the server for credential and transport errors", () => {
    // auth/internal-error is what a user credential gets from
    // :createSessionCookie — the exact failure this test exists for.
    for (const error of [
      { code: "auth/internal-error" },
      { code: "auth/insufficient-permission" },
      { code: "auth/project-not-found" },
      { code: "ENOTFOUND" },
      new Error("no credentials"),
      undefined,
      null,
    ]) {
      expect(isBadToken(error), JSON.stringify(error)).toBe(false);
    }
  });
});

describe("two users", () => {
  it("keeps each reader's Sessions and Concepts to themselves", async () => {
    const mine = await startInvestigatedSession();

    // The stranger's Graph is empty, and stays empty.
    const theirs: { sessions: SessionSummary[] } = await (
      await getSessions(authed("/api/sessions", { uid: OTHER }))
    ).json();
    expect(theirs.sessions).toEqual([]);

    const theirGraph = await (
      await getGraph(authed("/api/graph", { uid: OTHER }))
    ).json();
    expect(theirGraph.concepts).toEqual([]);
    expect(theirGraph.sessions).toEqual([]);

    // Mine is unchanged, and mine.
    const ours: { sessions: SessionSummary[] } = await (
      await getSessions(authed("/api/sessions"))
    ).json();
    expect(ours.sessions.map((s) => s.id)).toEqual([mine.session.id]);
  });

  it("does not serve one reader's Session to another by its id", async () => {
    const mine = await startInvestigatedSession();

    // Knowing the id buys nothing: it names a document under my Graph, and
    // the stranger's request never leaves theirs.
    const res = await getSessionById(
      authed(`/api/sessions/${mine.session.id}`, { uid: OTHER }),
      ctx(mine.session.id),
    );
    expect(res.status).toBe(404);

    const ok = await getSessionById(
      authed(`/api/sessions/${mine.session.id}`),
      ctx(mine.session.id),
    );
    expect(ok.status).toBe(200);
  });

  it("does not let one reader edit another's Concept", async () => {
    const mine = await startInvestigatedSession();
    const softmax = mine.concepts.find((c) => c.label === "Softmax")!;

    const renamed = await patchConcept(
      jsonRequest(`/api/concepts/${softmax.id}`, { label: "Mine now" }, OTHER),
      ctx(softmax.id),
    );
    expect(renamed.status).toBe(404);

    const removed = await deleteConcept(
      authed(`/api/concepts/${softmax.id}`, { method: "DELETE", uid: OTHER }),
      ctx(softmax.id),
    );
    expect(removed.status).toBe(404);

    const stored = await graphRef(USER)
      .collection("concepts")
      .doc(softmax.id)
      .get();
    expect(stored.exists).toBe(true);
    expect(stored.data()!.label).toBe("Softmax");
  });
});
