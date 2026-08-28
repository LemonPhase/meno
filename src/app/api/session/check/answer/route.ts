import { generateMasteryCheck, gradeMasteryCheck } from "@/ai/lesson";
import { sessionIdFrom } from "@/lib/api";
import { revealedCheck } from "@/lib/checks";
import { advanceToNextConcept } from "@/lib/progression";
import {
  appendLessonMessages,
  formatEditContext,
  getSessionState,
  getRecentEdits,
  lessonMessage,
  nextLockedConcept,
  recordCheckResult,
  saveMasteryCheck,
  skipNextConcept,
  spliceRemedialConcept,
  unlockConcept,
} from "@/lib/store";

/**
 * Answer the pending mastery Check. A fail returns to open conversation;
 * a pass Unlocks the Concept — across the Graph, so every other Session's
 * Path sees it as already known — and moves this Session forward.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { answer } = body;
  if (typeof answer !== "string" || answer.trim() === "") {
    return Response.json({ error: "answer is required" }, { status: 400 });
  }

  const state = await getSessionState(sessionIdFrom(request, body));
  const { session } = state;
  if (!session || session.phase !== "learning" || !session.activeConceptId) {
    return Response.json(
      { error: "no Active Concept being checked" },
      { status: 409 },
    );
  }

  const concept = state.concepts.find((c) => c.id === session.activeConceptId)!;
  const lesson = state.lessons.find(
    (l) => l.conceptId === session.activeConceptId,
  )!;

  const check = revealedCheck(state.checks, lesson.messages, concept.id);
  if (!check) {
    return Response.json(
      { error: "no pending mastery Check — request one first" },
      { status: 409 },
    );
  }

  const next = nextLockedConcept(session, state.concepts);
  const grade = await gradeMasteryCheck({
    topic: session.topic,
    concept: { label: concept.label, summary: concept.summary },
    nextConcept:
      next && next.id !== concept.id
        ? { label: next.label, summary: next.summary }
        : null,
    lesson: { messages: lesson.messages },
    question: check.question,
    answer: answer.trim(),
    editContext: formatEditContext(await getRecentEdits()),
  });

  await recordCheckResult(check.id, answer.trim(), grade.verdict);
  await appendLessonMessages(session.id, concept.id, [
    lessonMessage("check-answer", answer.trim(), check.id),
    lessonMessage("check-feedback", grade.feedback, check.id),
  ]);

  // ADR-0001: the bounded Adjustment rides on the grading result, and is
  // recorded in the Lesson so the transcript explains itself later.
  if (grade.adjustment === "insert_remedial" && grade.remedial) {
    const remedial = await spliceRemedialConcept(
      session,
      concept,
      state.concepts,
      grade.remedial,
    );
    await appendLessonMessages(session.id, concept.id, [
      lessonMessage("event", `Detour queued · ${remedial.label}`),
    ]);
  } else if (grade.adjustment === "skip_next") {
    const skipped = await skipNextConcept(session, state.concepts);
    if (skipped) {
      await appendLessonMessages(session.id, concept.id, [
        lessonMessage("event", `${skipped.label} marked known · skipped`),
      ]);
    }
  }

  if (grade.verdict === "pass") {
    await unlockConcept(concept.id);
    const refreshed = await getSessionState(session.id);
    await advanceToNextConcept(refreshed.session!, refreshed.concepts);
  } else {
    // A fail returns to open conversation and can be retried right away —
    // keep a fresh mastery Check primed for that, the same as any other
    // turn (see @/lib/checks).
    const { question } = await generateMasteryCheck({
      topic: session.topic,
      concept: { label: concept.label, summary: concept.summary },
      lesson: {
        messages: [
          ...lesson.messages,
          lessonMessage("check-answer", answer.trim(), check.id),
          lessonMessage("check-feedback", grade.feedback, check.id),
        ],
      },
    });
    await saveMasteryCheck(session.id, concept.id, question);
  }

  return Response.json(await getSessionState(session.id));
}
