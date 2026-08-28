import {
  deleteConcept,
  getGraphOverview,
  getSessionState,
  renameConcept,
  sessionsLearning,
} from "@/lib/store";

type Context = { params: Promise<{ id: string }> };

async function conceptById(id: string) {
  const graph = await getGraphOverview();
  return graph.concepts.find((c) => c.id === id) ?? null;
}

/** Rename a Concept (any status); recorded append-only as an Edit. */
export async function PATCH(request: Request, { params }: Context) {
  let label: unknown;
  try {
    ({ label } = await request.json());
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof label !== "string" || label.trim() === "") {
    return Response.json({ error: "label is required" }, { status: 400 });
  }

  const { id } = await params;
  const concept = await conceptById(id);
  if (!concept) {
    return Response.json({ error: "no such Concept" }, { status: 404 });
  }

  await renameConcept(concept, label.trim());
  return Response.json(await getSessionState());
}

/**
 * Delete a Concept (ADR-0003: never cascades). Refused while it is being
 * learned: a Session mid-Lesson on a Concept that vanished has no honest
 * state to be in — finish or skip it there first.
 */
export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params;
  const concept = await conceptById(id);
  if (!concept) {
    return Response.json({ error: "no such Concept" }, { status: 404 });
  }

  const learning = await sessionsLearning(id);
  if (learning.length > 0) {
    return Response.json(
      {
        error: `“${concept.label}” is being learned in “${learning[0].topic}” — finish or skip it there first`,
      },
      { status: 409 },
    );
  }

  await deleteConcept(concept);
  return Response.json(await getSessionState());
}
