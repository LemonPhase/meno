import { generateMasteryCheck } from "@/ai/lesson";
import { sessionIdFrom } from "@/lib/api";
import {
  conceptQuestion,
  passedCheck,
  primedCheck,
  revealedCheck,
} from "@/lib/checks";
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
 * a Check already primed with the exposition (see @/lib/checks), so this
 * just reveals it; generating one here is the fallback for a Concept that
 * has none — a Lesson from before Checks were primed, or one whose primed
 * Check was lost.
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
  // Already passed: there is one question per Concept and it has been
  // answered. Returning the state unchanged keeps this idempotent rather
  // than quietly inventing a second question.
  if (passedCheck(state.checks, concept.id)) {
    return Response.json(state);
  }

  let check = primedCheck(state.checks, lesson.messages, concept.id);
  if (!check) {
    // A Concept keeps its question. Writing a new one is only for a Concept
    // that has never had a Check at all — a Lesson from before Checks were
    // primed. Anything else re-primes what it already asked, so the "never
    // rewritten" invariant does not depend on nothing having gone wrong.
    const question =
      conceptQuestion(state.checks, concept.id) ??
      (
        await generateMasteryCheck({
          topic: session.topic,
          concept: { label: concept.label, summary: concept.summary },
          // The exposition only, never the conversation around it: this is
          // the one path that can still write a Concept's first question,
          // so it is the one that must not let what was asked set the bar.
          lesson: {
            messages: lesson.messages.filter((m) => m.kind === "exposition"),
          },
        })
      ).question;
    check = await saveMasteryCheck(session.id, concept.id, question);
  }

  await appendLessonMessages(
    session.id,
    concept.id,
    [lessonMessage("check-question", check.question, check.id)],
    check.id,
  );

  return Response.json(await getSessionState(session.id));
}
