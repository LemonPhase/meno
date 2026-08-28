import type { Check, LessonMessage } from "./types";

/**
 * A mastery Check with a null verdict passes through two states on its way
 * to being answered: primed (its question generated ahead of time, not yet
 * shown) and revealed (a check-question message put it in the Lesson —
 * "Test me" was clicked). Both are the same Firestore document; which state
 * it's in is told apart by whether the Lesson already references it, so no
 * extra field is needed to track it.
 */
function isRevealed(check: Check, messages: LessonMessage[]): boolean {
  return messages.some(
    (m) => m.kind === "check-question" && m.checkId === check.id,
  );
}

/** The mastery Check currently shown in the Lesson, awaiting an answer. */
export function revealedCheck(
  checks: Check[],
  messages: LessonMessage[],
  conceptId: string,
): Check | undefined {
  return checks.find(
    (c) =>
      c.phase === "mastery" &&
      c.conceptIds.includes(conceptId) &&
      c.verdict === null &&
      isRevealed(c, messages),
  );
}

/** The mastery Check generated ahead of the ask, ready to reveal instantly. */
export function primedCheck(
  checks: Check[],
  messages: LessonMessage[],
  conceptId: string,
): Check | undefined {
  return checks.find(
    (c) =>
      c.phase === "mastery" &&
      c.conceptIds.includes(conceptId) &&
      c.verdict === null &&
      !isRevealed(c, messages),
  );
}
