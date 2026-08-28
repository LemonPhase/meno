import { getGraphOverview } from "@/lib/store";

/** The whole Graph — Concepts across all Sessions, plus context. */
export async function GET() {
  return Response.json(await getGraphOverview());
}
