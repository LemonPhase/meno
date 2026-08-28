import { getSessionRecord } from "@/lib/store";

type Context = { params: Promise<{ id: string }> };

/** One Session's full record: session, Concepts, Checks, Lessons. */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  const record = await getSessionRecord(id);
  if (!record) {
    return Response.json({ error: "no such Session" }, { status: 404 });
  }
  return Response.json(record);
}
