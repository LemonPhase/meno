import { randomUUID } from "node:crypto";
import { db } from "./firebase-admin";
import { DEMO_USER_ID } from "./constants";
import type { Check, Concept, Session } from "./types";
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

  const concepts: Concept[] = investigation.concepts.map((c, i) => ({
    id: idFor(c.key),
    label: c.label,
    summary: c.summary,
    status: "locked",
    skipped: false,
    origin: "planned",
    requires: c.requires.map(idFor),
    sessionId: session.id,
    order: null,
    extractionIndex: i,
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

/** Persist diagnostic Checks for a Session. */
export async function saveDiagnosticChecks(
  sessionId: string,
  questions: { conceptKeys: string[]; question: string }[],
  graphId: string = DEMO_USER_ID,
): Promise<Check[]> {
  const now = Date.now();
  const checks: Check[] = questions.map((q, i) => ({
    id: `${sessionId.slice(0, 8)}_diag_${i}`,
    sessionId,
    phase: "diagnostic",
    conceptIds: q.conceptKeys,
    question: q.question,
    answer: null,
    verdict: null,
    createdAt: now,
  }));
  const batch = db.batch();
  const col = graphRef(graphId).collection("checks");
  for (const check of checks) batch.set(col.doc(check.id), check);
  await batch.commit();
  return checks;
}

export async function getChecks(
  sessionId: string,
  graphId: string = DEMO_USER_ID,
): Promise<Check[]> {
  const snap = await graphRef(graphId)
    .collection("checks")
    .where("sessionId", "==", sessionId)
    .get();
  return snap.docs
    .map((d) => d.data() as Check)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Linearize the Path: topological order of the not-known Concepts by
 * `requires` (Kahn's algorithm), tie-broken by extraction order. Known
 * prerequisites count as already satisfied.
 */
export function linearizePath(
  concepts: Concept[],
  knownIds: Set<string>,
): string[] {
  const toLearn = concepts.filter((c) => !knownIds.has(c.id));
  const ids = new Set(toLearn.map((c) => c.id));
  const byId = new Map(toLearn.map((c) => [c.id, c]));
  const pending = new Map(
    toLearn.map((c) => [c.id, c.requires.filter((r) => ids.has(r))]),
  );

  const order: string[] = [];
  while (pending.size > 0) {
    const ready = [...pending.entries()]
      .filter(([, reqs]) => reqs.length === 0)
      .map(([id]) => id)
      .sort(
        (a, b) => byId.get(a)!.extractionIndex - byId.get(b)!.extractionIndex,
      );
    // Cycles shouldn't happen (investigation output is a DAG), but a model
    // could produce one: break it by releasing the earliest-extracted node.
    const next =
      ready[0] ??
      [...pending.keys()].sort(
        (a, b) => byId.get(a)!.extractionIndex - byId.get(b)!.extractionIndex,
      )[0];
    order.push(next);
    pending.delete(next);
    for (const [id, reqs] of pending) {
      pending.set(id, reqs.filter((r) => r !== next));
    }
  }
  return order;
}

/**
 * Apply a graded diagnosis: known Concepts become Unlocked+Skipped in the
 * Graph immediately; the rest get Path order; the Session moves to
 * Previewing with the diagnostic answers recorded on their Checks.
 */
export async function applyDiagnosis(
  session: Session,
  knownConceptIds: string[],
  answers: { checkId: string; answer: string }[],
  graphId: string = DEMO_USER_ID,
): Promise<void> {
  const graph = graphRef(graphId);
  const conceptDocs = await graph
    .collection("concepts")
    .where("sessionId", "==", session.id)
    .get();
  const concepts = conceptDocs.docs.map((d) => d.data() as Concept);
  const known = new Set(knownConceptIds);
  const pathOrder = linearizePath(concepts, known);

  const batch = db.batch();
  for (const concept of concepts) {
    const ref = graph.collection("concepts").doc(concept.id);
    if (known.has(concept.id)) {
      batch.update(ref, { status: "unlocked", skipped: true, order: null });
    } else {
      batch.update(ref, { order: pathOrder.indexOf(concept.id) });
    }
  }
  for (const { checkId, answer } of answers) {
    batch.update(graph.collection("checks").doc(checkId), { answer });
  }
  batch.update(graph.collection("sessions").doc(session.id), {
    phase: "previewing",
  });
  await batch.commit();
}

/** The latest Session, its Concepts and Checks — what the UI rehydrates from. */
export async function getCurrentState(graphId: string = DEMO_USER_ID): Promise<{
  session: Session | null;
  concepts: Concept[];
  checks: Check[];
}> {
  const graph = graphRef(graphId);
  const latest = await graph
    .collection("sessions")
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();
  if (latest.empty) return { session: null, concepts: [], checks: [] };

  const session = latest.docs[0].data() as Session;
  const conceptDocs = await graph
    .collection("concepts")
    .where("sessionId", "==", session.id)
    .get();
  const concepts = conceptDocs.docs
    .map((d) => d.data() as Concept)
    .sort((a, b) => a.id.localeCompare(b.id));
  const checks = await getChecks(session.id, graphId);

  return { session, concepts, checks };
}
