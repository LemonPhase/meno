import { beforeEach, describe, expect, it } from "vitest";
import { clearScriptedResponses, scriptModelResponse } from "@/ai/scripted";
import { POST as postDiagnostic } from "@/app/api/session/diagnostic/route";
import { POST as postAdvance } from "@/app/api/session/advance/route";
import { POST as postLesson } from "@/app/api/session/lesson/route";
import { POST as postCheck } from "@/app/api/session/check/route";
import { POST as postAnswer } from "@/app/api/session/check/answer/route";
import { db } from "@/lib/firebase-admin";
import { graphRef } from "@/lib/store";
import {
  jsonRequest,
  reachLearning,
  startInvestigatedSession,
  type StateBody,
} from "./helpers";

beforeEach(async () => {
  clearScriptedResponses();
  await db.recursiveDelete(graphRef());
});

const active = (s: StateBody) =>
  s.concepts.find((c) => c.id === s.session.activeConceptId);
const lessonOf = (s: StateBody, conceptId: string | undefined) =>
  s.lessons.find((l) => l.conceptId === conceptId);
const pendingCheck = (s: StateBody) =>
  s.checks.find((c) => c.phase === "mastery" && c.verdict === null);

describe("POST /api/session/advance", () => {
  it("starts Learning: first Path Concept Active, Lesson opened lazily", async () => {
    const state = await reachLearning();

    expect(state.session.phase).toBe("learning");
    const act = active(state)!;
    expect(act.label).toBe("Dot product");
    expect(act.status).toBe("active");

    const lesson = lessonOf(state, act.id)!;
    expect(lesson.messages).toEqual([
      expect.objectContaining({ kind: "exposition", text: "Exposition 1" }),
    ]);

    // Only the Active Concept has a Lesson — later ones aren't generated yet.
    expect(state.lessons).toHaveLength(1);
  });

  it("completes immediately with a Recap when everything is already known", async () => {
    const started = await startInvestigatedSession();
    scriptModelResponse(
      JSON.stringify({
        knownConceptIds: started.concepts.map((c) => c.id),
      }),
    );
    await postDiagnostic(
      jsonRequest("/api/session/diagnostic", {
        answers: started.checks.map((c) => ({ checkId: c.id, answer: "yes" })),
      }),
    );

    scriptModelResponse("You already knew it all!");
    const res = await postAdvance();
    const state: StateBody = await res.json();

    expect(state.session.phase).toBe("complete");
    expect(state.session.recap).toBe("You already knew it all!");
    expect(state.session.activeConceptId).toBeNull();
  });

  it("rejects advancing outside Previewing", async () => {
    await startInvestigatedSession();
    expect((await postAdvance()).status).toBe(409);
  });
});

describe("POST /api/session/lesson", () => {
  it("appends the user message and the tutor's reply to the Lesson", async () => {
    const state = await reachLearning();
    scriptModelResponse("Good question — here's how to think about it.");

    const res = await postLesson(
      jsonRequest("/api/session/lesson", { message: "why vectors?" }),
    );
    expect(res.status).toBe(200);
    const after: StateBody = await res.json();

    const lesson = lessonOf(after, active(state)!.id)!;
    expect(lesson.messages.map((m) => m.kind)).toEqual([
      "exposition",
      "user",
      "reply",
    ]);
    expect(lesson.messages[1].text).toBe("why vectors?");
    expect(lesson.messages[2].text).toBe(
      "Good question — here's how to think about it.",
    );
  });

  it("rejects conversation outside Learning", async () => {
    await startInvestigatedSession();
    const res = await postLesson(
      jsonRequest("/api/session/lesson", { message: "hello?" }),
    );
    expect(res.status).toBe(409);
  });
});

describe("POST /api/session/check (mastery)", () => {
  it("creates a pending Check and records the question in the Lesson", async () => {
    const state = await reachLearning();
    scriptModelResponse(JSON.stringify({ question: "What is a dot product?" }));

    const res = await postCheck();
    expect(res.status).toBe(200);
    const after: StateBody = await res.json();

    const check = pendingCheck(after)!;
    expect(check.question).toBe("What is a dot product?");
    expect(check.conceptIds).toEqual([active(state)!.id]);

    const lesson = lessonOf(after, active(state)!.id)!;
    const last = lesson.messages.at(-1)!;
    expect(last.kind).toBe("check-question");
    expect(last.checkId).toBe(check.id);
  });

  it("is idempotent while a Check is pending (no new generation)", async () => {
    await reachLearning();
    scriptModelResponse(JSON.stringify({ question: "Q1?" }));
    await postCheck();

    // Nothing scripted: a second request must not hit the model.
    const res = await postCheck();
    expect(res.status).toBe(200);
    const after: StateBody = await res.json();
    expect(
      after.checks.filter((c) => c.phase === "mastery"),
    ).toHaveLength(1);
  });
});

describe("POST /api/session/check/answer", () => {
  async function requestCheck(question = "Q?") {
    scriptModelResponse(JSON.stringify({ question }));
    await postCheck();
  }

  it("a fail records the verdict and returns to conversation", async () => {
    const state = await reachLearning();
    await requestCheck();
    scriptModelResponse(
      JSON.stringify({ verdict: "fail", feedback: "Not quite — try again." }),
    );

    const res = await postAnswer(
      jsonRequest("/api/session/check/answer", { answer: "no idea" }),
    );
    const after: StateBody = await res.json();

    expect(after.session.phase).toBe("learning");
    expect(active(after)!.id).toBe(active(state)!.id);
    expect(active(after)!.status).toBe("active");

    const check = after.checks.find((c) => c.phase === "mastery")!;
    expect(check.verdict).toBe("fail");
    expect(check.answer).toBe("no idea");

    const kinds = lessonOf(after, active(state)!.id)!.messages.map(
      (m) => m.kind,
    );
    expect(kinds).toEqual([
      "exposition",
      "check-question",
      "check-answer",
      "check-feedback",
    ]);
    expect(pendingCheck(after)).toBeUndefined();
  });

  it("attempts are uncapped: a fresh Check can follow a fail", async () => {
    await reachLearning();
    await requestCheck("Q1?");
    scriptModelResponse(JSON.stringify({ verdict: "fail", feedback: "No." }));
    await postAnswer(jsonRequest("/api/session/check/answer", { answer: "x" }));

    await requestCheck("Q2 — different question?");
    const state: StateBody = await (await postCheck()).json();
    const masteries = state.checks.filter((c) => c.phase === "mastery");
    expect(masteries).toHaveLength(2);
    expect(pendingCheck(state)!.question).toBe("Q2 — different question?");
  });

  it("a pass Unlocks the Concept and activates the next one lazily", async () => {
    const state = await reachLearning();
    const first = active(state)!;
    await requestCheck();
    scriptModelResponse(
      JSON.stringify({ verdict: "pass", feedback: "Exactly right." }),
      "Exposition 2",
    );

    const res = await postAnswer(
      jsonRequest("/api/session/check/answer", { answer: "a scalar product" }),
    );
    const after: StateBody = await res.json();

    expect(after.concepts.find((c) => c.id === first.id)!.status).toBe(
      "unlocked",
    );
    const next = active(after)!;
    expect(next.label).toBe("Softmax");
    expect(next.status).toBe("active");
    expect(lessonOf(after, next.id)!.messages[0]).toEqual(
      expect.objectContaining({ kind: "exposition", text: "Exposition 2" }),
    );
  });

  it("passing the final Concept completes the Session with a Recap", async () => {
    await reachLearning();
    // Pass dot-product → softmax → attention; the last pass triggers the
    // Recap instead of another exposition.
    let state: StateBody | null = null;
    for (const next of [
      "Exposition 2",
      "Exposition 3",
      "What a journey — you unlocked everything!",
    ]) {
      await requestCheck();
      scriptModelResponse(
        JSON.stringify({ verdict: "pass", feedback: "Yes." }),
        next,
      );
      state = await (
        await postAnswer(
          jsonRequest("/api/session/check/answer", { answer: "right" }),
        )
      ).json();
    }

    expect(state!.session.phase).toBe("complete");
    expect(state!.session.recap).toBe(
      "What a journey — you unlocked everything!",
    );
    expect(state!.session.activeConceptId).toBeNull();
    expect(state!.concepts.every((c) => c.status === "unlocked")).toBe(true);
    expect(state!.concepts.every((c) => !c.skipped)).toBe(true);

    // The Session is over: no further Checks or answers.
    expect((await postCheck()).status).toBe(409);
    expect(
      (
        await postAnswer(
          jsonRequest("/api/session/check/answer", { answer: "x" }),
        )
      ).status,
    ).toBe(409);
  });

  it("rejects answering with no pending Check", async () => {
    await reachLearning();
    const res = await postAnswer(
      jsonRequest("/api/session/check/answer", { answer: "eager" }),
    );
    expect(res.status).toBe(409);
  });
});
