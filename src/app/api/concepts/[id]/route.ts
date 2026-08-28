import { advanceToNextConcept } from "@/lib/progression";
import {
  deleteConcept,
  getConcept,
  getCurrentState,
  renameConcept,
} from "@/lib/store";

type Context = { params: Promise<{ id: string }> };

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
  const state = await getCurrentState();
  const concept =
    state.concepts.find((c) => c.id === id) ?? (await getConcept(id));
  if (!concept) {
    return Response.json({ error: "no such Concept" }, { status: 404 });
  }

  await renameConcept(concept, label.trim());
  return Response.json(await getCurrentState());
}

/**
 * Delete a Concept (ADR-0003: never blocks, never cascades). Deleting the
 * Active Concept hands off to the next Locked one (or completes the Path).
 */
export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params;
  const state = await getCurrentState();
  const concept =
    state.concepts.find((c) => c.id === id) ?? (await getConcept(id));
  if (!concept || !state.session) {
    return Response.json({ error: "no such Concept" }, { status: 404 });
  }

  const { wasActive } = await deleteConcept(state.session, concept);

  if (wasActive && state.session.phase === "learning") {
    const refreshed = await getCurrentState();
    await advanceToNextConcept(refreshed.session!, refreshed.concepts);
  }

  return Response.json(await getCurrentState());
}
