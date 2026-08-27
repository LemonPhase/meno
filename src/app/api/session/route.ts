import { investigateTopic } from "@/ai/investigate";
import { generateDiagnostic } from "@/ai/diagnose";
import {
  createSession,
  formatEditContext,
  getCurrentState,
  getRecentEdits,
  saveDiagnosticChecks,
  saveInvestigation,
} from "@/lib/store";

/**
 * Start a Session: investigate the Topic, seed the Graph with Concepts,
 * and generate the diagnostic Checks the user will answer next.
 */
export async function POST(request: Request) {
  let topic: unknown;
  try {
    ({ topic } = await request.json());
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof topic !== "string" || topic.trim() === "") {
    return Response.json({ error: "topic is required" }, { status: 400 });
  }

  const session = await createSession(topic.trim());
  const investigation = await investigateTopic({
    topic: topic.trim(),
    editContext: formatEditContext(await getRecentEdits()),
  });
  const { session: updated, concepts } = await saveInvestigation(
    session,
    investigation,
  );

  const diagnostic = await generateDiagnostic({
    topic: updated.topic,
    concepts: concepts.map(({ id, label, summary }) => ({
      id,
      label,
      summary,
    })),
  });
  await saveDiagnosticChecks(updated.id, diagnostic.questions);

  return Response.json(await getCurrentState());
}

/** Current state: the latest Session, its Concepts and Checks. */
export async function GET() {
  return Response.json(await getCurrentState());
}
