import { beforeEach, describe, expect, it } from "vitest";
import { scriptModelResponse, clearScriptedResponses } from "@/ai/scripted";
import { GET, POST } from "@/app/api/session/route";
import { db } from "@/lib/firebase-admin";
import { graphRef } from "@/lib/store";
import type { Concept, Session } from "@/lib/types";

// Black-box tests over the server interface: call the route handlers the way
// the browser would, then assert on the response and on what Firestore holds.

function postSession(topic: unknown) {
  return POST(
    new Request("http://test/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic }),
    }),
  );
}

const RESEARCH_NOTES = "Notes: attention builds on dot products and softmax.";

const EXTRACTION = JSON.stringify({
  concepts: [
    {
      key: "dot-product",
      label: "Dot product",
      summary: "Multiplying two vectors into a scalar.",
      requires: [],
    },
    {
      key: "softmax",
      label: "Softmax",
      summary: "Turning scores into a probability distribution.",
      requires: ["dot-product"],
    },
    {
      key: "attention",
      label: "Attention",
      summary: "Weighting values by query-key similarity.",
      requires: ["dot-product", "softmax", "not-a-real-key", "attention"],
    },
  ],
});

beforeEach(async () => {
  clearScriptedResponses();
  await db.recursiveDelete(graphRef());
});

describe("POST /api/session", () => {
  it("creates a Session, investigates the Topic, and seeds the Graph", async () => {
    scriptModelResponse(RESEARCH_NOTES, EXTRACTION);

    const res = await postSession("attention mechanisms");
    expect(res.status).toBe(200);

    const body: { session: Session; concepts: Concept[] } = await res.json();
    expect(body.session.topic).toBe("attention mechanisms");
    expect(body.session.phase).toBe("diagnosing");
    expect(body.concepts).toHaveLength(3);

    // Concepts land in the durable Graph, not just the response.
    const stored = await graphRef().collection("concepts").get();
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

    // Freshly investigated Concepts start Locked, planned, off the Path.
    for (const c of [attention, softmax, dotProduct]) {
      expect(c.status).toBe("locked");
      expect(c.skipped).toBe(false);
      expect(c.origin).toBe("planned");
      expect(c.order).toBeNull();
      expect(c.sessionId).toBe(body.session.id);
    }
  });

  it("rejects a missing or blank topic", async () => {
    expect((await postSession("   ")).status).toBe(400);
    expect((await postSession(undefined)).status).toBe(400);
  });
});

describe("GET /api/session", () => {
  it("returns empty state before any Session exists", async () => {
    const body = await (await GET()).json();
    expect(body.session).toBeNull();
    expect(body.concepts).toEqual([]);
  });

  it("returns the latest Session and its Concepts", async () => {
    scriptModelResponse(RESEARCH_NOTES, EXTRACTION);
    const created = await (await postSession("attention mechanisms")).json();

    const body = await (await GET()).json();
    expect(body.session.id).toBe(created.session.id);
    expect(body.session.phase).toBe("diagnosing");
    expect(body.concepts).toHaveLength(3);
  });
});
