import { generateMasteryCheck } from "@/ai/lesson";
import { sessionIdFrom } from "@/lib/api";
import { primedCheck, revealedCheck } from "@/lib/checks";
import {
  appendLessonMessages,
  getSessionState,
  lessonMessage,
  saveMasteryCheck,
} from "@/lib/store";

/**
 * The user asks to be tested on the Active Concept — the "too easy" route
 * as much as the ready-to-be-tested one. Idempotent: a mastery Check
 * already revealed is returned rather than regenerated. The common case is
 * a Check already primed (kept current turn by turn — see @/lib/checks),
 * so this just reveals it; generating one here is only a fallback.
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

  const concept = state.concepts.find((c) => c.id === session.activeConceptId)!;
  const lesson = state.lessons.find(
    (l) => l.conceptId === session.activeConceptId,
  )!;

  if (revealedCheck(state.checks, lesson.messages, concept.id)) {
    return Response.json(state);
  }

  let check = primedCheck(state.checks, lesson.messages, concept.id);
  if (!check) {
    const { question } = await generateMasteryCheck({
      topic: session.topic,
      concept: { label: concept.label, summary: concept.summary },
      lesson: { messages: lesson.messages },
    });
    check = await saveMasteryCheck(session.id, concept.id, question);
  }

  await appendLessonMessages(session.id, concept.id, [
    lessonMessage("check-question", check.question, check.id),
  ]);

  return Response.json(await getSessionState(session.id));
}
