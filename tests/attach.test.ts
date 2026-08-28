import { beforeEach, describe, expect, it } from "vitest";
import { clearScriptedResponses, scriptModelResponse } from "@/ai/scripted";
import { GET } from "@/app/api/session/route";
import { POST as postDiagnostic } from "@/app/api/session/diagnostic/route";
import { POST as postAdvance } from "@/app/api/session/advance/route";
import { POST as postCheck } from "@/app/api/session/check/route";
import { POST as postAnswer } from "@/app/api/session/check/answer/route";
import { db } from "@/lib/firebase-admin";
import { graphRef } from "@/lib/store";
import {
  jsonRequest,
  startInvestigatedSession,
  startOverlappingSession,
  type StateBody,
} from "./helpers";

// Attach (CONTEXT.md): a second Topic resting on the same idea meets the
// same Concept, rather than a duplicate — and an attached Concept the
// learner has already Unlocked skips both the diagnostic and the Path.

beforeEach(async () => {
  clearScriptedResponses();
  await db.recursiveDelete(graphRef());
});

const byLabel = (s: StateBody, label: string) =>
  s.concepts.find((c) => c.label === label)!;

async function graphSize() {
  return (await graphRef().collection("concepts").get()).size;
}

describe("Attach", () => {
  it("reuses an existing Concept instead of creating a duplicate", async () => {
    const first = await startInvestigatedSession();
    const softmax = byLabel(first, "Softmax");
    expect(await graphSize()).toBe(3);

    const second = await startOverlappingSession();

    // One new Concept only; the overlapping one is the very same document.
    expect(await graphSize()).toBe(4);
    expect(byLabel(second, "Softmax").id).toBe(softmax.id);
    expect(byLabel(second, "Softmax").originSessionId).toBe(first.session.id);
    expect(byLabel(second, "Cross entropy").requires).toEqual([softmax.id]);
  });

  it("keeps an attached Concept off the diagnostic and Path once Unlocked", async () => {
    const first = await startInvestigatedSession();
    const softmax = byLabel(first, "Softmax");
    // The learner already knew Softmax, so it goes straight into the Graph.
    scriptModelResponse(JSON.stringify({ knownConceptIds: [softmax.id] }));
    await postDiagnostic(
      jsonRequest("/api/session/diagnostic", {
        answers: first.checks.map((c) => ({ checkId: c.id, answer: "yes" })),
      }),
    );

    const second = await startOverlappingSession();

    // Settled knowledge is not re-probed: only the new Concept is asked about.
    expect(second.checks).toHaveLength(1);
    expect(second.checks[0].conceptIds).toEqual([
      byLabel(second, "Cross entropy").id,
    ]);
    expect(byLabel(second, "Softmax").status).toBe("unlocked");
    expect(byLabel(second, "Softmax").skipped).toBe(true);

    // And it never joins the new Session's Path.
    scriptModelResponse(JSON.stringify({ knownConceptIds: [] }));
    const graded: StateBody = await (
      await postDiagnostic(
        jsonRequest("/api/session/diagnostic", {
          sessionId: second.session.id,
          answers: second.checks.map((c) => ({ checkId: c.id, answer: "no" })),
        }),
      )
    ).json();
    expect(graded.session.path.map((e) => e.conceptId)).toEqual([
      byLabel(second, "Cross entropy").id,
    ]);
    expect(byLabel(graded, "Softmax").order).toBeNull();
  });

  it("unlocking a shared Concept settles it for every Session holding it", async () => {
    const first = await startInvestigatedSession();
    const softmax = byLabel(first, "Softmax");

    // Second Session takes Softmax onto its Path while it is still to learn.
    const second = await startOverlappingSession();
    scriptModelResponse(JSON.stringify({ knownConceptIds: [] }));
    const secondReady: StateBody = await (
      await postDiagnostic(
        jsonRequest("/api/session/diagnostic", {
          sessionId: second.session.id,
          answers: second.checks.map((c) => ({ checkId: c.id, answer: "no" })),
        }),
      )
    ).json();
    expect(secondReady.session.path.map((e) => e.conceptId)).toContain(
      softmax.id,
    );

    // The first Session teaches it and passes its Check.
    scriptModelResponse(JSON.stringify({ knownConceptIds: [] }));
    await postDiagnostic(
      jsonRequest("/api/session/diagnostic", {
        sessionId: first.session.id,
        answers: first.checks.map((c) => ({ checkId: c.id, answer: "no" })),
      }),
    );
    scriptModelResponse("Dot product exposition");
    await postAdvance(
      new Request(`http://test/api/session/advance?session=${first.session.id}`, {
        method: "POST",
      }),
    );
    scriptModelResponse(JSON.stringify({ question: "Q1?" }));
    await postCheck(
      new Request(`http://test/api/session/check?session=${first.session.id}`, {
        method: "POST",
      }),
    );
    scriptModelResponse(
      JSON.stringify({ verdict: "pass", feedback: "Good." }),
      "Softmax exposition",
    );
    const afterFirst: StateBody = await (
      await postAnswer(
        jsonRequest("/api/session/check/answer", {
          sessionId: first.session.id,
          answer: "a dot product is a scalar",
        }),
      )
    ).json();
    expect(byLabel(afterFirst, "Softmax").status).toBe("active");

    // Unlocking is a Graph fact: pass Softmax in the first Session…
    scriptModelResponse(JSON.stringify({ question: "Q2?" }));
    await postCheck(
      new Request(`http://test/api/session/check?session=${first.session.id}`, {
        method: "POST",
      }),
    );
    scriptModelResponse(
      JSON.stringify({ verdict: "pass", feedback: "Yes." }),
      "Attention exposition",
    );
    await postAnswer(
      jsonRequest("/api/session/check/answer", {
        sessionId: first.session.id,
        answer: "it normalizes scores",
      }),
    );

    // …and the second Session now shows it as already yours.
    const secondNow: StateBody = await (
      await GET(
        new Request(`http://test/api/session?session=${second.session.id}`),
      )
    ).json();
    expect(byLabel(secondNow, "Softmax").status).toBe("unlocked");
    expect(byLabel(secondNow, "Softmax").skipped).toBe(false);
  });
});
