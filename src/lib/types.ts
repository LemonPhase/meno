// Domain vocabulary: see CONTEXT.md. These types are the canonical shapes
// stored in Firestore and returned by the server interface.

export type SessionPhase =
  | "investigating"
  | "diagnosing"
  | "previewing"
  | "learning"
  | "complete";

export type ConceptStatus = "locked" | "active" | "unlocked";

export type ConceptOrigin = "planned" | "remedial";

export interface Concept {
  id: string;
  label: string;
  summary: string;
  status: ConceptStatus;
  skipped: boolean;
  origin: ConceptOrigin;
  /** Concept ids this Concept requires (prerequisites). */
  requires: string[];
  /** The Session that originated this Concept. */
  sessionId: string;
  /** Position on the Session's Path; null until the Path is linearized. */
  order: number | null;
  /** Position in the investigation output; tie-breaker for linearization. */
  extractionIndex: number;
  createdAt: number;
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

export interface Session {
  id: string;
  topic: string;
  phase: SessionPhase;
  /** The one Active Concept during Learning; null otherwise. */
  activeConceptId: string | null;
  /** The closing Recap; set when the Session completes. */
  recap: string | null;
  createdAt: number;
}

export type LessonMessageKind =
  | "exposition"
  | "user"
  | "reply"
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
 * The record of everything that happened while a Concept was Active:
 * exposition, free-form Q&A, and every mastery Check attempt.
 */
export interface Lesson {
  /** Doc id == conceptId (one Lesson per Concept). */
  conceptId: string;
  sessionId: string;
  messages: LessonMessage[];
}
