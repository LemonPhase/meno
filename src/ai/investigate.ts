import { z } from "genkit";
import { ai, model } from "./genkit";

// Investigation runs in two model calls: grounded research (Google Search
// grounding doesn't reliably combine with JSON-schema output on Gemini),
// then structured extraction of Concepts from the research notes.
//
// Extraction also performs Attach (CONTEXT.md): each found concept may name
// a Concept already in the learner's Graph that it is the same idea as, and
// the store then reuses that Concept instead of creating a duplicate.

export const InvestigationSchema = z.object({
  concepts: z
    .array(
      z.object({
        key: z
          .string()
          .describe("unique kebab-case key for this concept, e.g. 'dot-product'"),
        label: z
          .string()
          .describe("short human-readable concept name, never TeX"),
        summary: z
          .string()
          .describe(
            "one or two sentences: what this concept is. Plain prose — " +
              "labels and summaries are shown outside the lesson, where " +
              "markdown and TeX do not render",
          ),
        requires: z
          .array(z.string())
          .describe("keys of concepts that must be understood first"),
        attachTo: z
          .string()
          .optional()
          .describe(
            "id of an EXISTING concept in the learner's graph that this is " +
              "the same idea as — omit unless it is genuinely the same",
          ),
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
      existing: z
        .array(
          z.object({
            id: z.string(),
            label: z.string(),
            summary: z.string(),
            unlocked: z.boolean(),
          }),
        )
        .default([])
        .describe("concepts already in the learner's graph, for attaching"),
    }),
    outputSchema: InvestigationSchema,
  },
  async ({ topic, editContext, existing }) => {
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

    const graphContext =
      existing.length > 0
        ? `\nThe learner's knowledge graph already contains these concepts:
${existing
  .map(
    (c) =>
      `- id: ${c.id} | ${c.label}: ${c.summary}${c.unlocked ? " (already learned)" : ""}`,
  )
  .join("\n")}

When a concept you extract is the SAME IDEA as one of these, set its attachTo
to that id — the learner keeps one concept per idea, and an attached one they
have already learned is skipped rather than taught again. Only attach on a
genuine match: same idea, not merely a related or neighbouring one.\n`
        : "";

    const extraction = await ai.generate({
      model,
      prompt: `From the research notes below, extract the atomic concepts a
learner must understand, as structured data. Each concept gets a unique
kebab-case key, a short label, a one-or-two-sentence summary, and the keys of
the concepts it requires (prerequisites only — direct dependencies, not the
whole transitive chain). Aim for 4-10 atomic concepts. Include the target
topic itself as the final concept.
${editContext ? `\n${editContext}\n` : ""}${graphContext}
Research notes:
${research.text}`,
      output: { schema: InvestigationSchema },
    });

    const out = extraction.output;
    if (!out) throw new Error("investigation: extraction returned no output");

    // Drop requires entries pointing at unknown keys and self-references,
    // and attachTo ids the graph doesn't actually hold.
    //
    // A repeated key would resolve to one Concept id twice, putting it on
    // the Session twice and writing it twice in the same batch, so only
    // the first of a key survives.
    const seen = new Set<string>();
    const found = out.concepts.filter((c) => {
      if (seen.has(c.key)) return false;
      seen.add(c.key);
      return true;
    });
    const keys = new Set(found.map((c) => c.key));
    const existingIds = new Set(existing.map((c) => c.id));
    const claimed = new Set<string>();
    return {
      concepts: found.map((c) => {
        // Two found concepts must never attach to the same Concept.
        const attachTo =
          c.attachTo && existingIds.has(c.attachTo) && !claimed.has(c.attachTo)
            ? c.attachTo
            : undefined;
        if (attachTo) claimed.add(attachTo);
        return {
          ...c,
          attachTo,
          requires: c.requires.filter((k) => keys.has(k) && k !== c.key),
        };
      }),
    };
  },
);
