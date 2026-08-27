import { z } from "genkit";
import { ai, model } from "./genkit";

// Investigation runs in two model calls: grounded research (Google Search
// grounding doesn't reliably combine with JSON-schema output on Gemini),
// then structured extraction of Concepts from the research notes.

export const InvestigationSchema = z.object({
  concepts: z
    .array(
      z.object({
        key: z
          .string()
          .describe("unique kebab-case key for this concept, e.g. 'dot-product'"),
        label: z.string().describe("short human-readable concept name"),
        summary: z
          .string()
          .describe("one or two sentences: what this concept is"),
        requires: z
          .array(z.string())
          .describe("keys of concepts that must be understood first"),
      }),
    )
    .describe("atomic concepts, prerequisites first"),
});

export type Investigation = z.infer<typeof InvestigationSchema>;

export const investigateTopic = ai.defineFlow(
  {
    name: "investigateTopic",
    inputSchema: z.object({
      topic: z.string(),
      editContext: z
        .string()
        .default("")
        .describe("how the learner has curated their graph so far"),
    }),
    outputSchema: InvestigationSchema,
  },
  async ({ topic, editContext }) => {
    const research = await ai.generate({
      model,
      prompt: `You are a tutor preparing to teach someone a topic they gave you.
Research the topic below and write concise notes covering: what it actually is,
the atomic ideas someone must grasp to understand it, and which of those ideas
depend on which others. Prefer accurate, current information.

Topic:
${topic}`,
      config: { googleSearchRetrieval: {} },
    });

    const extraction = await ai.generate({
      model,
      prompt: `From the research notes below, extract the atomic concepts a
learner must understand, as structured data. Each concept gets a unique
kebab-case key, a short label, a one-or-two-sentence summary, and the keys of
the concepts it requires (prerequisites only — direct dependencies, not the
whole transitive chain). Aim for 4-10 atomic concepts. Include the target
topic itself as the final concept.
${editContext ? `\n${editContext}\n` : ""}
Research notes:
${research.text}`,
      output: { schema: InvestigationSchema },
    });

    const out = extraction.output;
    if (!out) throw new Error("investigation: extraction returned no output");

    // Drop requires entries pointing at unknown keys and self-references.
    const keys = new Set(out.concepts.map((c) => c.key));
    return {
      concepts: out.concepts.map((c) => ({
        ...c,
        requires: c.requires.filter((k) => keys.has(k) && k !== c.key),
      })),
    };
  },
);
