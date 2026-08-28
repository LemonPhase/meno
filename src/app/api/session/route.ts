import { investigateTopic } from "@/ai/investigate";
import { generateDiagnostic } from "@/ai/diagnose";
import { sessionIdFrom } from "@/lib/api";
import {
  createSession,
  formatEditContext,
  getGraphOverview,
  getRecentEdits,
  getSessionState,
  saveDiagnosticChecks,
  saveInvestigation,
} from "@/lib/store";

/**
 * Start a Session: investigate the Topic — attaching to Concepts already in
 * the Graph rather than duplicating them — and generate the diagnostic
 * Checks. Concepts the Graph already holds as Unlocked are "already yours":
 * they skip both the diagnostic and the Path.
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

  const graph = await getGraphOverview();
  const session = await createSession(topic.trim());
  const investigation = await investigateTopic({
    topic: topic.trim(),
    editContext: formatEditContext(await getRecentEdits()),
    existing: graph.concepts.map((c) => ({
      id: c.id,
      label: c.label,
      summary: c.summary,
      unlocked: c.unlocked,
    })),
  });
  const { session: updated, concepts } = await saveInvestigation(
    session,
    investigation,
  );

  // Already-Unlocked Concepts are settled knowledge — re-diagnosing them
  // would distrust the learner's own Graph.
  const toProbe = concepts.filter((c) => !c.unlocked);
  if (toProbe.length > 0) {
    const diagnostic = await generateDiagnostic({
      topic: updated.topic,
      concepts: toProbe.map(({ id, label, summary }) => ({
        id,
        label,
        summary,
      })),
    });
    await saveDiagnosticChecks(updated.id, diagnostic.questions);
  }

  return Response.json(await getSessionState(updated.id));
}

/** One Session's state — by `?session=`, else the one the app opens on. */
export async function GET(request?: Request) {
  return Response.json(await getSessionState(sessionIdFrom(request)));
}
