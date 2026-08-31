import { gradeMasteryCheck } from "@/ai/lesson";
import { sessionIdFrom } from "@/lib/api";
import { graphIdFrom, unauthorized } from "@/lib/auth";
import { revealedCheck } from "@/lib/checks";
import { divertToRemedial } from "@/lib/progression";
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
  taughtHere,
} from "@/lib/store";
import type { Concept } from "@/lib/types";

/**
 * Answer the pending mastery Check. Either verdict ends here, in feedback:
 * a fail primes the same question for another attempt, a pass offers the
 * move to the next Concept without taking it. Leaving is the learner's to
 * choose and is its own request — see the advance route.
 */
export async function POST(request: Request) {
  const graphId = await graphIdFrom(request);
  if (!graphId) return unauthorized();

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

  const state = await getSessionState(sessionIdFrom(request, body), graphId);
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
  // What comes next is offered to the grader so a passing answer that
  // demonstrates it can skip it — but a Concept this Session already taught
  // is not that. Mid-detour the next thing is the Concept the learner was
  // pulled off, and inviting a skip of it would hand them, for good, the one
  // thing on the Path they have just failed.
  const onward = next && !taughtHere(state.lessons, next.id) ? next : null;
  const grade = await gradeMasteryCheck({
    topic: session.topic,
    concept: { label: concept.label, summary: concept.summary },
    nextConcept:
      onward && onward.id !== concept.id
        ? { label: onward.label, summary: onward.summary }
        : null,
    lesson: { messages: lesson.messages },
    question: check.question,
    answer: answer.trim(),
    editContext: formatEditContext(await getRecentEdits(graphId)),
  });

  // The Check is answered once. Claiming it before anything else is written
  // keeps a second answer in flight from grading into the same transcript
  // and applying a second Adjustment off the same stale Session.
  if (!(await claimCheckResult(check.id, answer.trim(), grade.verdict, graphId))) {
    return Response.json(
      { error: "this Check has already been answered" },
      { status: 409 },
    );
  }
  await appendLessonMessages(
    session.id,
    concept.id,
    [
      lessonMessage("check-answer", answer.trim(), check.id),
      lessonMessage("check-feedback", grade.feedback, check.id),
    ],
    undefined,
    graphId,
  );

  // ADR-0001: the bounded Adjustment rides on the grading result, and is
  // recorded in the Lesson so the transcript explains itself later.
  // A detour is one level deep. Attempts are uncapped and re-ask the same
  // question (CONTEXT.md, Check), so a learner having a hard time on a
  // remedial could otherwise draw a fresh remedial from every attempt and be
  // walked steadily further under the Concept they came for — which is the
  // unbounded replanning ADR-0001 exists to prevent, arrived at one bounded
  // step at a time. The gap under a gap is where the agent stops guessing;
  // the learner can still ask for one themselves with Break it down.
  const onDetour =
    session.path.find((e) => e.conceptId === concept.id)?.origin === "remedial";

  let divert: { remedial: Concept } | null = null;
  if (grade.adjustment === "insert_remedial" && grade.remedial && !onDetour) {
    // On a fail the learner is stuck on this Concept right now, so the gap
    // goes in front of it and is taught at once. On a pass they are through
    // it and stay where a pass always leaves them — the remedial follows the
    // Concept it came out of, and is simply next when they choose to move.
    const blocked = grade.verdict !== "pass";
    const remedial = await spliceRemedialConcept(
      session,
      concept,
      grade.remedial,
      blocked ? "before" : "after",
      graphId,
    );
    if (blocked) divert = { remedial };
    else {
      await appendLessonMessages(
        session.id,
        concept.id,
        [lessonMessage("event", `Detour queued · ${remedial.label}`)],
        undefined,
        graphId,
      );
    }
    // The skip rides a pass only. Each Concept on the Path is a prerequisite
    // of the one after it, so an answer that fails this Concept while
    // seeming to know the next says the Path is wrong — not that the learner
    // may move past it. Attempts are uncapped and re-ask the same question,
    // so honouring it on fails also let three failures unlock three untaught
    // Concepts, Graph-wide and for good. See ADR-0001's 2026-08-30 addendum.
  } else if (grade.adjustment === "skip_next" && grade.verdict === "pass") {
    const skipped = await skipNextConcept(
      session,
      state.concepts,
      state.lessons,
      graphId,
    );
    if (skipped) {
      await appendLessonMessages(
        session.id,
        concept.id,
        [lessonMessage("event", `${skipped.label} marked known · skipped`)],
        undefined,
        graphId,
      );
    }
  }

  // A fail returns to open conversation and can be attempted again right
  // away: the Concept's one question is primed afresh, unchanged, with this
  // attempt and its feedback now standing above it in the Lesson.
  if (grade.verdict !== "pass") {
    await saveMasteryCheck(session.id, concept.id, check.question, graphId);
  }

  // Last, so the Concept being left is already complete — its answer, its
  // feedback, and its question primed afresh for the attempt the learner
  // will make when they come back to it. The note saying where they went is
  // written after the move, and only says they went if they did: a divert
  // refused because another tab moved this Session must not leave a
  // transcript claiming otherwise.
  if (divert) {
    const moved = await divertToRemedial(
      session,
      concept,
      divert.remedial,
      state.concepts,
      grade.feedback,
      graphId,
    );
    await appendLessonMessages(
      session.id,
      concept.id,
      [
        lessonMessage(
          "event",
          moved
            ? `Detour · ${divert.remedial.label} first`
            : `Detour queued · ${divert.remedial.label}`,
        ),
      ],
      undefined,
      graphId,
    );
  }

  return Response.json(await getSessionState(session.id, graphId));
}
