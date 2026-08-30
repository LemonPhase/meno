import { graphIdFrom, unauthorized } from "@/lib/auth";
import { listSessions } from "@/lib/store";

/** All Sessions newest-first with Path progress — the sidebar's data. */
export async function GET(request: Request) {
  const graphId = await graphIdFrom(request);
  if (!graphId) return unauthorized();
  return Response.json({ sessions: await listSessions(graphId) });
}
