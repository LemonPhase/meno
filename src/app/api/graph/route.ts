import { graphIdFrom, unauthorized } from "@/lib/auth";
import { getGraphOverview } from "@/lib/store";

/** The whole Graph — Concepts across all Sessions, plus context. */
export async function GET(request: Request) {
  const graphId = await graphIdFrom(request);
  if (!graphId) return unauthorized();
  return Response.json(await getGraphOverview(graphId));
}
