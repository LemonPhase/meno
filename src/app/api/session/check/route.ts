import { generateMasteryCheck } from "@/ai/lesson";
import { sessionIdFrom } from "@/lib/api";
import {
  appendLessonMessages,
  getSessionState,
  lessonMessage,
  saveMasteryCheck,
} from "@/lib/store";

/**
 * The user asks to be tested on the Active Concept — the "too easy" route
 * as much as the ready-to-be-tested one. Idempotent: a mastery Check
 * already pending is returned rather than regenerated.
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
  await appendLessonMessages(session.id, concept.id, [
    lessonMessage("check-question", question, check.id),
  ]);

  return Response.json(await getSessionState(session.id));
}
