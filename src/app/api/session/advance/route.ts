import { sessionIdFrom } from "@/lib/api";
import { advanceToNextConcept } from "@/lib/progression";
import { getSessionState } from "@/lib/store";

/** Leave the Path preview and start Learning (or Complete an empty Path). */
export async function POST(request?: Request) {
  const state = await getSessionState(sessionIdFrom(request));
  if (!state.session || state.session.phase !== "previewing") {
    return Response.json(
      { error: "no Session in the Previewing phase" },
      { status: 409 },
    );
  }

  await advanceToNextConcept(state.session, state.concepts);
  return Response.json(await getSessionState(state.session.id));
}
