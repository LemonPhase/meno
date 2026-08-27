// The injectable fake model for tests: flows receive their model from
// genkit.ts, and when MENO_MODEL=scripted this model is served instead of
// Gemini. Tests queue responses; each generate call consumes one.

import type { Genkit } from "genkit";
import type { ModelAction } from "genkit/model";

const queue: string[] = [];

/** Queue one or more raw model responses, consumed in FIFO order. */
export function scriptModelResponse(...texts: string[]) {
  queue.push(...texts);
}

export function clearScriptedResponses() {
  queue.length = 0;
}

export function registerScriptedModel(ai: Genkit): ModelAction {
  return ai.defineModel({ name: "scripted" }, async () => {
    const text = queue.shift();
    if (text === undefined) {
      throw new Error(
        "scripted model: no response queued — call scriptModelResponse() first",
      );
    }
    return {
      message: { role: "model", content: [{ text }] },
      finishReason: "stop",
    };
  });
}
