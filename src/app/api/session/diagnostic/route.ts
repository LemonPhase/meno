import { gradeDiagnostic } from "@/ai/diagnose";
import { applyDiagnosis, getCurrentState } from "@/lib/store";

/**
 * Submit all diagnostic answers at once. Grades them in one call, unlocks
 * the Concepts the user already knows (Skipped), linearizes the rest into
 * the Path, and lands the Session in Previewing.
 */
export async function POST(request: Request) {
  let answers: unknown;
  try {
    ({ answers } = await request.json());
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
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

  const state = await getCurrentState();
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

  const { knownConceptIds } = await gradeDiagnostic({
    topic: state.session.topic,
    concepts: state.concepts.map(({ id, label, summary }) => ({
      id,
      label,
      summary,
    })),
    answers: graded.map((a) => ({
      question: checkById.get(a.checkId)!.question,
      answer: a.answer,
    })),
  });

  await applyDiagnosis(state.session, knownConceptIds, graded);
  return Response.json(await getCurrentState());
}
