import { generateMasteryCheck, teachConcept, writeRecap } from "@/ai/lesson";
import {
  activateConcept,
  completeSession,
  getLessons,
  lessonMessage,
  nextLockedConcept,
  resumeConcept,
  taughtHere,
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
  graphId: string,
): Promise<boolean> {
  const next = nextLockedConcept(session, concepts);
  // `from` is Unlocked by this move, in the commit below — it is still
  // Locked in the snapshot that got us here. Counting it now is what keeps
  // the next exposition from being written as though the learner had never
  // met its immediate prerequisite, and keeps the Recap from omitting the
  // last thing they passed.
  const unlocked = concepts.filter((c) => c.unlocked || c.id === from);
  if (next) {
    // A Concept this Session has already taught is one the learner was
    // pulled off by a detour, not one waiting to be reached. It is returned
    // to as it was left — transcript, and the one question it was written
    // with — so nothing is generated and nothing is written over.
    // Read fresh rather than taking the caller's snapshot: a detour may have
    // written this very Lesson during the request that led here.
    if (taughtHere(await getLessons(session.id, graphId), next.id)) {
      return resumeConcept(
        session,
        from,
        next.id,
        `Back to ${next.label} · the detour is done`,
        graphId,
      );
    }
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
    return activateConcept(
      session,
      from,
      next.id,
      exposition,
      question,
      graphId,
    );
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
    return completeSession(session, from, recap, graphId);
  }
}

/**
 * Divert to a remedial Concept: teach it now, in front of the Concept it
 * was spliced in to unblock (see spliceRemedialConcept), and leave that one
 * exactly as it stood — Locked, with its Lesson and its unanswered Check
 * waiting. "Break it down" means the prerequisite is missing *now*, so the
 * detour is taken now; queueing it behind the Concept it holds up would
 * teach it only once the learner no longer needed it.
 *
 * Reports whether this call is the one that moved the Session, on the same
 * guard as advanceToNextConcept: it is refused if the Session has moved on
 * underneath the caller.
 */
export async function divertToRemedial(
  session: Session,
  from: Concept,
  remedial: Concept,
  concepts: Concept[],
  /** Why they are here: the tutor's reading of the gap, or the Check's
   *  feedback. It opens the detour's page, because the page they were on
   *  when it was written is the one they are being taken off. */
  because: string,
  graphId: string,
): Promise<boolean> {
  const { exposition } = await teachConcept({
    topic: session.topic,
    concept: { label: remedial.label, summary: remedial.summary },
    unlockedLabels: concepts.filter((c) => c.unlocked).map((c) => c.label),
  });
  const { question } = await generateMasteryCheck({
    topic: session.topic,
    concept: { label: remedial.label, summary: remedial.summary },
    lesson: { messages: [{ kind: "exposition", text: exposition }] },
  });
  return activateConcept(
    session,
    from.id,
    remedial.id,
    exposition,
    question,
    graphId,
    {
      // The Concept being left is interrupted, not learned: it keeps every
      // bit of its unlearned state, and the learner comes back to it.
      unlockFrom: false,
      // Landing on an unfamiliar exposition with no idea why is the one way
      // this could read as the tutor losing the thread, so the reason comes
      // with them.
      lead: [
        lessonMessage("event", `Detour from ${from.label}`),
        lessonMessage("reply", because),
      ],
    },
  );
}
