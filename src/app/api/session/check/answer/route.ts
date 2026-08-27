import { gradeMasteryCheck } from "@/ai/lesson";
import { advanceToNextConcept } from "@/lib/progression";
import {
  appendLessonMessages,
  formatEditContext,
  getCurrentState,
  getRecentEdits,
  lessonMessage,
  nextLockedConcept,
  recordCheckResult,
  skipNextConcept,
  spliceRemedialConcept,
  unlockConcept,
} from "@/lib/store";

/**
 * Answer the pending mastery Check. A fail returns to open conversation;
 * a pass Unlocks the Concept and moves the Session forward (next Concept,
 * or Complete + Recap).
 */
export async function POST(request: Request) {
  let answer: unknown;
  try {
    ({ answer } = await request.json());
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof answer !== "string" || answer.trim() === "") {
    return Response.json({ error: "answer is required" }, { status: 400 });
  }

  const state = await getCurrentState();
  const { session } = state;
  if (!session || session.phase !== "learning" || !session.activeConceptId) {
    return Response.json(
      { error: "no Active Concept being checked" },
      { status: 409 },
    );
  }

  const check = state.checks.find(
    (c) =>
      c.phase === "mastery" &&
      c.conceptIds.includes(session.activeConceptId!) &&
      c.verdict === null,
  );
  if (!check) {
    return Response.json(
      { error: "no pending mastery Check — request one first" },
      { status: 409 },
    );
  }

  const concept = state.concepts.find((c) => c.id === session.activeConceptId)!;
  const lesson = state.lessons.find(
    (l) => l.conceptId === session.activeConceptId,
  )!;

  const next = nextLockedConcept(state.concepts);
  const grade = await gradeMasteryCheck({
    topic: session.topic,
    concept: { label: concept.label, summary: concept.summary },
    nextConcept: next ? { label: next.label, summary: next.summary } : null,
    lesson: { messages: lesson.messages },
    question: check.question,
    answer: answer.trim(),
    editContext: formatEditContext(await getRecentEdits()),
  });

  await recordCheckResult(check.id, answer.trim(), grade.verdict);
  await appendLessonMessages(concept.id, [
    lessonMessage("check-answer", answer.trim(), check.id),
    lessonMessage("check-feedback", grade.feedback, check.id),
  ]);

  // ADR-0001: the bounded Adjustment rides on the grading result.
  if (grade.adjustment === "insert_remedial" && grade.remedial) {
    await spliceRemedialConcept(
      session,
      concept,
      state.concepts,
      grade.remedial,
    );
  } else if (grade.adjustment === "skip_next") {
    await skipNextConcept(state.concepts);
  }

  if (grade.verdict === "pass") {
    await unlockConcept(concept.id);
    const refreshed = await getCurrentState();
    await advanceToNextConcept(refreshed.session!, refreshed.concepts);
  }

  return Response.json(await getCurrentState());
}
