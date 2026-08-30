import { generateMasteryCheck, teachConcept, writeRecap } from "@/ai/lesson";
import {
  activateConcept,
  completeSession,
  nextLockedConcept,
} from "./store";
import type { Concept, Session } from "./types";

/**
 * Move the Session forward: activate the next Concept on its Path still to
 * be learned (generating its exposition lazily), or — when the Path is
 * finished — complete the Session with a Recap.
 *
 * `from` is the Concept being left, null when leaving the Path preview. It
 * is what the commit is guarded on, so this reports false when the Session
 * has already moved out from under the caller and nothing was written.
 */
export async function advanceToNextConcept(
  session: Session,
  concepts: Concept[],
  from: string | null,
): Promise<boolean> {
  const next = nextLockedConcept(session, concepts);
  // `from` is Unlocked by this move, in the commit below — it is still
  // Locked in the snapshot that got us here. Counting it now is what keeps
  // the next exposition from being written as though the learner had never
  // met its immediate prerequisite, and keeps the Recap from omitting the
  // last thing they passed.
  const unlocked = concepts.filter((c) => c.unlocked || c.id === from);
  if (next) {
    const { exposition } = await teachConcept({
      topic: session.topic,
      concept: { label: next.label, summary: next.summary },
      unlockedLabels: unlocked.map((c) => c.label),
    });
    // The Concept's one mastery question is written against the exposition
    // it will test, so the learner is asked about what they were actually
    // shown rather than about the summary the Path was planned from. It is
    // primed here so "Test me" is instant — see @/lib/checks.
    const { question } = await generateMasteryCheck({
      topic: session.topic,
      concept: { label: next.label, summary: next.summary },
      lesson: { messages: [{ kind: "exposition", text: exposition }] },
    });
    // Both model calls land before anything is written, and the writes go
    // in as one guarded commit: a failure here leaves the Session exactly
    // where it stood, with the move still to make.
    return activateConcept(session, from, next.id, exposition, question);
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
    return completeSession(session, from, recap);
  }
}
