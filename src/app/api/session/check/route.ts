import { generateMasteryCheck } from "@/ai/lesson";
import {
  appendLessonMessages,
  getCurrentState,
  lessonMessage,
  saveMasteryCheck,
} from "@/lib/store";

/**
 * The user asks to be tested on the Active Concept. Idempotent: if a
 * mastery Check is already pending, it's returned rather than regenerated.
 */
export async function POST() {
  const state = await getCurrentState();
  const { session } = state;
  if (!session || session.phase !== "learning" || !session.activeConceptId) {
    return Response.json(
      { error: "no Active Concept to check" },
      { status: 409 },
    );
  }

  const pending = state.checks.find(
    (c) =>
      c.phase === "mastery" &&
      c.conceptIds.includes(session.activeConceptId!) &&
      c.verdict === null,
  );
  if (pending) return Response.json(state);

  const concept = state.concepts.find((c) => c.id === session.activeConceptId)!;
  const lesson = state.lessons.find(
    (l) => l.conceptId === session.activeConceptId,
  )!;

  const { question } = await generateMasteryCheck({
    topic: session.topic,
    concept: { label: concept.label, summary: concept.summary },
    lesson: { messages: lesson.messages },
  });

  const check = await saveMasteryCheck(session.id, concept.id, question);
  await appendLessonMessages(concept.id, [
    lessonMessage("check-question", question, check.id),
  ]);

  return Response.json(await getCurrentState());
}
