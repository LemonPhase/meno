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
  createdAt: number;
}

export interface Session {
  id: string;
  topic: string;
  phase: SessionPhase;
  /** The one Active Concept during Learning; null otherwise. */
  activeConceptId: string | null;
  createdAt: number;
}
