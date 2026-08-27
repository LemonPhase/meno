import { advanceToNextConcept } from "@/lib/progression";
import { getCurrentState } from "@/lib/store";

/** Leave the Path preview and start Learning (or Complete an empty Path). */
export async function POST() {
  const state = await getCurrentState();
  if (!state.session || state.session.phase !== "previewing") {
    return Response.json(
      { error: "no Session in the Previewing phase" },
      { status: 409 },
    );
  }

  await advanceToNextConcept(state.session, state.concepts);
  return Response.json(await getCurrentState());
}
