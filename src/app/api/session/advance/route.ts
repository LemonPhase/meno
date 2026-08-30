import { sessionIdFrom } from "@/lib/api";
import { graphIdFrom, unauthorized } from "@/lib/auth";
import { passedCheck } from "@/lib/checks";
import { advanceToNextConcept } from "@/lib/progression";
import { getSessionState } from "@/lib/store";

/**
 * Move the Session to its next Concept: out of the Path preview into
 * Learning, or on from the Active Concept once its mastery Check is passed.
 *
 * Passing the Check does not move anyone by itself — it only earns this
 * request. The learner stays as long as they like, asking whatever they
 * still want to ask, and leaves when they are ready; the Unlock happens
 * here, on the way out.
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

  if (session?.phase === "previewing") {
    if (
      !(await advanceToNextConcept(session, state.concepts, null, graphId))
    ) {
      return Response.json(
        { error: "this Session has already started Learning" },
        { status: 409 },
      );
    }
    return Response.json(await getSessionState(session.id, graphId));
  }

  if (session?.phase === "learning" && session.activeConceptId) {
    if (!passedCheck(state.checks, session.activeConceptId)) {
      return Response.json(
        { error: "the Active Concept's mastery Check is not passed" },
        { status: 409 },
      );
    }
    // The move is one guarded commit — the Unlock included — so a duplicate
    // press is refused rather than activating the next Concept a second time
    // over the first one's Lesson.
    const moved = await advanceToNextConcept(
      session,
      state.concepts,
      session.activeConceptId,
      graphId,
    );
    if (!moved) {
      return Response.json(
        { error: "this Concept has already been left" },
        { status: 409 },
      );
    }
    return Response.json(await getSessionState(session.id, graphId));
  }

  return Response.json(
    { error: "no Session ready to move forward" },
    { status: 409 },
  );
}
