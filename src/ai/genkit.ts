import { genkit, type ModelArgument } from "genkit";
import { vertexAI } from "@genkit-ai/google-genai";
import { registerScriptedModel } from "./scripted";
import { modelName } from "./model";

// MENO_MODEL selects the model for every flow — see ./model, which resolves
// the name for both this seam and the Settings page.
const scripted = modelName === "scripted";

export const ai = genkit({
  plugins: scripted
    ? []
    : [
        vertexAI({
          projectId: process.env.GCP_PROJECT_ID,
          // gemini-3 models are served from the "global" endpoint.
          location: process.env.GCP_LOCATION ?? "global",
        }),
      ],
});

// Thinking level is set on the model reference, not at the nine call sites:
// Genkit merges a reference's config into each generate() call per key, so
// investigate's googleSearchRetrieval survives alongside it.
//
// MEDIUM is 3.7 Flash's own default, pinned here so the reasoning depth is a
// decision rather than whatever the next model ships with. Don't lower it to
// MINIMAL — 3.7 Flash rejects that value outright.
export const model: ModelArgument = scripted
  ? registerScriptedModel(ai)
  : vertexAI.model(modelName, {
      thinkingConfig: { thinkingLevel: "MEDIUM" },
    });
