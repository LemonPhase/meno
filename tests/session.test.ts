import { beforeEach, describe, expect, it } from "vitest";
import { clearScriptedResponses } from "@/ai/scripted";
import { GET, POST } from "@/app/api/session/route";
import { db } from "@/lib/firebase-admin";
import { graphRef } from "@/lib/store";
import type { Concept } from "@/lib/types";
import {
  USER,
  authed,
  jsonRequest,
  startInvestigatedSession,
} from "./helpers";

// Black-box tests over the server interface: call the route handlers the way
// the browser would, then assert on the response and on what Firestore holds.

beforeEach(async () => {
  clearScriptedResponses();
  await db.recursiveDelete(graphRef(USER));
});

describe("POST /api/session", () => {
  it("creates a Session, investigates the Topic, and seeds the Graph", async () => {
    const body = await startInvestigatedSession();

    expect(body.session.topic).toBe("attention mechanisms");
    expect(body.session.phase).toBe("diagnosing");
    expect(body.concepts).toHaveLength(3);

    // Concepts land in the durable Graph, not just the response.
    const stored = await graphRef(USER).collection("concepts").get();
    expect(stored.size).toBe(3);
    const byLabel = new Map(
      stored.docs.map((d) => [d.data().label, d.data() as Concept]),
    );

    const attention = byLabel.get("Attention")!;
    const softmax = byLabel.get("Softmax")!;
    const dotProduct = byLabel.get("Dot product")!;

    // requires keys were mapped to Concept ids; unknown keys and
    // self-references were dropped.
    expect(attention.requires.sort()).toEqual(
      [dotProduct.id, softmax.id].sort(),
    );
    expect(softmax.requires).toEqual([dotProduct.id]);
    expect(dotProduct.requires).toEqual([]);

    // ADR-0004: the durable Concept carries no Path state at all — only
    // whether it is learned, and which Session first found it.
    for (const c of [attention, softmax, dotProduct]) {
      expect(c.unlocked).toBe(false);
      expect(c.skipped).toBe(false);
      expect(c.originSessionId).toBe(body.session.id);
      expect(c).not.toHaveProperty("status");
      expect(c).not.toHaveProperty("order");
    }

    // The Session claims them, but has no Path until the diagnostic runs.
    expect(body.session.conceptIds.sort()).toEqual(
      [attention.id, softmax.id, dotProduct.id].sort(),
    );
    expect(body.session.path).toEqual([]);
    for (const c of body.concepts) {
      expect(c.status).toBe("locked");
      expect(c.order).toBeNull();
      expect(c.origin).toBe("planned");
    }
  });

  it("generates diagnostic Checks covering the Concepts", async () => {
    const body = await startInvestigatedSession();

    expect(body.checks).toHaveLength(3);
    const conceptIds = new Set(body.concepts.map((c) => c.id));
    for (const check of body.checks) {
      expect(check.phase).toBe("diagnostic");
      expect(check.sessionId).toBe(body.session.id);
      expect(check.answer).toBeNull();
      for (const id of check.conceptIds) expect(conceptIds.has(id)).toBe(true);
    }
  });

  it("rejects a missing or blank topic", async () => {
    const blank = await POST(jsonRequest("/api/session", { topic: "   " }));
    expect(blank.status).toBe(400);
    const missing = await POST(jsonRequest("/api/session", {}));
    expect(missing.status).toBe(400);
  });
});

describe("GET /api/session", () => {
  it("returns empty state before any Session exists", async () => {
    const body = await (await GET(authed("/api/session"))).json();
    expect(body.session).toBeNull();
    expect(body.concepts).toEqual([]);
    expect(body.checks).toEqual([]);
  });

  it("returns the latest Session with its Concepts and Checks", async () => {
    const created = await startInvestigatedSession();

    const body = await (await GET(authed("/api/session"))).json();
    expect(body.session.id).toBe(created.session.id);
    expect(body.session.phase).toBe("diagnosing");
    expect(body.concepts).toHaveLength(3);
    expect(body.checks).toHaveLength(3);
  });
});
