import { beforeEach, describe, expect, it } from "vitest";
import { clearScriptedResponses, scriptModelResponse } from "@/ai/scripted";
import { GET } from "@/app/api/session/route";
import { POST as postDiagnostic } from "@/app/api/session/diagnostic/route";
import { POST as postCheck } from "@/app/api/session/check/route";
import { POST as postAnswer } from "@/app/api/session/check/answer/route";
import { POST as postLesson } from "@/app/api/session/lesson/route";
import { db } from "@/lib/firebase-admin";
import { graphRef } from "@/lib/store";
import {
  jsonRequest,
  passAndMoveOn,
  reachLearning,
  startInvestigatedSession,
  type StateBody,
} from "./helpers";

// Resume (#8): Firestore is the source of truth, so "reloading the app"
// is exactly "GET /api/session returns the same observable state as the
// last mutation's response". The UI rehydrates from that one call.

beforeEach(async () => {
  clearScriptedResponses();
  await db.recursiveDelete(graphRef());
});

/** Reload and compare: GET must reproduce the last response's state. */
async function expectResumeMatches(last: StateBody) {
  const reloaded: StateBody = await (await GET()).json();
  expect(reloaded.session).toEqual(last.session);
  expect(reloaded.concepts).toEqual(last.concepts);
  expect(reloaded.checks).toEqual(
    expect.arrayContaining(last.checks),
  );
  expect(reloaded.checks).toHaveLength(last.checks.length);
  expect(reloaded.lessons).toEqual(
    expect.arrayContaining(last.lessons),
  );
  expect(reloaded.lessons).toHaveLength(last.lessons.length);
  return reloaded;
}

describe("Session resume", () => {
  it("resumes in Diagnosing with the diagnostic Checks intact", async () => {
    const state = await startInvestigatedSession();
    const reloaded = await expectResumeMatches(state);
    expect(reloaded.session.phase).toBe("diagnosing");
    expect(reloaded.checks).toHaveLength(3);
  });

  it("resumes in Previewing with the Path order intact", async () => {
    const started = await startInvestigatedSession();
    scriptModelResponse(JSON.stringify({ knownConceptIds: [] }));
    const state: StateBody = await (
      await postDiagnostic(
        jsonRequest("/api/session/diagnostic", {
          answers: started.checks.map((c) => ({ checkId: c.id, answer: "?" })),
        }),
      )
    ).json();

    const reloaded = await expectResumeMatches(state);
    expect(reloaded.session.phase).toBe("previewing");
    expect(
      reloaded.concepts.filter((c) => c.order !== null),
    ).toHaveLength(3);
  });

  it("resumes mid-Learning with the Active Concept and full Lesson history", async () => {
    await reachLearning();

    // Build up real Lesson history: a chat exchange and a failed Check.
    scriptModelResponse("Here's another way to see it.");
    await postLesson(jsonRequest("/api/session/lesson", { message: "eh?" }));
    await postCheck(); // reveals the Check primed with the exposition
    scriptModelResponse(JSON.stringify({ verdict: "fail", feedback: "Almost." }));
    const state: StateBody = await (
      await postAnswer(
        jsonRequest("/api/session/check/answer", { answer: "hmm" }),
      )
    ).json();

    const reloaded = await expectResumeMatches(state);
    expect(reloaded.session.phase).toBe("learning");

    const active = reloaded.concepts.find(
      (c) => c.id === reloaded.session.activeConceptId,
    )!;
    expect(active.status).toBe("active");
    expect(active.label).toBe("Dot product");

    const lesson = reloaded.lessons.find((l) => l.conceptId === active.id)!;
    expect(lesson.messages.map((m) => m.kind)).toEqual([
      "exposition",
      "user",
      "reply",
      "check-question",
      "check-answer",
      "check-feedback",
    ]);
  });

  it("a Complete Session reloads with its Recap and Graph intact", async () => {
    await reachLearning();
    let state: StateBody | null = null;
    for (const next of [
      { exposition: "E2", question: "Q-softmax?" },
      { exposition: "E3", question: "Q-attention?" },
    ]) {
      state = await passAndMoveOn(next);
    }
    // Attention is the last Concept: leaving it completes the Session.
    state = await passAndMoveOn({ recap: "The recap!" });

    const reloaded = await expectResumeMatches(state!);
    expect(reloaded.session.phase).toBe("complete");
    expect(reloaded.session.recap).toBe("The recap!");
    expect(reloaded.concepts.every((c) => c.status === "unlocked")).toBe(true);
    // Every taught Concept keeps its Lesson for later review.
    expect(reloaded.lessons).toHaveLength(3);
  });
});
