import { listSessions } from "@/lib/store";

/** All Sessions newest-first with Path progress — the sidebar's data. */
export async function GET() {
  return Response.json({ sessions: await listSessions() });
}
