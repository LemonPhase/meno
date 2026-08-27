import { z } from "genkit";
import { ai, model } from "./genkit";
import type { Concept } from "@/lib/types";

// Diagnostic Checks: before any teaching, probe what the user already knows
// across the extracted Concepts, then grade all answers in one call. Known
// Concepts go straight to Unlocked+Skipped; the rest form the Path.

const DiagnosticQuestionsSchema = z.object({
  questions: z
    .array(
      z.object({
        conceptKeys: z
          .array(z.string())
          .describe("ids of the concepts this question probes"),
        question: z.string().describe("a short question testing understanding"),
      }),
    )
    .describe("3-6 questions that together cover the concepts"),
});

const conceptList = (concepts: Pick<Concept, "id" | "label" | "summary">[]) =>
  concepts
    .map((c) => `- id: ${c.id} | ${c.label}: ${c.summary}`)
    .join("\n");

export const generateDiagnostic = ai.defineFlow(
  {
    name: "generateDiagnostic",
    inputSchema: z.object({
      topic: z.string(),
      concepts: z.array(
        z.object({ id: z.string(), label: z.string(), summary: z.string() }),
      ),
    }),
    outputSchema: DiagnosticQuestionsSchema,
  },
  async ({ topic, concepts }) => {
    const res = await ai.generate({
      model,
      prompt: `A learner wants to understand: ${topic}

The concepts involved are:
${conceptList(concepts)}

Write 3-6 short diagnostic questions to find out which of these concepts the
learner already understands. Each question probes one or a few concepts
(reference them by id in conceptKeys). Questions must be answerable in a
sentence or two of free text; favor questions whose answers reveal real
understanding rather than recognition.`,
      output: { schema: DiagnosticQuestionsSchema },
    });
    const out = res.output;
    if (!out) throw new Error("diagnostic: generation returned no output");
    const known = new Set(concepts.map((c) => c.id));
    return {
      questions: out.questions
        .map((q) => ({
          ...q,
          conceptKeys: q.conceptKeys.filter((k) => known.has(k)),
        }))
        .filter((q) => q.conceptKeys.length > 0),
    };
  },
);

const DiagnosisSchema = z.object({
  knownConceptIds: z
    .array(z.string())
    .describe("ids of concepts the learner clearly already understands"),
});

export const gradeDiagnostic = ai.defineFlow(
  {
    name: "gradeDiagnostic",
    inputSchema: z.object({
      topic: z.string(),
      concepts: z.array(
        z.object({ id: z.string(), label: z.string(), summary: z.string() }),
      ),
      answers: z.array(z.object({ question: z.string(), answer: z.string() })),
    }),
    outputSchema: DiagnosisSchema,
  },
  async ({ topic, concepts, answers }) => {
    const res = await ai.generate({
      model,
      prompt: `A learner wants to understand: ${topic}

The concepts involved are:
${conceptList(concepts)}

They answered these diagnostic questions:
${answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join("\n\n")}

Decide which concepts the learner ALREADY understands well enough that
teaching them would be redundant. Be conservative: only include a concept id
when an answer demonstrates real understanding of it. An empty or "I don't
know" answer never demonstrates understanding.`,
      output: { schema: DiagnosisSchema },
    });
    const out = res.output;
    if (!out) throw new Error("diagnostic: grading returned no output");
    const known = new Set(concepts.map((c) => c.id));
    return {
      knownConceptIds: out.knownConceptIds.filter((id) => known.has(id)),
    };
  },
);
