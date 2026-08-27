import { promptText, scriptModelResponse } from "@/ai/scripted";
import { POST as postSessionRoute } from "@/app/api/session/route";
import type { Check, Concept, Session } from "@/lib/types";

export type StateBody = {
  session: Session;
  concepts: Concept[];
  checks: Check[];
};

export function jsonRequest(url: string, body: unknown): Request {
  return new Request(`http://test${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export const RESEARCH_NOTES =
  "Notes: attention builds on dot products and softmax.";

export const EXTRACTION = JSON.stringify({
  concepts: [
    {
      key: "dot-product",
      label: "Dot product",
      summary: "Multiplying two vectors into a scalar.",
      requires: [],
    },
    {
      key: "softmax",
      label: "Softmax",
      summary: "Turning scores into a probability distribution.",
      requires: ["dot-product"],
    },
    {
      key: "attention",
      label: "Attention",
      summary: "Weighting values by query-key similarity.",
      requires: ["dot-product", "softmax", "not-a-real-key", "attention"],
    },
  ],
});

/**
 * Responder for the diagnostic-questions call: reads the Concept ids out of
 * the prompt (they're session-namespaced, so unknowable beforehand) and
 * asks one question per concept.
 */
export function diagnosticQuestionsResponder(request: {
  messages: Parameters<typeof promptText>[0]["messages"];
}): string {
  const ids = [...promptText(request as never).matchAll(/- id: (\S+) \|/g)].map(
    (m) => m[1],
  );
  return JSON.stringify({
    questions: ids.map((id) => ({
      conceptKeys: [id],
      question: `Explain: ${id}`,
    })),
  });
}

/** Script the three model calls behind POST /api/session and run it. */
export async function startInvestigatedSession(
  topic = "attention mechanisms",
): Promise<StateBody> {
  scriptModelResponse(RESEARCH_NOTES, EXTRACTION, diagnosticQuestionsResponder);
  const res = await postSessionRoute(jsonRequest("/api/session", { topic }));
  if (res.status !== 200) {
    throw new Error(`startInvestigatedSession failed: ${res.status}`);
  }
  return res.json();
}
