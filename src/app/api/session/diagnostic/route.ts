import { gradeDiagnostic } from "@/ai/diagnose";
import { sessionIdFrom } from "@/lib/api";
import { graphIdFrom, unauthorized } from "@/lib/auth";
import { applyDiagnosis, getSessionState } from "@/lib/store";

/**
 * Submit all diagnostic answers at once. Grades them in one call, unlocks
 * the Concepts the user already knows (Skipped), linearizes the rest into
 * the Path, and lands the Session in Previewing.
 */
export async function POST(request: Request) {
  const graphId = await graphIdFrom(request);
  if (!graphId) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { answers } = body;
  if (
    !Array.isArray(answers) ||
    answers.some(
      (a) => typeof a?.checkId !== "string" || typeof a?.answer !== "string",
    )
  ) {
    return Response.json(
      { error: "answers must be [{checkId, answer}]" },
      { status: 400 },
    );
  }

  const state = await getSessionState(sessionIdFrom(request, body), graphId);
  if (!state.session || state.session.phase !== "diagnosing") {
    return Response.json(
      { error: "no Session in the Diagnosing phase" },
      { status: 409 },
    );
  }

  const checkById = new Map(state.checks.map((c) => [c.id, c]));
  const graded = (answers as { checkId: string; answer: string }[]).filter(
    (a) => checkById.has(a.checkId),
  );
  const toProbe = state.concepts.filter((c) => !c.unlocked);

  const { knownConceptIds } =
    graded.length > 0 && toProbe.length > 0
      ? await gradeDiagnostic({
          topic: state.session.topic,
          concepts: toProbe.map(({ id, label, summary }) => ({
            id,
            label,
            summary,
          })),
          answers: graded.map((a) => ({
            question: checkById.get(a.checkId)!.question,
            answer: a.answer,
          })),
        })
      : { knownConceptIds: [] };

  await applyDiagnosis(state.session, knownConceptIds, graded, graphId);
  return Response.json(await getSessionState(state.session.id, graphId));
}
