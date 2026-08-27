import { genkit, type ModelArgument } from "genkit";
import { vertexAI } from "@genkit-ai/google-genai";
import { registerScriptedModel } from "./scripted";

// MENO_MODEL selects the model for every flow. "scripted" swaps in the
// test fake (no Vertex plugin, no network); anything else is a Genkit
// model name served by the Vertex AI plugin.
const scripted = process.env.MENO_MODEL === "scripted";

export const ai = genkit({
  plugins: scripted
    ? []
    : [
        vertexAI({
          projectId: process.env.GCP_PROJECT_ID,
          // gemini-3.5 models are served from the "global" endpoint.
          location: process.env.GCP_LOCATION ?? "global",
        }),
      ],
});

export const model: ModelArgument = scripted
  ? registerScriptedModel(ai)
  : (process.env.MENO_MODEL ?? "vertexai/gemini-3.5-flash");
