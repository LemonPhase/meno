import type { Check, LessonMessage } from "./types";

/**
 * A mastery Check with a null verdict passes through two states on its way
 * to being answered: primed (its question generated ahead of time, not yet
 * shown) and revealed (a check-question message put it in the Lesson —
 * "Test me" was clicked). Both are the same Firestore document; which state
 * it's in is told apart by whether the Lesson already references it, so no
 * extra field is needed to track it.
 *
 * A Concept has exactly one mastery question, written with its exposition
 * and never rewritten. A failed attempt records its verdict and primes that
 * same question again, so the attempts are separate documents sharing one
 * question — which is what keeps every attempt in the transcript.
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

/**
 * The mastery Check this Concept has already been passed on. Its presence is
 * what offers the learner the move to the next Concept — passing no longer
 * moves them itself, so they leave when they are ready. See the advance route.
 */
export function passedCheck(
  checks: Check[],
  conceptId: string,
): Check | undefined {
  return checks.find(
    (c) =>
      c.phase === "mastery" &&
      c.conceptIds.includes(conceptId) &&
      c.verdict === "pass",
  );
}

/**
 * The question this Concept is checked on, from any Check ever written for
 * it — answered, failed or waiting. A Concept has one question and keeps it,
 * so a Concept that somehow has no Check pending is re-asked what it always
 * asked rather than being given a second, different question.
 */
export function conceptQuestion(
  checks: Check[],
  conceptId: string,
): string | undefined {
  return checks.find(
    (c) => c.phase === "mastery" && c.conceptIds.includes(conceptId),
  )?.question;
}
