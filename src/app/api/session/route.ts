import { investigateTopic } from "@/ai/investigate";
import { createSession, getCurrentState, saveInvestigation } from "@/lib/store";

/** Start a Session: investigate the Topic and seed the Graph with Concepts. */
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
  const investigation = await investigateTopic({ topic: topic.trim() });
  const result = await saveInvestigation(session, investigation);

  return Response.json(result);
}

/** Current state: the latest Session and its Concepts. */
export async function GET() {
  return Response.json(await getCurrentState());
}
