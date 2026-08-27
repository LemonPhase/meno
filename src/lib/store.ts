import { randomUUID } from "node:crypto";
import { db } from "./firebase-admin";
import { DEMO_USER_ID } from "./constants";
import type { Concept, Session } from "./types";
import type { Investigation } from "@/ai/investigate";

// Firestore layout (ADR-0002: the Graph is the durable per-user container):
//   graphs/{graphId}                    — one per user; graphId = user id
//   graphs/{graphId}/sessions/{id}
//   graphs/{graphId}/concepts/{id}

export const graphRef = (graphId: string = DEMO_USER_ID) =>
  db.collection("graphs").doc(graphId);

export async function createSession(
  topic: string,
  graphId: string = DEMO_USER_ID,
): Promise<Session> {
  const session: Session = {
    id: randomUUID(),
    topic,
    phase: "investigating",
    activeConceptId: null,
    createdAt: Date.now(),
  };
  await graphRef(graphId).collection("sessions").doc(session.id).set(session);
  return session;
}

/**
 * Persist an Investigation's concepts into the Graph and advance the
 * Session to Diagnosing. Concept ids are namespaced by session so a later
 * Session can't collide (cross-session dedup is explicitly future work).
 */
export async function saveInvestigation(
  session: Session,
  investigation: Investigation,
  graphId: string = DEMO_USER_ID,
): Promise<{ session: Session; concepts: Concept[] }> {
  const idFor = (key: string) => `${session.id.slice(0, 8)}_${key}`;
  const now = Date.now();

  const concepts: Concept[] = investigation.concepts.map((c) => ({
    id: idFor(c.key),
    label: c.label,
    summary: c.summary,
    status: "locked",
    skipped: false,
    origin: "planned",
    requires: c.requires.map(idFor),
    sessionId: session.id,
    order: null,
    createdAt: now,
  }));

  const updated: Session = { ...session, phase: "diagnosing" };

  const batch = db.batch();
  const graph = graphRef(graphId);
  for (const concept of concepts) {
    batch.set(graph.collection("concepts").doc(concept.id), concept);
  }
  batch.set(graph.collection("sessions").doc(session.id), updated);
  await batch.commit();

  return { session: updated, concepts };
}

/** The latest Session and its Concepts — what the UI rehydrates from. */
export async function getCurrentState(graphId: string = DEMO_USER_ID): Promise<{
  session: Session | null;
  concepts: Concept[];
}> {
  const graph = graphRef(graphId);
  const latest = await graph
    .collection("sessions")
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();
  if (latest.empty) return { session: null, concepts: [] };

  const session = latest.docs[0].data() as Session;
  const conceptDocs = await graph
    .collection("concepts")
    .where("sessionId", "==", session.id)
    .get();
  const concepts = conceptDocs.docs
    .map((d) => d.data() as Concept)
    .sort((a, b) => a.id.localeCompare(b.id));

  return { session, concepts };
}
