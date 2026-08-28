// Domain vocabulary: see CONTEXT.md. These types are the canonical shapes
// stored in Firestore and returned by the server interface.
//
// ADR-0004: the Graph owns what the user knows; a Session owns where it is.
// So a Concept carries only durable facts, and Path membership, order and
// origin live on the Session that is walking them.

export type SessionPhase =
  | "investigating"
  | "diagnosing"
  | "previewing"
  | "learning"
  | "complete";

export type ConceptStatus = "locked" | "active" | "unlocked";

export type ConceptOrigin = "planned" | "remedial";

/**
 * A Concept in the user's Graph. Durable and shared: several Sessions may
 * put the same Concept on their Paths, and unlocking it anywhere unlocks
 * it everywhere.
 */
export interface Concept {
  id: string;
  label: string;
  summary: string;
  /** Learned — a mastery Check passed, or judged already known. */
  unlocked: boolean;
  /** Unlocked without being taught (the agent judged it already known). */
  skipped: boolean;
  /** Concept ids this Concept requires (prerequisites). */
  requires: string[];
  /** The Session whose investigation first created this Concept. */
  originSessionId: string;
  createdAt: number;
}

/** One Concept's place on one Session's Path; array position is its order. */
export interface PathEntry {
  conceptId: string;
  origin: ConceptOrigin;
}

export interface Session {
  id: string;
  topic: string;
  phase: SessionPhase;
  /** The one Active Concept during Learning; null otherwise. */
  activeConceptId: string | null;
  /** The closing Recap; set when the Session completes. */
  recap: string | null;
  /** Every Concept this Session's investigation surfaced, attached or new. */
  conceptIds: string[];
  /** The Concepts still to teach, in order. */
  path: PathEntry[];
  createdAt: number;
}

/**
 * A Concept as one Session sees it: the durable facts plus that Session's
 * own view of where it sits. This is what the server hands the UI.
 */
export interface SessionConcept extends Concept {
  status: ConceptStatus;
  /** Position on this Session's Path; null when not on it. */
  order: number | null;
  origin: ConceptOrigin;
}

/**
 * A recorded, user-made change to a Concept — append-only, and surfaced
 * to the agent as context for future Graph updates.
 */
export interface Edit {
  id: string;
  conceptId: string;
  kind: "rename" | "delete";
  /** The Concept's label before the Edit. */
  before: string;
  /** The new label for renames; null for deletes. */
  after: string | null;
  createdAt: number;
}

export type CheckPhase = "diagnostic" | "mastery";

export interface Check {
  id: string;
  sessionId: string;
  phase: CheckPhase;
  /** The Concepts this Check probes. */
  conceptIds: string[];
  question: string;
  answer: string | null;
  /** Mastery: pass/fail. Diagnostic outcomes land on the Concepts instead. */
  verdict: "pass" | "fail" | null;
  createdAt: number;
}

export type LessonMessageKind =
  | "exposition"
  | "user"
  | "reply"
  | "event"
  | "check-question"
  | "check-answer"
  | "check-feedback";

export interface LessonMessage {
  kind: LessonMessageKind;
  text: string;
  /** Set on check-* messages: the mastery Check they belong to. */
  checkId?: string;
  createdAt: number;
}

/**
 * The record of everything that happened while a Concept was Active in one
 * Session: exposition, free-form Q&A, and every mastery Check attempt. Keyed
 * by Session as well as Concept — the same Concept may be taught in two.
 */
export interface Lesson {
  conceptId: string;
  sessionId: string;
  messages: LessonMessage[];
}

/**
 * What the sidebar lists for one Session: identity plus Path progress.
 * Derived server-side.
 */
export interface SessionSummary {
  id: string;
  topic: string;
  phase: SessionPhase;
  createdAt: number;
  /** Concepts on the Path. */
  pathLength: number;
  /** Of those, how many are already Unlocked. */
  pathDone: number;
  /** Every Concept this Session unlocked, including diagnostic skips. */
  unlockedCount: number;
}
