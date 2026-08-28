import { randomUUID } from "node:crypto";
import { db } from "./firebase-admin";
import { DEMO_USER_ID } from "./constants";
import type {
  Check,
  Concept,
  ConceptOrigin,
  ConceptStatus,
  Edit,
  Lesson,
  LessonMessage,
  PathEntry,
  Session,
  SessionConcept,
  SessionSummary,
} from "./types";
import type { Investigation } from "@/ai/investigate";

// Firestore layout (ADR-0002: the Graph is the durable per-user container;
// ADR-0004: Path state belongs to the Session, not the Concept):
//   graphs/{graphId}                    — one per user; graphId = user id
//   graphs/{graphId}/concepts/{id}      — durable: label, requires, unlocked
//   graphs/{graphId}/sessions/{id}      — carries conceptIds and the Path
//   graphs/{graphId}/lessons/{sessionId__conceptId}
//   graphs/{graphId}/checks/{id}
//   graphs/{graphId}/edits/{id}

export const graphRef = (graphId: string = DEMO_USER_ID) =>
  db.collection("graphs").doc(graphId);

export const lessonKey = (sessionId: string, conceptId: string) =>
  `${sessionId}__${conceptId}`;

/**
 * Documents written before ADR-0004 kept Path state on the Concept. The
 * readers below adapt them in place so a graph created by the old code is
 * still readable by the new — `scripts/migrate-adr-0004.mjs` rewrites them
 * for good, and these adapters can go once every graph has been migrated.
 */
type LegacyConcept = Concept & {
  status?: ConceptStatus;
  origin?: ConceptOrigin;
  order?: number | null;
  sessionId?: string;
  extractionIndex?: number;
};

export function asConcept(data: FirebaseFirestore.DocumentData): Concept {
  const raw = data as LegacyConcept;
  return {
    id: raw.id,
    label: raw.label,
    summary: raw.summary,
    unlocked: raw.unlocked ?? raw.status === "unlocked",
    skipped: raw.skipped ?? false,
    requires: raw.requires ?? [],
    originSessionId: raw.originSessionId ?? raw.sessionId ?? "",
    createdAt: raw.createdAt ?? 0,
  };
}

const rank = (c: LegacyConcept) => c.extractionIndex ?? c.createdAt ?? 0;

/**
 * A Session, reconstructing conceptIds and the Path from the Concepts when
 * the stored document predates them. `pool` is any Concepts already to hand;
 * without it a legacy Session simply reads as having no Path yet.
 */
export function asSession(
  data: FirebaseFirestore.DocumentData,
  pool: FirebaseFirestore.DocumentData[] = [],
): Session {
  const raw = data as Session;
  if (Array.isArray(raw.path) && Array.isArray(raw.conceptIds)) return raw;

  const mine = (pool as LegacyConcept[])
    .filter((c) => c.sessionId === raw.id)
    .sort((a, b) => rank(a) - rank(b));
  return {
    ...raw,
    conceptIds: raw.conceptIds ?? mine.map((c) => c.id),
    path:
      raw.path ??
      mine
        .filter((c) => c.order !== null && c.order !== undefined)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((c) => ({
          conceptId: c.id,
          origin: c.origin ?? ("planned" as const),
        })),
  };
}

export type SessionState = {
  session: Session | null;
  concepts: SessionConcept[];
  checks: Check[];
  lessons: Lesson[];
};

/** A Session's own view of the Concepts it touches (ADR-0004). */
export function decorate(
  session: Session,
  concepts: Concept[],
): SessionConcept[] {
  const place = new Map(
    session.path.map((entry, i) => [entry.conceptId, { i, entry }]),
  );
  return concepts.map((concept) => {
    const seat = place.get(concept.id);
    return {
      ...concept,
      order: seat ? seat.i : null,
      origin: seat ? seat.entry.origin : "planned",
      status: concept.unlocked
        ? "unlocked"
        : session.activeConceptId === concept.id
          ? "active"
          : "locked",
    };
  });
}

async function conceptsByIds(
  ids: string[],
  graphId: string = DEMO_USER_ID,
): Promise<Concept[]> {
  if (ids.length === 0) return [];
  const col = graphRef(graphId).collection("concepts");
  const docs = await db.getAll(...ids.map((id) => col.doc(id)));
  return docs.filter((d) => d.exists).map((d) => asConcept(d.data()!));
}

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
    conceptIds: [],
    path: [],
    createdAt: Date.now(),
  };
  await graphRef(graphId).collection("sessions").doc(session.id).set(session);
  return session;
}

/**
 * Persist an Investigation and advance the Session to Diagnosing.
 *
 * Attach (CONTEXT.md): a found concept the investigation matched to one
 * already in the Graph reuses it rather than creating a duplicate — so a
 * second Topic resting on the same prerequisite meets the same Concept.
 * An attached Concept that is already Unlocked is "already yours": it
 * joins the Session's concepts but never its Path.
 */
export async function saveInvestigation(
  session: Session,
  investigation: Investigation,
  graphId: string = DEMO_USER_ID,
): Promise<{ session: Session; concepts: SessionConcept[] }> {
  const graph = graphRef(graphId);
  const now = Date.now();

  const attachable = new Map(
    (
      await conceptsByIds(
        investigation.concepts
          .map((c) => c.attachTo)
          .filter((id): id is string => typeof id === "string"),
        graphId,
      )
    ).map((c) => [c.id, c]),
  );

  // Resolve every found concept to a Graph Concept id first, so `requires`
  // can be rewritten in terms of them.
  const idForKey = new Map<string, string>();
  const created: Concept[] = [];
  for (const found of investigation.concepts) {
    const attached =
      found.attachTo !== undefined ? attachable.get(found.attachTo) : undefined;
    if (attached) {
      idForKey.set(found.key, attached.id);
    } else {
      const id = `${session.id.slice(0, 8)}_${found.key}`;
      idForKey.set(found.key, id);
      created.push({
        id,
        label: found.label,
        summary: found.summary,
        unlocked: false,
        skipped: false,
        requires: [],
        originSessionId: session.id,
        createdAt: now,
      });
    }
  }
  const resolve = (key: string) => idForKey.get(key);
  for (const concept of created) {
    const found = investigation.concepts.find(
      (f) => resolve(f.key) === concept.id,
    )!;
    // An attached Concept keeps the `requires` the Graph already holds —
    // the user's own curation of it outranks a fresh investigation.
    concept.requires = found.requires
      .map(resolve)
      .filter((id): id is string => id !== undefined && id !== concept.id);
  }

  const conceptIds = investigation.concepts
    .map((f) => resolve(f.key))
    .filter((id): id is string => id !== undefined);
  const all = [...attachable.values(), ...created];
  const byId = new Map(all.map((c) => [c.id, c]));

  const updated: Session = {
    ...session,
    phase: "diagnosing",
    conceptIds,
    // No Path yet: it is the linearization applyDiagnosis produces.
    path: [],
  };

  const batch = db.batch();
  for (const concept of created) {
    batch.set(graph.collection("concepts").doc(concept.id), concept);
  }
  batch.set(graph.collection("sessions").doc(session.id), updated);
  await batch.commit();

  const ordered = conceptIds
    .map((id) => byId.get(id))
    .filter((c): c is Concept => c !== undefined);
  return { session: updated, concepts: decorate(updated, ordered) };
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
 * `requires` (Kahn's algorithm), tie-broken by the order they were found.
 * Known prerequisites count as already satisfied.
 */
export function linearizePath(
  concepts: Concept[],
  knownIds: Set<string>,
  foundOrder: Map<string, number>,
): string[] {
  const toLearn = concepts.filter((c) => !knownIds.has(c.id));
  const ids = new Set(toLearn.map((c) => c.id));
  const pending = new Map(
    toLearn.map((c) => [c.id, c.requires.filter((r) => ids.has(r))]),
  );
  const rank = (id: string) => foundOrder.get(id) ?? Number.MAX_SAFE_INTEGER;

  const order: string[] = [];
  while (pending.size > 0) {
    const ready = [...pending.entries()]
      .filter(([, reqs]) => reqs.length === 0)
      .map(([id]) => id)
      .sort((a, b) => rank(a) - rank(b));
    // Cycles shouldn't happen (investigation output is a DAG), but a model
    // could produce one: break it by releasing the earliest-found node.
    const next =
      ready[0] ?? [...pending.keys()].sort((a, b) => rank(a) - rank(b))[0];
    order.push(next);
    pending.delete(next);
    for (const [id, reqs] of pending) {
      pending.set(
        id,
        reqs.filter((r) => r !== next),
      );
    }
  }
  return order;
}

/**
 * Apply a graded diagnosis: known Concepts become Unlocked+Skipped in the
 * Graph immediately; the rest are linearized into this Session's Path and
 * the Session moves to Previewing.
 */
export async function applyDiagnosis(
  session: Session,
  knownConceptIds: string[],
  answers: { checkId: string; answer: string }[],
  graphId: string = DEMO_USER_ID,
): Promise<void> {
  const graph = graphRef(graphId);
  const concepts = await conceptsByIds(session.conceptIds, graphId);
  const known = new Set(
    knownConceptIds.filter((id) => session.conceptIds.includes(id)),
  );
  // Anything already Unlocked in the Graph is settled knowledge; it never
  // rejoins a Path (CONTEXT.md: Attach).
  for (const concept of concepts) if (concept.unlocked) known.add(concept.id);

  const foundOrder = new Map(session.conceptIds.map((id, i) => [id, i]));
  const pathOrder = linearizePath(concepts, known, foundOrder);

  const batch = db.batch();
  for (const concept of concepts) {
    if (known.has(concept.id) && !concept.unlocked) {
      batch.update(graph.collection("concepts").doc(concept.id), {
        unlocked: true,
        skipped: true,
      });
    }
  }
  for (const { checkId, answer } of answers) {
    batch.update(graph.collection("checks").doc(checkId), { answer });
  }
  batch.update(graph.collection("sessions").doc(session.id), {
    phase: "previewing",
    path: pathOrder.map((conceptId) => ({ conceptId, origin: "planned" })),
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
 * Activate a Concept: it becomes this Session's one Active Concept and its
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
  batch.set(
    graph.collection("lessons").doc(lessonKey(session.id, conceptId)),
    lesson,
  );
  batch.update(graph.collection("sessions").doc(session.id), {
    phase: "learning",
    activeConceptId: conceptId,
  });
  await batch.commit();
}

export async function appendLessonMessages(
  sessionId: string,
  conceptId: string,
  messages: LessonMessage[],
  graphId: string = DEMO_USER_ID,
): Promise<void> {
  const lessons = graphRef(graphId).collection("lessons");
  const ref = lessons.doc(lessonKey(sessionId, conceptId));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    // Pre-ADR-0004 Lessons are keyed by Concept alone; append to whichever
    // document actually holds this Lesson.
    const target = snap.exists ? snap : await tx.get(lessons.doc(conceptId));
    if (!target.exists) throw new Error("no Lesson to append to");
    const lesson = target.data() as Lesson;
    tx.update(target.ref, { messages: [...lesson.messages, ...messages] });
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

/** Unlock a Concept after a passed mastery Check — true across the Graph. */
export async function unlockConcept(
  conceptId: string,
  graphId: string = DEMO_USER_ID,
): Promise<void> {
  await graphRef(graphId)
    .collection("concepts")
    .doc(conceptId)
    .update({ unlocked: true });
}

/**
 * The next Concept on the Path still to be learned — the one after the
 * Active one, which is being learned now and so is never "next".
 */
export function nextLockedConcept(
  session: Session,
  concepts: Concept[],
): Concept | null {
  const byId = new Map(concepts.map((c) => [c.id, c]));
  for (const entry of session.path) {
    if (entry.conceptId === session.activeConceptId) continue;
    const concept = byId.get(entry.conceptId);
    if (concept && !concept.unlocked) return concept;
  }
  return null;
}

/**
 * Adjustment `insert_remedial` (ADR-0001): splice a remedial Concept into
 * the Path immediately after the Active one, ahead of everything that was
 * next. The previously-next Concept gains a `requires` edge on it.
 */
/**
 * Models sometimes hand back an identifier where a name belongs; a Concept
 * label is read by a person, so `mutually_exclusive_events` becomes
 * "Mutually exclusive events".
 */
export function humanizeLabel(label: string): string {
  const trimmed = label.trim();
  if (!/^[\p{Ll}\p{N}]+([_-][\p{Ll}\p{N}]+)+$/u.test(trimmed)) return trimmed;
  const words = trimmed.split(/[_-]/);
  return words[0].charAt(0).toUpperCase() + words[0].slice(1) + " " + words.slice(1).join(" ");
}

export async function spliceRemedialConcept(
  session: Session,
  active: Concept,
  concepts: Concept[],
  remedial: { label: string; summary: string },
  graphId: string = DEMO_USER_ID,
): Promise<Concept> {
  const graph = graphRef(graphId);
  const remedialCount = session.path.filter(
    (e) => e.origin === "remedial",
  ).length;

  const concept: Concept = {
    id: `${session.id.slice(0, 8)}_rem${remedialCount + 1}`,
    label: humanizeLabel(remedial.label),
    summary: remedial.summary,
    unlocked: false,
    skipped: false,
    requires: [],
    originSessionId: session.id,
    createdAt: Date.now(),
  };

  const at = session.path.findIndex((e) => e.conceptId === active.id);
  const path: PathEntry[] = [...session.path];
  path.splice(at + 1, 0, { conceptId: concept.id, origin: "remedial" });

  const wasNext = nextLockedConcept(session, concepts);
  const batch = db.batch();
  batch.set(graph.collection("concepts").doc(concept.id), concept);
  batch.update(graph.collection("sessions").doc(session.id), {
    path,
    conceptIds: [...session.conceptIds, concept.id],
  });
  if (wasNext && wasNext.id !== active.id) {
    batch.update(graph.collection("concepts").doc(wasNext.id), {
      requires: [...wasNext.requires, concept.id],
    });
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
  session: Session,
  concepts: Concept[],
  graphId: string = DEMO_USER_ID,
): Promise<Concept | null> {
  const next = nextLockedConcept(session, concepts);
  if (!next) return null;
  await graphRef(graphId)
    .collection("concepts")
    .doc(next.id)
    .update({ unlocked: true, skipped: true });
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

/**
 * Rename a Concept (any status) and record the Edit append-only
 * (ADR-0003 philosophy: the user curating their own Graph is trusted).
 */
export async function renameConcept(
  concept: Concept,
  label: string,
  graphId: string = DEMO_USER_ID,
): Promise<void> {
  const graph = graphRef(graphId);
  const edit: Edit = {
    id: randomUUID(),
    conceptId: concept.id,
    kind: "rename",
    before: concept.label,
    after: label,
    createdAt: Date.now(),
  };
  const batch = db.batch();
  batch.update(graph.collection("concepts").doc(concept.id), { label });
  batch.set(graph.collection("edits").doc(edit.id), edit);
  await batch.commit();
}

/**
 * The Sessions in which a Concept is currently being learned. Deleting such
 * a Concept would leave those Sessions pointing at nothing, so it's refused
 * (the one bound on ADR-0003's "never blocks").
 */
export async function sessionsLearning(
  conceptId: string,
  graphId: string = DEMO_USER_ID,
): Promise<Session[]> {
  const snap = await graphRef(graphId)
    .collection("sessions")
    .where("activeConceptId", "==", conceptId)
    .get();
  return snap.docs
    .map((d) => asSession(d.data()))
    .filter((s) => s.phase !== "complete");
}

/**
 * Delete a Concept (ADR-0003: never cascades). Dependents lose the entry
 * from `requires`; it leaves every Session's Path; its Lessons go with it;
 * the Edit is recorded append-only.
 */
export async function deleteConcept(
  concept: Concept,
  graphId: string = DEMO_USER_ID,
): Promise<void> {
  const graph = graphRef(graphId);
  const [conceptDocs, allConceptDocs, sessionDocs, lessonDocs] =
    await Promise.all([
      graph
        .collection("concepts")
        .where("requires", "array-contains", concept.id)
        .get(),
      graph.collection("concepts").get(),
      graph.collection("sessions").get(),
      graph.collection("lessons").where("conceptId", "==", concept.id).get(),
    ]);
  const allConcepts = allConceptDocs.docs.map((d) => d.data());
  const edit: Edit = {
    id: randomUUID(),
    conceptId: concept.id,
    kind: "delete",
    before: concept.label,
    after: null,
    createdAt: Date.now(),
  };

  const batch = db.batch();
  batch.delete(graph.collection("concepts").doc(concept.id));
  for (const doc of lessonDocs.docs) batch.delete(doc.ref);
  for (const doc of conceptDocs.docs) {
    const other = asConcept(doc.data());
    batch.update(doc.ref, {
      requires: other.requires.filter((r) => r !== concept.id),
    });
  }
  for (const doc of sessionDocs.docs) {
    const other = asSession(doc.data(), allConcepts);
    if (!other.conceptIds.includes(concept.id)) continue;
    batch.update(doc.ref, {
      conceptIds: other.conceptIds.filter((id) => id !== concept.id),
      path: other.path.filter((e) => e.conceptId !== concept.id),
    });
  }
  batch.set(graph.collection("edits").doc(edit.id), edit);
  await batch.commit();
}

/** Recent Edits, newest first — the context future agent calls receive. */
export async function getRecentEdits(
  graphId: string = DEMO_USER_ID,
  limit = 20,
): Promise<Edit[]> {
  const snap = await graphRef(graphId)
    .collection("edits")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data() as Edit);
}

/** Render recent Edits as plain prompt context (empty string when none). */
export function formatEditContext(edits: Edit[]): string {
  if (edits.length === 0) return "";
  const lines = edits.map((e) =>
    e.kind === "rename"
      ? `- renamed "${e.before}" to "${e.after}"`
      : `- deleted "${e.before}"`,
  );
  return `The learner has curated their knowledge graph — respect how they organize their own understanding:
${lines.join("\n")}`;
}

export async function getSession(
  sessionId: string,
  graphId: string = DEMO_USER_ID,
): Promise<Session | null> {
  const doc = await graphRef(graphId)
    .collection("sessions")
    .doc(sessionId)
    .get();
  return doc.exists ? asSession(doc.data()!) : null;
}

/**
 * The Session the app opens on: the most recently created one still in
 * progress, else the most recent of all (its record).
 */
export async function latestSessionId(
  graphId: string = DEMO_USER_ID,
): Promise<string | null> {
  const snap = await graphRef(graphId)
    .collection("sessions")
    .orderBy("createdAt", "desc")
    .get();
  const sessions = snap.docs.map((d) => asSession(d.data()));
  const live = sessions.find((s) => s.phase !== "complete");
  return (live ?? sessions[0])?.id ?? null;
}

/**
 * One Session with its Concepts, Checks and Lessons — what the UI works
 * from. Without an id, the Session the app opens on.
 */
export async function getSessionState(
  sessionId?: string,
  graphId: string = DEMO_USER_ID,
): Promise<SessionState> {
  const id = sessionId ?? (await latestSessionId(graphId));
  if (!id) return { session: null, concepts: [], checks: [], lessons: [] };
  const doc = await graphRef(graphId).collection("sessions").doc(id).get();
  if (!doc.exists)
    return { session: null, concepts: [], checks: [], lessons: [] };

  // A Session written before ADR-0004 has no conceptIds to fetch by; its
  // Concepts still carry the sessionId, so find them that way.
  const raw = doc.data()!;
  const legacy = !Array.isArray(raw.conceptIds);
  const pool = legacy
    ? (
        await graphRef(graphId)
          .collection("concepts")
          .where("sessionId", "==", id)
          .get()
      ).docs.map((d) => d.data())
    : [];
  const session = asSession(raw, pool);

  const [concepts, checks, lessons] = await Promise.all([
    legacy
      ? Promise.resolve(pool.map(asConcept))
      : conceptsByIds(session.conceptIds, graphId),
    getChecks(id, graphId),
    getLessons(id, graphId),
  ]);
  const rank = new Map(session.conceptIds.map((cid, i) => [cid, i]));
  concepts.sort(
    (a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0),
  );
  return { session, concepts: decorate(session, concepts), checks, lessons };
}

/** All Sessions newest-first with Path progress — the sidebar's data. */
export async function listSessions(
  graphId: string = DEMO_USER_ID,
): Promise<SessionSummary[]> {
  const graph = graphRef(graphId);
  const [sessionSnap, conceptSnap] = await Promise.all([
    graph.collection("sessions").orderBy("createdAt", "desc").get(),
    graph.collection("concepts").get(),
  ]);
  const allConcepts = conceptSnap.docs.map((d) => d.data());
  const unlocked = new Set(
    allConcepts
      .map(asConcept)
      .filter((c) => c.unlocked)
      .map((c) => c.id),
  );
  return sessionSnap.docs.map((doc) => {
    const session = asSession(doc.data(), allConcepts);
    return {
      id: session.id,
      topic: session.topic,
      phase: session.phase,
      createdAt: session.createdAt,
      pathLength: session.path.length,
      pathDone: session.path.filter((e) => unlocked.has(e.conceptId)).length,
      unlockedCount: session.conceptIds.filter((id) => unlocked.has(id)).length,
    };
  });
}

/**
 * The whole Graph: every Concept across all Sessions, plus the Sessions,
 * Checks, Edits and Lessons — what the Graph and Progress destinations
 * render. Small by construction (one user's accumulated learning).
 */
export async function getGraphOverview(graphId: string = DEMO_USER_ID): Promise<{
  concepts: SessionConcept[];
  sessions: Session[];
  checks: Check[];
  edits: Edit[];
  lessons: Lesson[];
}> {
  const graph = graphRef(graphId);
  const [conceptSnap, sessionSnap, checkSnap, editSnap, lessonSnap] =
    await Promise.all([
      graph.collection("concepts").get(),
      graph.collection("sessions").orderBy("createdAt", "desc").get(),
      graph.collection("checks").get(),
      graph.collection("edits").orderBy("createdAt", "desc").limit(50).get(),
      graph.collection("lessons").get(),
    ]);

  const allConcepts = conceptSnap.docs.map((d) => d.data());
  const sessions = sessionSnap.docs.map((d) => asSession(d.data(), allConcepts));
  const active = new Set(
    sessions
      .filter((s) => s.phase !== "complete" && s.activeConceptId)
      .map((s) => s.activeConceptId as string),
  );
  // Origin is a Path fact, so across the Graph a Concept counts as remedial
  // if any Session spliced it in.
  const remedial = new Set(
    sessions.flatMap((s) =>
      s.path.filter((e) => e.origin === "remedial").map((e) => e.conceptId),
    ),
  );
  // Across the whole Graph there is no single Path, so order is null and
  // status is the Graph's own view: learned, being learned somewhere, or
  // not yet reached.
  const concepts: SessionConcept[] = conceptSnap.docs
    .map((d) => asConcept(d.data()))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map((c) => ({
      ...c,
      order: null,
      origin: remedial.has(c.id) ? ("remedial" as const) : ("planned" as const),
      status: c.unlocked ? "unlocked" : active.has(c.id) ? "active" : "locked",
    }));

  return {
    concepts,
    sessions,
    checks: checkSnap.docs.map((d) => d.data() as Check),
    edits: editSnap.docs.map((d) => d.data() as Edit),
    lessons: lessonSnap.docs.map((d) => d.data() as Lesson),
  };
}

/** One Session's full record — what the read-only archive view renders. */
export async function getSessionRecord(
  sessionId: string,
  graphId: string = DEMO_USER_ID,
): Promise<SessionState | null> {
  const state = await getSessionState(sessionId, graphId);
  return state.session ? state : null;
}
