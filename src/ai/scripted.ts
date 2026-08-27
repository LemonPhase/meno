// The injectable fake model for tests: flows receive their model from
// genkit.ts, and when MENO_MODEL=scripted this model is served instead of
// Gemini. Tests queue responses; each generate call consumes one. A queued
// function builds the response from the incoming request (useful when the
// reply must echo ids that only exist in the prompt).

import type { Genkit } from "genkit";
import type { GenerateRequest, ModelAction } from "genkit/model";

export type ScriptedResponder =
  | string
  | ((request: GenerateRequest) => string);

const queue: ScriptedResponder[] = [];

/** Queue one or more model responses, consumed in FIFO order. */
export function scriptModelResponse(...responders: ScriptedResponder[]) {
  queue.push(...responders);
}

export function clearScriptedResponses() {
  queue.length = 0;
}

/** All text content of a request's messages, for responder functions. */
export function promptText(request: GenerateRequest): string {
  return request.messages
    .flatMap((m) => m.content.map((p) => ("text" in p ? (p.text ?? "") : "")))
    .join("\n");
}

export function registerScriptedModel(ai: Genkit): ModelAction {
  return ai.defineModel({ name: "scripted" }, async (request) => {
    const next = queue.shift();
    if (next === undefined) {
      throw new Error(
        "scripted model: no response queued — call scriptModelResponse() first",
      );
    }
    const text = typeof next === "function" ? next(request) : next;
    return {
      message: { role: "model", content: [{ text }] },
      finishReason: "stop",
    };
  });
}
