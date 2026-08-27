import { genkit } from "genkit";
import { vertexAI } from "@genkit-ai/vertexai";

export const ai = genkit({
  plugins: [
    vertexAI({
      location: process.env.GCP_LOCATION ?? "us-central1",
    }),
  ],
  model: "vertexai/gemini-3.5-flash",
});
