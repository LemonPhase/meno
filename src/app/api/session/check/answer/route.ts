import { gradeMasteryCheck } from "@/ai/lesson";
import { sessionIdFrom } from "@/lib/api";
import { revealedCheck } from "@/lib/checks";
import {
  appendLessonMessages,
  formatEditContext,
  getSessionState,
  getRecentEdits,
  lessonMessage,
  nextLockedConcept,
  claimCheckResult,
  saveMasteryCheck,
  skipNextConcept,
  spliceRemedialConcept,
} from "@/lib/store";

/**
 * Answer the pending mastery Check. Either verdict ends here, in feedback:
 * a fail primes the same question for another attempt, a pass offers the
 * move to the next Concept without taking it. Leaving is the learner's to
 * choose and is its own request — see the advance route.
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

  // The Check is answered once. Claiming it before anything else is written
  // keeps a second answer in flight from grading into the same transcript
  // and applying a second Adjustment off the same stale Session.
  if (!(await claimCheckResult(check.id, answer.trim(), grade.verdict))) {
    return Response.json(
      { error: "this Check has already been answered" },
      { status: 409 },
    );
  }
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
    // The skip rides a pass only. Each Concept on the Path is a prerequisite
    // of the one after it, so an answer that fails this Concept while
    // seeming to know the next says the Path is wrong — not that the learner
    // may move past it. Attempts are uncapped and re-ask the same question,
    // so honouring it on fails also let three failures unlock three untaught
    // Concepts, Graph-wide and for good. See ADR-0001's 2026-08-30 addendum.
  } else if (grade.adjustment === "skip_next" && grade.verdict === "pass") {
    const skipped = await skipNextConcept(session, state.concepts);
    if (skipped) {
      await appendLessonMessages(session.id, concept.id, [
        lessonMessage("event", `${skipped.label} marked known · skipped`),
      ]);
    }
  }

  // A fail returns to open conversation and can be attempted again right
  // away: the Concept's one question is primed afresh, unchanged, with this
  // attempt and its feedback now standing above it in the Lesson.
  if (grade.verdict !== "pass") {
    await saveMasteryCheck(session.id, concept.id, check.question);
  }

  return Response.json(await getSessionState(session.id));
}
