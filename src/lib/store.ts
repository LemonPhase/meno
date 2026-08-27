import { randomUUID } from "node:crypto";
import { db } from "./firebase-admin";
import { DEMO_USER_ID } from "./constants";
import type { Check, Concept, Lesson, LessonMessage, Session } from "./types";
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
    recap: null,
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

const message = (
  kind: LessonMessage["kind"],
  text: string,
  checkId?: string,
): LessonMessage => ({
  kind,
  text,
  ...(checkId ? { checkId } : {}),
  createdAt: Date.now(),
});

export { message as lessonMessage };

/**
 * Activate a Concept: it becomes the Session's one Active Concept and its
 * Lesson opens with the exposition. (Lazy generation: the exposition is
 * produced only now, when the Concept is reached.)
 */
export async function activateConcept(
  session: Session,
  conceptId: string,
  exposition: string,
  graphId: string = DEMO_USER_ID,
): Promise<void> {
  const graph = graphRef(graphId);
  const lesson: Lesson = {
    conceptId,
    sessionId: session.id,
    messages: [message("exposition", exposition)],
  };
  const batch = db.batch();
  batch.update(graph.collection("concepts").doc(conceptId), {
    status: "active",
  });
  batch.set(graph.collection("lessons").doc(conceptId), lesson);
  batch.update(graph.collection("sessions").doc(session.id), {
    phase: "learning",
    activeConceptId: conceptId,
  });
  await batch.commit();
}

export async function appendLessonMessages(
  conceptId: string,
  messages: LessonMessage[],
  graphId: string = DEMO_USER_ID,
): Promise<void> {
  const ref = graphRef(graphId).collection("lessons").doc(conceptId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const lesson = snap.data() as Lesson;
    tx.update(ref, { messages: [...lesson.messages, ...messages] });
  });
}

export async function saveMasteryCheck(
  sessionId: string,
  conceptId: string,
  question: string,
  graphId: string = DEMO_USER_ID,
): Promise<Check> {
  const check: Check = {
    id: randomUUID(),
    sessionId,
    phase: "mastery",
    conceptIds: [conceptId],
    question,
    answer: null,
    verdict: null,
    createdAt: Date.now(),
  };
  await graphRef(graphId).collection("checks").doc(check.id).set(check);
  return check;
}

export async function recordCheckResult(
  checkId: string,
  answer: string,
  verdict: "pass" | "fail",
  graphId: string = DEMO_USER_ID,
): Promise<void> {
  await graphRef(graphId)
    .collection("checks")
    .doc(checkId)
    .update({ answer, verdict });
}

/** Unlock a Concept after a passed mastery Check. */
export async function unlockConcept(
  conceptId: string,
  graphId: string = DEMO_USER_ID,
): Promise<void> {
  await graphRef(graphId)
    .collection("concepts")
    .doc(conceptId)
    .update({ status: "unlocked" });
}

/** The next Locked Concept on the Path, or null when the Path is done. */
export function nextLockedConcept(concepts: Concept[]): Concept | null {
  return (
    concepts
      .filter((c) => c.status === "locked" && c.order !== null)
      .sort((a, b) => a.order! - b.order!)[0] ?? null
  );
}

/**
 * Adjustment `insert_remedial` (ADR-0001): splice a remedial Concept into
 * the Path immediately after the Active one, ahead of everything that was
 * next. The previously-next Concept gains a `requires` edge on it.
 */
export async function spliceRemedialConcept(
  session: Session,
  active: Concept,
  concepts: Concept[],
  remedial: { label: string; summary: string },
  graphId: string = DEMO_USER_ID,
): Promise<Concept> {
  const graph = graphRef(graphId);
  const remedialCount = concepts.filter((c) => c.origin === "remedial").length;
  const activeOrder = active.order ?? -1;
  const maxIndex = Math.max(...concepts.map((c) => c.extractionIndex));

  const concept: Concept = {
    id: `${session.id.slice(0, 8)}_rem${remedialCount + 1}`,
    label: remedial.label,
    summary: remedial.summary,
    status: "locked",
    skipped: false,
    origin: "remedial",
    requires: [],
    sessionId: session.id,
    order: activeOrder + 1,
    extractionIndex: maxIndex + 1,
    createdAt: Date.now(),
  };

  const batch = db.batch();
  batch.set(graph.collection("concepts").doc(concept.id), concept);
  const wasNext = nextLockedConcept(concepts);
  for (const c of concepts) {
    if (c.order !== null && c.order > activeOrder) {
      batch.update(graph.collection("concepts").doc(c.id), {
        order: c.order + 1,
        ...(wasNext && c.id === wasNext.id
          ? { requires: [...c.requires, concept.id] }
          : {}),
      });
    }
  }
  await batch.commit();
  return concept;
}

/**
 * Adjustment `skip_next` (ADR-0001): the next Concept on the Path is
 * Unlocked + Skipped without being taught. Returns it, or null when there
 * was nothing to skip.
 */
export async function skipNextConcept(
  concepts: Concept[],
  graphId: string = DEMO_USER_ID,
): Promise<Concept | null> {
  const next = nextLockedConcept(concepts);
  if (!next) return null;
  await graphRef(graphId)
    .collection("concepts")
    .doc(next.id)
    .update({ status: "unlocked", skipped: true });
  return next;
}

export async function completeSession(
  session: Session,
  recap: string,
  graphId: string = DEMO_USER_ID,
): Promise<void> {
  await graphRef(graphId).collection("sessions").doc(session.id).update({
    phase: "complete",
    activeConceptId: null,
    recap,
  });
}

export async function getLessons(
  sessionId: string,
  graphId: string = DEMO_USER_ID,
): Promise<Lesson[]> {
  const snap = await graphRef(graphId)
    .collection("lessons")
    .where("sessionId", "==", sessionId)
    .get();
  return snap.docs.map((d) => d.data() as Lesson);
}

/** The latest Session, its Concepts and Checks — what the UI rehydrates from. */
export async function getCurrentState(graphId: string = DEMO_USER_ID): Promise<{
  session: Session | null;
  concepts: Concept[];
  checks: Check[];
  lessons: Lesson[];
}> {
  const graph = graphRef(graphId);
  const latest = await graph
    .collection("sessions")
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();
  if (latest.empty)
    return { session: null, concepts: [], checks: [], lessons: [] };

  const session = latest.docs[0].data() as Session;
  const conceptDocs = await graph
    .collection("concepts")
    .where("sessionId", "==", session.id)
    .get();
  const concepts = conceptDocs.docs
    .map((d) => d.data() as Concept)
    .sort((a, b) => a.id.localeCompare(b.id));
  const [checks, lessons] = await Promise.all([
    getChecks(session.id, graphId),
    getLessons(session.id, graphId),
  ]);

  return { session, concepts, checks, lessons };
}
