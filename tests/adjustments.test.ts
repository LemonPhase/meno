import { beforeEach, describe, expect, it } from "vitest";
import { clearScriptedResponses, scriptModelResponse } from "@/ai/scripted";
import { POST as postCheck } from "@/app/api/session/check/route";
import { POST as postAnswer } from "@/app/api/session/check/answer/route";
import { db } from "@/lib/firebase-admin";
import { graphRef } from "@/lib/store";
import { jsonRequest, reachLearning, type StateBody } from "./helpers";

// ADR-0001: Adjustments are bounded to insert_remedial and skip_next,
// riding on the grading call. Path starts as: dot-product → softmax →
// attention, with dot-product Active after reachLearning().

beforeEach(async () => {
  clearScriptedResponses();
  await db.recursiveDelete(graphRef());
});

const byLabel = (s: StateBody, label: string) =>
  s.concepts.find((c) => c.label === label)!;

async function answerWith(
  grade: { verdict: "pass" | "fail" } & Record<string, unknown>,
): Promise<StateBody> {
  // Whatever Check is Active already has one primed — from reachLearning()
  // or the previous turn — so revealing it costs no model call.
  await postCheck();
  const responses = [JSON.stringify(grade)];
  // A fail keeps a fresh Check primed for an immediate retry.
  if (grade.verdict === "fail") {
    responses.push(JSON.stringify({ question: "Retry?" }));
  }
  scriptModelResponse(...responses);
  const res = await postAnswer(
    jsonRequest("/api/session/check/answer", { answer: "my attempt" }),
  );
  return res.json();
}

describe("Adjustment: insert_remedial", () => {
  it("splices the remedial Concept in right after the Active one on a fail", async () => {
    await reachLearning();
    const state = await answerWith({
      verdict: "fail",
      feedback: "You're missing what a vector even is.",
      adjustment: "insert_remedial",
      remedial: { label: "Vectors", summary: "Ordered lists of numbers." },
    });

    // Still on dot-product; the remedial lands at order 1, everything
    // after shifts down.
    expect(state.session.phase).toBe("learning");
    expect(byLabel(state, "Dot product").status).toBe("active");

    const remedial = byLabel(state, "Vectors");
    expect(remedial.origin).toBe("remedial");
    expect(remedial.status).toBe("locked");
    expect(remedial.order).toBe(1);
    expect(byLabel(state, "Softmax").order).toBe(2);
    expect(byLabel(state, "Attention").order).toBe(3);

    // The previously-next Concept now requires the remedial.
    expect(byLabel(state, "Softmax").requires).toContain(remedial.id);
  });

  it("a pass with insert_remedial activates the remedial next", async () => {
    await reachLearning();
    await postCheck();
    scriptModelResponse(
      JSON.stringify({
        verdict: "pass",
        feedback: "Right, though shakily.",
        adjustment: "insert_remedial",
        remedial: { label: "Vectors", summary: "Ordered lists of numbers." },
      }),
      "Remedial exposition",
      JSON.stringify({ question: "Vectors check?" }),
    );
    const res = await postAnswer(
      jsonRequest("/api/session/check/answer", { answer: "shaky but right" }),
    );
    const state: StateBody = await res.json();

    expect(byLabel(state, "Dot product").status).toBe("unlocked");
    const remedial = byLabel(state, "Vectors");
    expect(remedial.status).toBe("active");
    expect(state.session.activeConceptId).toBe(remedial.id);
    expect(
      state.lessons.find((l) => l.conceptId === remedial.id)!.messages[0].text,
    ).toBe("Remedial exposition");
  });

  it("ignores insert_remedial when the model omits the remedial payload", async () => {
    await reachLearning();
    const state = await answerWith({
      verdict: "fail",
      feedback: "No.",
      adjustment: "insert_remedial",
      // no remedial object
    });
    expect(state.concepts).toHaveLength(3);
  });
});

describe("Adjustment: skip_next", () => {
  it("marks the next Concept Unlocked + Skipped on a pass and advances past it", async () => {
    await reachLearning();
    await postCheck();
    scriptModelResponse(
      JSON.stringify({
        verdict: "pass",
        feedback: "You clearly know softmax too.",
        adjustment: "skip_next",
      }),
      "Attention exposition",
      JSON.stringify({ question: "Attention check?" }),
    );
    const res = await postAnswer(
      jsonRequest("/api/session/check/answer", { answer: "great answer" }),
    );
    const state: StateBody = await res.json();

    expect(byLabel(state, "Dot product").status).toBe("unlocked");
    expect(byLabel(state, "Dot product").skipped).toBe(false);

    const softmax = byLabel(state, "Softmax");
    expect(softmax.status).toBe("unlocked");
    expect(softmax.skipped).toBe(true);

    const attention = byLabel(state, "Attention");
    expect(attention.status).toBe("active");
    expect(state.session.activeConceptId).toBe(attention.id);
  });

  it("skips the next Concept even on a fail, keeping the current one Active", async () => {
    await reachLearning();
    const state = await answerWith({
      verdict: "fail",
      feedback: "Current concept shaky, but you clearly know softmax.",
      adjustment: "skip_next",
    });

    expect(byLabel(state, "Dot product").status).toBe("active");
    expect(byLabel(state, "Softmax").status).toBe("unlocked");
    expect(byLabel(state, "Softmax").skipped).toBe(true);
    expect(state.session.phase).toBe("learning");
  });

  it("Path order stays consistent through a remedial detour to Completion", async () => {
    await reachLearning();
    // Fail dot-product with a remedial inserted…
    await answerWith({
      verdict: "fail",
      feedback: "Gap found.",
      adjustment: "insert_remedial",
      remedial: { label: "Vectors", summary: "Ordered lists." },
    });

    // …then pass everything in the adjusted order:
    // dot-product → Vectors → Softmax → Attention.
    const advances = [
      { exposition: "E-vectors", question: "Q-vectors?" },
      { exposition: "E-softmax", question: "Q-softmax?" },
      { exposition: "E-attention", question: "Q-attention?" },
    ];
    let state: StateBody | null = null;
    for (const { exposition, question } of advances) {
      // Already primed — by the fail above, or the previous pass.
      await postCheck();
      scriptModelResponse(
        JSON.stringify({ verdict: "pass", feedback: "Yes." }),
        exposition,
        JSON.stringify({ question }),
      );
      state = await (
        await postAnswer(
          jsonRequest("/api/session/check/answer", { answer: "right" }),
        )
      ).json();
    }
    // Attention is the last Concept on the Path: passing it completes the
    // Session with a Recap instead of priming another Check.
    await postCheck();
    scriptModelResponse(
      JSON.stringify({ verdict: "pass", feedback: "Yes." }),
      "Recap!",
    );
    state = await (
      await postAnswer(
        jsonRequest("/api/session/check/answer", { answer: "right" }),
      )
    ).json();

    expect(state!.session.phase).toBe("complete");
    expect(state!.session.recap).toBe("Recap!");
    expect(state!.concepts.every((c) => c.status === "unlocked")).toBe(true);
    expect(state!.concepts).toHaveLength(4);
  });
});
