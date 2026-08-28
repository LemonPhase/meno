import { lessonReply } from "@/ai/lesson";
import { sessionIdFrom } from "@/lib/api";
import {
  appendLessonMessages,
  getSessionState,
  lessonMessage,
} from "@/lib/store";

/** Free-form conversation within the Active Concept's Lesson. */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { message } = body;
  if (typeof message !== "string" || message.trim() === "") {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  const state = await getSessionState(sessionIdFrom(request, body));
  const { session } = state;
  if (!session || session.phase !== "learning" || !session.activeConceptId) {
    return Response.json(
      { error: "no Active Concept to converse about" },
      { status: 409 },
    );
  }

  const concept = state.concepts.find((c) => c.id === session.activeConceptId)!;
  const lesson = state.lessons.find(
    (l) => l.conceptId === session.activeConceptId,
  )!;

  const { reply } = await lessonReply({
    topic: session.topic,
    concept: { label: concept.label, summary: concept.summary },
    lesson: { messages: lesson.messages },
    message: message.trim(),
  });

  await appendLessonMessages(session.id, concept.id, [
    lessonMessage("user", message.trim()),
    lessonMessage("reply", reply),
  ]);

  return Response.json(await getSessionState(session.id));
}
