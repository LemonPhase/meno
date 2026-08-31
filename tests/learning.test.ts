import { beforeEach, describe, expect, it } from "vitest";
import {
  clearScriptedResponses,
  promptText,
  scriptModelResponse,
} from "@/ai/scripted";
import { GET } from "@/app/api/session/route";
import { POST as postDiagnostic } from "@/app/api/session/diagnostic/route";
import { POST as postAdvance } from "@/app/api/session/advance/route";
import { POST as postLesson } from "@/app/api/session/lesson/route";
import { POST as postCheck } from "@/app/api/session/check/route";
import { POST as postAnswer } from "@/app/api/session/check/answer/route";
import { db } from "@/lib/firebase-admin";
import { graphRef } from "@/lib/store";
import {
  USER,
  authed,
  FIRST_CHECK_QUESTION,
  jsonRequest,
  passAndMoveOn,
  pendingCheck,
  reachLearning,
  startInvestigatedSession,
  type StateBody,
} from "./helpers";

beforeEach(async () => {
  clearScriptedResponses();
  await db.recursiveDelete(graphRef(USER));
});

const active = (s: StateBody) =>
  s.concepts.find((c) => c.id === s.session.activeConceptId);
/**
 * Answers by the shape of the call rather than by position: two requests in
 * flight interleave their model calls, so a fixed queue cannot say which
 * response belongs to which.
 */
const byShape = (tag: string) => {
  let n = 0;
  return (request: { messages: unknown }) => {
    const prompt = promptText(request as never);
    n += 1;
    if (prompt.includes("writing a mastery check")) {
      return JSON.stringify({ question: `${tag} Q${n}?` });
    }
    if (prompt.includes("grading a mastery check")) {
      return JSON.stringify({ verdict: "pass", feedback: "ok" });
    }
    return `${tag} exposition ${n}`;
  };
};
const lessonOf = (s: StateBody, conceptId: string | undefined) =>
  s.lessons.find((l) => l.conceptId === conceptId);

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

  it("starts Learning once, however many presses arrive together", async () => {
    const started = await startInvestigatedSession();
    scriptModelResponse(JSON.stringify({ knownConceptIds: [] }));
    await postDiagnostic(
      jsonRequest("/api/session/diagnostic", {
        answers: started.checks.map((c) => ({ checkId: c.id, answer: "no" })),
      }),
    );

    // Leaving the preview is a move like any other. Two of them would each
    // write a Lesson and prime a question, the second overwriting the
    // exposition the first's question was written against — leaving the
    // Concept asking about text the learner is never shown.
    scriptModelResponse(byShape("S"), byShape("S"), byShape("S"), byShape("S"));
    const [a, b] = await Promise.all([postAdvance(authed("/api/session/advance")), postAdvance(authed("/api/session/advance"))]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);

    const state: StateBody = await (await GET(authed("/api/session"))).json();
    const conceptId = state.session.activeConceptId!;
    expect(
      state.checks.filter(
        (c) => c.phase === "mastery" && c.conceptIds.includes(conceptId),
      ),
    ).toHaveLength(1);
    expect(state.lessons.filter((l) => l.conceptId === conceptId)).toHaveLength(
      1,
    );
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
    const res = await postAdvance(authed("/api/session/advance"));
    const state: StateBody = await res.json();

    expect(state.session.phase).toBe("complete");
    expect(state.session.recap).toBe("You already knew it all!");
    expect(state.session.activeConceptId).toBeNull();
  });

  it("rejects advancing outside Previewing", async () => {
    await startInvestigatedSession();
    expect((await postAdvance(authed("/api/session/advance"))).status).toBe(409);
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
  it("reveals the Check primed alongside the Concept — instantly, no model call", async () => {
    const state = await reachLearning();

    // Nothing scripted: advancing already primed this Check (@/lib/checks),
    // so revealing it must not touch the model.
    const res = await postCheck(authed("/api/session/check"));
    expect(res.status).toBe(200);
    const after: StateBody = await res.json();

    const check = pendingCheck(after)!;
    expect(check.question).toBe(FIRST_CHECK_QUESTION);
    expect(check.conceptIds).toEqual([active(state)!.id]);

    const lesson = lessonOf(after, active(state)!.id)!;
    const last = lesson.messages.at(-1)!;
    expect(last.kind).toBe("check-question");
    expect(last.checkId).toBe(check.id);
  });

  it("reveals the question once, however many presses arrive together", async () => {
    await reachLearning();
    // Primed but not revealed, so both presses find nothing in the Lesson
    // and both would append the same question into the transcript.
    const [a, b] = await Promise.all([postCheck(authed("/api/session/check")), postCheck(authed("/api/session/check"))]);
    expect([a.status, b.status]).toEqual([200, 200]);

    const state: StateBody = await (await GET(authed("/api/session"))).json();
    const messages = lessonOf(state, state.session.activeConceptId!)!.messages;
    expect(messages.filter((m) => m.kind === "check-question")).toHaveLength(1);
  });

  it("is idempotent while a Check is pending (no new generation)", async () => {
    await reachLearning();
    await postCheck(authed("/api/session/check"));

    // Nothing scripted: a second request must not hit the model.
    const res = await postCheck(authed("/api/session/check"));
    expect(res.status).toBe(200);
    const after: StateBody = await res.json();
    expect(
      after.checks.filter((c) => c.phase === "mastery"),
    ).toHaveLength(1);
  });

  it("falls back to generating one when nothing was primed", async () => {
    const state = await reachLearning();
    // Simulate a Session that predates priming: no Check exists yet.
    const conceptId = active(state)!.id;
    const stale = await graphRef(USER)
      .collection("checks")
      .where("conceptIds", "array-contains", conceptId)
      .get();
    await Promise.all(stale.docs.map((d) => d.ref.delete()));

    scriptModelResponse(JSON.stringify({ question: "Generated on demand?" }));
    const res = await postCheck(authed("/api/session/check"));
    expect(res.status).toBe(200);
    const after: StateBody = await res.json();
    expect(pendingCheck(after)!.question).toBe("Generated on demand?");
  });
});

describe("POST /api/session/check/answer", () => {
  it("a fail records the verdict and returns to conversation", async () => {
    const state = await reachLearning();
    await postCheck(authed("/api/session/check")); // reveals the Check primed during advance
    // One response only: a fail re-primes the Concept's own question, which
    // costs no model call.
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

  it("attempts are uncapped, and re-ask the Concept's one question", async () => {
    await reachLearning();
    await postCheck(authed("/api/session/check"));
    // One scripted response, not two: a fail no longer writes a question.
    scriptModelResponse(JSON.stringify({ verdict: "fail", feedback: "No." }));
    await postAnswer(jsonRequest("/api/session/check/answer", { answer: "x" }));

    // Nothing scripted: the same question was primed again by the fail.
    const state: StateBody = await (await postCheck(authed("/api/session/check"))).json();
    const masteries = state.checks.filter((c) => c.phase === "mastery");
    expect(masteries).toHaveLength(2);
    expect(pendingCheck(state)!.question).toBe(FIRST_CHECK_QUESTION);
  });

  it("leaves the Check alone through a chat turn", async () => {
    await reachLearning();
    // One scripted response: the reply. The Check is not rewritten to chase
    // what was asked — it tests the exposition, not the conversation.
    scriptModelResponse("Another way to see it.");
    await postLesson(jsonRequest("/api/session/lesson", { message: "eh?" }));

    const state: StateBody = await (await postCheck(authed("/api/session/check"))).json();
    expect(state.checks.filter((c) => c.phase === "mastery")).toHaveLength(1);
    expect(pendingCheck(state)!.question).toBe(FIRST_CHECK_QUESTION);
  });

  it("a pass stays put: it offers the move rather than making it", async () => {
    const state = await reachLearning();
    const first = active(state)!;
    await postCheck(authed("/api/session/check"));
    // Only the grade is scripted — nothing is generated, because nothing
    // moves. A second Concept's exposition here would be a wasted call.
    scriptModelResponse(
      JSON.stringify({ verdict: "pass", feedback: "Exactly right." }),
    );

    const after: StateBody = await (
      await postAnswer(
        jsonRequest("/api/session/check/answer", {
          answer: "a scalar product",
        }),
      )
    ).json();

    expect(after.session.activeConceptId).toBe(first.id);
    expect(after.concepts.find((c) => c.id === first.id)!.status).toBe(
      "active",
    );
    expect(
      after.checks.find((c) => c.phase === "mastery")!.verdict,
    ).toBe("pass");
    // The feedback lands, and the conversation is still open beneath it.
    expect(lessonOf(after, first.id)!.messages.at(-1)).toEqual(
      expect.objectContaining({
        kind: "check-feedback",
        text: "Exactly right.",
      }),
    );
  });

  it("moving on Unlocks the Concept and activates the next one lazily", async () => {
    const state = await reachLearning();
    const first = active(state)!;
    const after = await passAndMoveOn({
      exposition: "Exposition 2",
      question: "Softmax check?",
    });

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

  it("writes the Concept's question against the exposition it tests", async () => {
    await reachLearning();
    await postCheck(authed("/api/session/check"));
    scriptModelResponse(JSON.stringify({ verdict: "pass", feedback: "Yes." }));
    await postAnswer(
      jsonRequest("/api/session/check/answer", { answer: "right" }),
    );

    // Watch what the next Concept's check generator is actually shown. A
    // question written from the label and summary alone can ask about
    // something the exposition never covered — and since every attempt
    // re-asks that same question, there would be no way out of it.
    const exposition = "Softmax turns scores into weights that sum to one.";
    let checkPrompt = "";
    scriptModelResponse(exposition, (request) => {
      checkPrompt = promptText(request as never);
      return JSON.stringify({ question: "Q2?" });
    });
    await postAdvance(authed("/api/session/advance"));

    expect(checkPrompt).toContain(exposition);
  });

  it("teaches the next Concept to someone who has just passed its prerequisite", async () => {
    await reachLearning();
    await postCheck(authed("/api/session/check"));
    scriptModelResponse(JSON.stringify({ verdict: "pass", feedback: "Yes." }));
    await postAnswer(
      jsonRequest("/api/session/check/answer", { answer: "right" }),
    );

    // The Concept being left is Unlocked by this move, so it is still Locked
    // in the state the move was planned from. Left uncounted, every
    // exposition is written as though the learner had never met the very
    // Concept it builds on.
    let taught = "";
    scriptModelResponse(
      (request) => {
        taught = promptText(request as never);
        return "Exposition 2";
      },
      JSON.stringify({ question: "Q2?" }),
    );
    await postAdvance(authed("/api/session/advance"));

    expect(taught).toContain("Dot product");
  });

  it("credits the last Concept passed in the Recap", async () => {
    await reachLearning();
    await passAndMoveOn({ exposition: "E2", question: "Q2?" });
    await passAndMoveOn({ exposition: "E3", question: "Q3?" });
    await postCheck(authed("/api/session/check"));
    scriptModelResponse(JSON.stringify({ verdict: "pass", feedback: "Yes." }));
    await postAnswer(
      jsonRequest("/api/session/check/answer", { answer: "right" }),
    );

    // The Concept they are walking out on is the one they most recently
    // proved, and the Recap is where that is said back to them.
    let recap = "";
    scriptModelResponse((request) => {
      recap = promptText(request as never);
      return "A recap.";
    });
    await postAdvance(authed("/api/session/advance"));

    expect(recap).toContain("Attention");
  });

  it("a second press of the move-on offer is refused, not applied twice", async () => {
    await reachLearning();
    await postCheck(authed("/api/session/check"));
    scriptModelResponse(JSON.stringify({ verdict: "pass", feedback: "Yes." }));
    await postAnswer(
      jsonRequest("/api/session/check/answer", { answer: "right" }),
    );

    // The offer stands until the learner takes it, so two tabs — or two
    // clicks — can both reach a server that has not moved yet. Both will
    // generate; only one may commit. The loser wastes a model call, which is
    // the price of generating before writing anything, and is refused rather
    // than overwriting the Lesson the winner just wrote.
    scriptModelResponse(byShape("P"), byShape("P"), byShape("P"), byShape("P"));
    const [a, b] = await Promise.all([postAdvance(authed("/api/session/advance")), postAdvance(authed("/api/session/advance"))]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);

    const state: StateBody = await (a.status === 200 ? a : b).json();
    const next = active(state)!;
    expect(next.label).toBe("Softmax");
    expect(state.lessons.find((l) => l.conceptId === next.id)!.messages)
      .toHaveLength(1);
    expect(state.lessons.filter((l) => l.conceptId === next.id)).toHaveLength(
      1,
    );
    expect(
      state.checks.filter(
        (c) => c.phase === "mastery" && c.conceptIds.includes(next.id),
      ),
    ).toHaveLength(1);
  });

  it("a failed generation leaves the Session where it stood, still able to move", async () => {
    const start = await reachLearning();
    const first = active(start)!;
    await postCheck(authed("/api/session/check"));
    scriptModelResponse(JSON.stringify({ verdict: "pass", feedback: "Yes." }));
    await postAnswer(
      jsonRequest("/api/session/check/answer", { answer: "right" }),
    );

    // Nothing queued: the model throws, as a real one does when it times out
    // or is rate-limited. Nothing may have been written by then — least of
    // all the Unlock, which would leave the Session standing on a Concept it
    // had already left and refuse every attempt to move again.
    await expect(postAdvance(authed("/api/session/advance"))).rejects.toThrow();

    const after: StateBody = await (await GET(authed("/api/session"))).json();
    expect(after.session.activeConceptId).toBe(first.id);
    expect(after.concepts.find((c) => c.id === first.id)!.status).toBe(
      "active",
    );

    scriptModelResponse("Exposition 2", JSON.stringify({ question: "Q2?" }));
    const retry = await postAdvance(authed("/api/session/advance"));
    expect(retry.status).toBe(200);
    expect(active(await retry.json())!.label).toBe("Softmax");
  });

  it("refuses to move on until the Check is passed", async () => {
    await reachLearning();
    expect((await postAdvance(authed("/api/session/advance"))).status).toBe(409);

    // A fail is not a pass: still going nowhere.
    await postCheck(authed("/api/session/check"));
    scriptModelResponse(JSON.stringify({ verdict: "fail", feedback: "No." }));
    await postAnswer(jsonRequest("/api/session/check/answer", { answer: "x" }));
    expect((await postAdvance(authed("/api/session/advance"))).status).toBe(409);
  });

  it("asking to be tested again after a pass is a no-op", async () => {
    await reachLearning();
    await postCheck(authed("/api/session/check"));
    scriptModelResponse(JSON.stringify({ verdict: "pass", feedback: "Yes." }));
    await postAnswer(
      jsonRequest("/api/session/check/answer", { answer: "right" }),
    );

    // Nothing scripted: there is one question per Concept and it is answered,
    // so this must not quietly write a second one.
    const state: StateBody = await (await postCheck(authed("/api/session/check"))).json();
    expect(state.checks.filter((c) => c.phase === "mastery")).toHaveLength(1);
    expect(pendingCheck(state)).toBeUndefined();
  });

  it("passing the final Concept completes the Session with a Recap", async () => {
    await reachLearning();
    // Walk dot-product → softmax, each move activating (and priming a Check
    // for) the next Concept; leaving the last one (attention) writes the
    // Recap instead.
    let state: StateBody | null = null;
    for (const next of [
      { exposition: "Exposition 2", question: "Softmax check?" },
      { exposition: "Exposition 3", question: "Attention check?" },
    ]) {
      state = await passAndMoveOn(next);
    }
    state = await passAndMoveOn({
      recap: "What a journey — you unlocked everything!",
    });

    expect(state!.session.phase).toBe("complete");
    expect(state!.session.recap).toBe(
      "What a journey — you unlocked everything!",
    );
    expect(state!.session.activeConceptId).toBeNull();
    expect(state!.concepts.every((c) => c.status === "unlocked")).toBe(true);
    expect(state!.concepts.every((c) => !c.skipped)).toBe(true);

    // The Session is over: no further Checks or answers.
    expect((await postCheck(authed("/api/session/check"))).status).toBe(409);
    expect(
      (
        await postAnswer(
          jsonRequest("/api/session/check/answer", { answer: "x" }),
        )
      ).status,
    ).toBe(409);
  });

  it("grades one answer per Check, whatever arrives alongside it", async () => {
    const graded = active(await reachLearning())!;
    await postCheck(authed("/api/session/check"));

    // Two answers in flight — a double submit, or a second tab. Both grade;
    // only one may write. The loser applying its Adjustment from the same
    // stale Session would overwrite the winner's Path while leaving the
    // remedial Concept it created in the Graph, on no Path at all.
    const grade = JSON.stringify({
      verdict: "fail",
      feedback: "No.",
      adjustment: "insert_remedial",
      remedial: { label: "Vectors", summary: "Ordered lists of numbers." },
    });
    // The winner's fail also takes the detour, which generates two more
    // calls. Both are answered by shape rather than by position: the two
    // gradings and the teaching interleave, so a fixed queue cannot say
    // which response belongs to which.
    const answer = (request: { messages: unknown }) => {
      const prompt = promptText(request as never);
      if (prompt.includes("grading a mastery check")) return grade;
      if (prompt.includes("writing a mastery check")) {
        return JSON.stringify({ question: "Vectors check?" });
      }
      return "Vectors exposition";
    };
    scriptModelResponse(answer, answer, answer, answer);
    const [a, b] = await Promise.all([
      postAnswer(jsonRequest("/api/session/check/answer", { answer: "one" })),
      postAnswer(jsonRequest("/api/session/check/answer", { answer: "two" })),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);

    const after: StateBody = await (await GET(authed("/api/session"))).json();
    const inGraph = await graphRef(USER).collection("concepts").get();
    expect(inGraph.size).toBe(after.concepts.length);
    expect(after.concepts.filter((c) => c.label === "Vectors")).toHaveLength(1);
    const messages = lessonOf(after, graded.id)!.messages;
    expect(messages.filter((m) => m.kind === "check-answer")).toHaveLength(1);
  });

  it("rejects answering with no pending Check", async () => {
    await reachLearning();
    const res = await postAnswer(
      jsonRequest("/api/session/check/answer", { answer: "eager" }),
    );
    expect(res.status).toBe(409);
  });
});
