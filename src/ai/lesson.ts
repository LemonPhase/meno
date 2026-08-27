import { z } from "genkit";
import { ai, model } from "./genkit";
import type { Concept, Lesson } from "@/lib/types";

// The Learning loop's model calls: teach a Concept, hold the Lesson
// conversation, generate mastery Checks, grade answers, and write the
// closing Recap. Every call gets the Lesson so far as context — that's
// what "learning how the user learns" means in practice.

const transcript = (lesson: Pick<Lesson, "messages">) =>
  lesson.messages
    .map((m) => {
      const speaker =
        m.kind === "user" || m.kind === "check-answer" ? "Learner" : "Tutor";
      return `${speaker} (${m.kind}): ${m.text}`;
    })
    .join("\n");

const conceptIntro = (concept: Pick<Concept, "label" | "summary">) =>
  `Concept: ${concept.label} — ${concept.summary}`;

export const teachConcept = ai.defineFlow(
  {
    name: "teachConcept",
    inputSchema: z.object({
      topic: z.string(),
      concept: z.object({ label: z.string(), summary: z.string() }),
      unlockedLabels: z
        .array(z.string())
        .describe("concepts the learner has already unlocked"),
    }),
    outputSchema: z.object({ exposition: z.string() }),
  },
  async ({ topic, concept, unlockedLabels }) => {
    const res = await ai.generate({
      model,
      prompt: `You are a warm, precise tutor. The learner's goal: ${topic}.
${conceptIntro(concept)}
They already understand: ${unlockedLabels.join(", ") || "(nothing yet)"}.

Teach exactly this one concept, building on what they already understand.
Be concrete, use one good example, and keep it tight (150-300 words).
End by inviting questions, or to say when they're ready to be tested.`,
    });
    return { exposition: res.text };
  },
);

export const lessonReply = ai.defineFlow(
  {
    name: "lessonReply",
    inputSchema: z.object({
      topic: z.string(),
      concept: z.object({ label: z.string(), summary: z.string() }),
      lesson: z.object({
        messages: z.array(
          z.object({ kind: z.string(), text: z.string() }),
        ),
      }),
      message: z.string(),
    }),
    outputSchema: z.object({ reply: z.string() }),
  },
  async ({ topic, concept, lesson, message }) => {
    const res = await ai.generate({
      model,
      prompt: `You are a warm, precise tutor. The learner's goal: ${topic}.
${conceptIntro(concept)}

The lesson so far:
${transcript(lesson as Lesson)}

The learner says:
${message}

Answer helpfully and concisely, staying on this concept. If they seem ready,
remind them they can ask to be tested.`,
    });
    return { reply: res.text };
  },
);

export const generateMasteryCheck = ai.defineFlow(
  {
    name: "generateMasteryCheck",
    inputSchema: z.object({
      topic: z.string(),
      concept: z.object({ label: z.string(), summary: z.string() }),
      lesson: z.object({
        messages: z.array(
          z.object({ kind: z.string(), text: z.string() }),
        ),
      }),
    }),
    outputSchema: z.object({ question: z.string() }),
  },
  async ({ topic, concept, lesson }) => {
    const res = await ai.generate({
      model,
      prompt: `You are a tutor writing a mastery check. The learner's goal: ${topic}.
${conceptIntro(concept)}

The lesson so far (note any earlier check attempts — never repeat a question):
${transcript(lesson as Lesson)}

Write ONE fresh question that tests real understanding of this concept,
answerable in a sentence or two of free text.`,
      output: { schema: z.object({ question: z.string() }) },
    });
    const out = res.output;
    if (!out) throw new Error("mastery check: generation returned no output");
    return out;
  },
);

export const GradeSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  feedback: z
    .string()
    .describe("brief feedback: what was right, what was missing"),
});

export const gradeMasteryCheck = ai.defineFlow(
  {
    name: "gradeMasteryCheck",
    inputSchema: z.object({
      topic: z.string(),
      concept: z.object({ label: z.string(), summary: z.string() }),
      lesson: z.object({
        messages: z.array(
          z.object({ kind: z.string(), text: z.string() }),
        ),
      }),
      question: z.string(),
      answer: z.string(),
    }),
    outputSchema: GradeSchema,
  },
  async ({ topic, concept, lesson, question, answer }) => {
    const res = await ai.generate({
      model,
      prompt: `You are a tutor grading a mastery check. The learner's goal: ${topic}.
${conceptIntro(concept)}

The lesson so far:
${transcript(lesson as Lesson)}

Question: ${question}
Learner's answer: ${answer}

Grade it: "pass" only if the answer demonstrates real understanding of the
concept. Give brief, encouraging feedback either way — if it's a fail, say
what was missing without giving the full answer away.`,
      output: { schema: GradeSchema },
    });
    const out = res.output;
    if (!out) throw new Error("mastery check: grading returned no output");
    return out;
  },
);

export const writeRecap = ai.defineFlow(
  {
    name: "writeRecap",
    inputSchema: z.object({
      topic: z.string(),
      unlocked: z.array(
        z.object({
          label: z.string(),
          skipped: z.boolean(),
          origin: z.string(),
        }),
      ),
    }),
    outputSchema: z.object({ recap: z.string() }),
  },
  async ({ topic, unlocked }) => {
    const res = await ai.generate({
      model,
      prompt: `A learner just completed their learning path for: ${topic}.

What they unlocked, in order:
${unlocked
  .map(
    (c) =>
      `- ${c.label}${c.skipped ? " (already knew it)" : ""}${
        c.origin === "remedial" ? " (remedial detour)" : ""
      }`,
  )
  .join("\n")}

Write a short, congratulatory recap (100-150 words): celebrate the finish,
recount the shape of what they learned including any skips or remedial
detours, and encourage them to revisit their knowledge graph.`,
    });
    return { recap: res.text };
  },
);
