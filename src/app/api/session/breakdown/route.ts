import { breakDownConcept } from "@/ai/lesson";
import { sessionIdFrom } from "@/lib/api";
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
 */
export async function POST(request?: Request) {
  let body: Record<string, unknown> = {};
  if (request) {
    try {
      body = await request.json();
    } catch {
      body = {};
    }
  }

  const state = await getSessionState(sessionIdFrom(request, body));
  const { session } = state;
  if (!session || session.phase !== "learning" || !session.activeConceptId) {
    return Response.json(
      { error: "no Active Concept to break down" },
      { status: 409 },
    );
  }

  const concept = state.concepts.find((c) => c.id === session.activeConceptId)!;
  const lesson = state.lessons.find(
    (l) => l.conceptId === session.activeConceptId,
  )!;

  const outcome = await breakDownConcept({
    topic: session.topic,
    concept: { label: concept.label, summary: concept.summary },
    lesson: { messages: lesson.messages },
    unlockedLabels: state.concepts.filter((c) => c.unlocked).map((c) => c.label),
    editContext: formatEditContext(await getRecentEdits()),
  });

  const messages = [
    lessonMessage("user", "This is too hard — break it down."),
    lessonMessage("reply", outcome.message),
  ];

  if (outcome.action === "insert_remedial" && outcome.remedial) {
    const remedial = await spliceRemedialConcept(
      session,
      concept,
      state.concepts,
      outcome.remedial,
    );
    messages.push(lessonMessage("event", `Detour queued · ${remedial.label}`));
  }

  await appendLessonMessages(session.id, concept.id, messages);
  return Response.json(await getSessionState(session.id));
}
