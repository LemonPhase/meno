import { teachConcept, writeRecap } from "@/ai/lesson";
import { activateConcept, completeSession, nextLockedConcept } from "./store";
import type { Concept, Session } from "./types";

/**
 * Move the Session forward: activate the next Concept on its Path still to
 * be learned (generating its exposition lazily), or — when the Path is
 * finished — complete the Session with a Recap.
 */
export async function advanceToNextConcept(
  session: Session,
  concepts: Concept[],
): Promise<void> {
  const next = nextLockedConcept(session, concepts);
  const unlocked = concepts.filter((c) => c.unlocked);
  if (next) {
    const { exposition } = await teachConcept({
      topic: session.topic,
      concept: { label: next.label, summary: next.summary },
      unlockedLabels: unlocked.map((c) => c.label),
    });
    await activateConcept(session, next.id, exposition);
  } else {
    const onPath = new Map(session.path.map((e, i) => [e.conceptId, { i, e }]));
    const { recap } = await writeRecap({
      topic: session.topic,
      unlocked: unlocked
        .slice()
        .sort(
          (a, b) =>
            (onPath.get(a.id)?.i ?? -1) - (onPath.get(b.id)?.i ?? -1),
        )
        .map((c) => ({
          label: c.label,
          skipped: c.skipped,
          origin: onPath.get(c.id)?.e.origin ?? "planned",
        })),
    });
    await completeSession(session, recap);
  }
}
