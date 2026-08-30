import { sessionIdFrom } from "@/lib/api";
import { graphIdFrom, unauthorized } from "@/lib/auth";
import {
  deleteConcept,
  getGraphOverview,
  getSessionState,
  renameConcept,
  sessionsLearning,
} from "@/lib/store";

type Context = { params: Promise<{ id: string }> };

async function conceptById(id: string, graphId: string) {
  const graph = await getGraphOverview(graphId);
  return graph.concepts.find((c) => c.id === id) ?? null;
}

/** Rename a Concept (any status); recorded append-only as an Edit. */
export async function PATCH(request: Request, { params }: Context) {
  const graphId = await graphIdFrom(request);
  if (!graphId) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const label = body.label;
  if (typeof label !== "string" || label.trim() === "") {
    return Response.json({ error: "label is required" }, { status: 400 });
  }

  const { id } = await params;
  const concept = await conceptById(id, graphId);
  if (!concept) {
    return Response.json({ error: "no such Concept" }, { status: 404 });
  }

  await renameConcept(concept, label.trim(), graphId);
  return Response.json(
    await getSessionState(sessionIdFrom(request, body), graphId),
  );
}

/**
 * Delete a Concept (ADR-0003: never cascades). Refused while it is being
 * learned: a Session mid-Lesson on a Concept that vanished has no honest
 * state to be in — finish or skip it there first.
 */
export async function DELETE(request: Request, { params }: Context) {
  const graphId = await graphIdFrom(request);
  if (!graphId) return unauthorized();

  const { id } = await params;
  const concept = await conceptById(id, graphId);
  if (!concept) {
    return Response.json({ error: "no such Concept" }, { status: 404 });
  }

  const learning = await sessionsLearning(id, graphId);
  if (learning.length > 0) {
    return Response.json(
      {
        error: `“${concept.label}” is being learned in “${learning[0].topic}” — finish or skip it there first`,
      },
      { status: 409 },
    );
  }

  await deleteConcept(concept, graphId);
  // The viewed Session, not merely the newest: an Edit made from one
  // Session must not hand back another Session's state.
  return Response.json(
    await getSessionState(sessionIdFrom(request), graphId),
  );
}
