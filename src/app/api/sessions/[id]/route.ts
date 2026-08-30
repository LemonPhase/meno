import { graphIdFrom, unauthorized } from "@/lib/auth";
import { getSessionRecord } from "@/lib/store";

type Context = { params: Promise<{ id: string }> };

/** One Session's full state: session, Concepts, Checks, Lessons. */
export async function GET(request: Request, { params }: Context) {
  const graphId = await graphIdFrom(request);
  if (!graphId) return unauthorized();
  const { id } = await params;
  // Another user's Session id simply isn't in this Graph, so it 404s here
  // the same way a made-up one does — no ownership check to forget.
  const record = await getSessionRecord(id, graphId);
  if (!record) {
    return Response.json({ error: "no such Session" }, { status: 404 });
  }
  return Response.json(record);
}
