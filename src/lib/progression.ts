import { teachConcept, writeRecap } from "@/ai/lesson";
import {
  activateConcept,
  completeSession,
  nextLockedConcept,
} from "./store";
import type { Concept, Session } from "./types";

/**
 * Move the Session forward: activate the next Locked Concept on the Path
 * (generating its exposition lazily), or — when the Path is finished —
 * complete the Session with a Recap.
 */
export async function advanceToNextConcept(
  session: Session,
  concepts: Concept[],
): Promise<void> {
  const next = nextLockedConcept(concepts);
  if (next) {
    const { exposition } = await teachConcept({
      topic: session.topic,
      concept: { label: next.label, summary: next.summary },
      unlockedLabels: concepts
        .filter((c) => c.status === "unlocked")
        .map((c) => c.label),
    });
    await activateConcept(session, next.id, exposition);
  } else {
    const { recap } = await writeRecap({
      topic: session.topic,
      unlocked: concepts
        .filter((c) => c.status === "unlocked")
        .sort((a, b) => a.extractionIndex - b.extractionIndex)
        .map((c) => ({
          label: c.label,
          skipped: c.skipped,
          origin: c.origin,
        })),
    });
    await completeSession(session, recap);
  }
}
