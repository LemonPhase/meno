import { breakDownConcept } from "@/ai/lesson";
import { sessionIdFrom } from "@/lib/api";
import { graphIdFrom, unauthorized } from "@/lib/auth";
import { passedCheck } from "@/lib/checks";
import { divertToRemedial } from "@/lib/progression";
import {
  appendLessonMessages,
  formatEditContext,
  getRecentEdits,
  getSessionState,
  lessonMessage,
  spliceRemedialConcept,
} from "@/lib/store";

/**
 * "Break it down": the learner says the Active Concept is too hard. Answered
 * with an insert_remedial Adjustment (ADR-0001) — the Concept itself is
 * never restructured — or, when the transcript gives nothing to go on, with
 * a single question.
 *
 * The remedial is spliced in *before* the Concept it unblocks and taught at
 * once. Too hard means a prerequisite is missing, and the learner is stuck
 * on it now: a detour queued behind the Concept it holds up would arrive
 * only once they had already got past it on their own. The Concept they are
 * pulled off keeps everything — its Lesson, its unanswered Check, its Locked
 * status — and is the next thing on the Path when the detour is passed.
 */
export async function POST(request: Request) {
  const graphId = await graphIdFrom(request);
  if (!graphId) return unauthorized();

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const state = await getSessionState(sessionIdFrom(request, body), graphId);
  const { session } = state;
  if (!session || session.phase !== "learning" || !session.activeConceptId) {
    return Response.json(
      { error: "no Active Concept to break down" },
      { status: 409 },
    );
  }

  const concept = state.concepts.find((c) => c.id === session.activeConceptId)!;
  // "Too hard" is not something a passed Concept can be. Splicing a
  // prerequisite in front of one the learner has just demonstrated teaches
  // them the foundations of something they already hold — and the request
  // can only come from a client that has not seen the pass yet, which is a
  // stale client, not a learner asking. Test me is refused here too.
  if (passedCheck(state.checks, concept.id)) {
    return Response.json(
      { error: "this Concept's mastery Check is already passed" },
      { status: 409 },
    );
  }
  const lesson = state.lessons.find(
    (l) => l.conceptId === session.activeConceptId,
  )!;

  const outcome = await breakDownConcept({
    topic: session.topic,
    concept: { label: concept.label, summary: concept.summary },
    lesson: { messages: lesson.messages },
    unlockedLabels: state.concepts.filter((c) => c.unlocked).map((c) => c.label),
    editContext: formatEditContext(await getRecentEdits(graphId)),
  });

  const asked = lessonMessage("user", "This is too hard — break it down.");

  if (outcome.action === "insert_remedial" && outcome.remedial) {
    const remedial = await spliceRemedialConcept(
      session,
      concept,
      outcome.remedial,
      // Nothing is passed here — the route refuses that above — so the
      // prerequisite always goes in front of what it unblocks.
      "before",
      graphId,
    );
    // The move first, then the note that describes it: a divert refused
    // because another tab moved this Session, or a generation that threw,
    // must not leave a transcript claiming the learner went somewhere they
    // did not. The remedial is on the Path in front of the Concept it
    // unblocks either way, so it is still the next thing taught.
    const moved = await divertToRemedial(
      session,
      concept,
      remedial,
      state.concepts,
      outcome.message,
      graphId,
    );
    await appendLessonMessages(
      session.id,
      concept.id,
      moved
        ? [asked, lessonMessage("event", `Detour · ${remedial.label} first`)]
        : [
            asked,
            lessonMessage("reply", outcome.message),
            lessonMessage("event", `Detour queued · ${remedial.label}`),
          ],
      undefined,
      graphId,
    );
    return Response.json(await getSessionState(session.id, graphId));
  }

  await appendLessonMessages(
    session.id,
    concept.id,
    [asked, lessonMessage("reply", outcome.message)],
    undefined,
    graphId,
  );
  return Response.json(await getSessionState(session.id, graphId));
}
