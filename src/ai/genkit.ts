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

export const model: ModelArgument = scripted
  ? registerScriptedModel(ai)
  : modelName;
