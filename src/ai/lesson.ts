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

/**
 * The reading surface renders Markdown, not LaTeX: a `$P(H)$` reaches the
 * learner as literal dollar signs. Mathematics belongs in the prose voice,
 * written with the characters a typesetter would use.
 */
const VOICE = `Write for a reading surface that renders Markdown, and LaTeX
through KaTeX. Set every piece of mathematics in TeX: $...$ inline, and
$$ for a displayed formula. A displayed formula must be written with the
opening $$ ALONE on its own line and the closing $$ ALONE on its own line
— never "$$\\begin{aligned}" and never "\\end{aligned}$$" — like this:

$$
\\begin{aligned}
f(x) &= x^2 \\\\
     &= x \\cdot x
\\end{aligned}
$$

Use only commands KaTeX supports (\\frac, \\sum, \\sqrt, \\cdot, \\text{},
\\mathbb{}, aligned) — no packages, no \\newcommand, and end every row of
an aligned block with \\\\. Write a literal dollar amount as \\$ so it is
not read as maths. Reserve fenced code blocks for actual code. Use
Markdown (bold, lists, tables) where it genuinely helps.`;

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
      prompt: `Write the reference entry for one Concept in a learner's path
toward: ${topic}.
${conceptIntro(concept)}
The reader already understands: ${unlockedLabels.join(", ") || "(nothing yet)"}.

This is a formal, encyclopedic page, not a greeting or a chat message — it
is the thing the learner lands on, before they've asked anything. Open with
a precise definition, then explain the mechanism or reasoning behind it,
building on what the reader already understands, and give one concrete
example. Write in the expository register: no "you", no "let's", no
"welcome back", no inviting questions — that voice belongs to the
conversation that follows, once the reader actually asks something. Keep it
tight (150-300 words).

${VOICE}`,
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
remind them they can ask to be tested.

${VOICE}`,
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
answerable in a sentence or two of free text.

${VOICE}`,
      output: { schema: z.object({ question: z.string() }) },
    });
    const out = res.output;
    if (!out) throw new Error("mastery check: generation returned no output");
    return out;
  },
);

// ADR-0001: the Adjustment is bounded to exactly two actions riding on the
// grading call — never a replan of the remaining Path.
export const GradeSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  feedback: z
    .string()
    .describe("brief feedback: what was right, what was missing"),
  adjustment: z
    .enum(["none", "insert_remedial", "skip_next"])
    .default("none")
    .describe(
      "insert_remedial: the answer reveals a real gap that needs its own " +
        "small lesson spliced in next. skip_next: the answer clearly " +
        "demonstrates the NEXT concept too. Otherwise none.",
    ),
  remedial: z
    .object({
      label: z
        .string()
        .describe(
          "short human-readable concept name, as it will be shown to the " +
            "learner (e.g. 'Mutually exclusive events') — never an " +
            "identifier like mutually_exclusive_events, and never TeX",
        ),
      summary: z
        .string()
        .describe(
          "one sentence: what this fills in. Plain prose — this is shown " +
            "outside the lesson, where markdown and TeX do not render",
        ),
    })
    .optional()
    .describe("required when adjustment is insert_remedial"),
});

export const gradeMasteryCheck = ai.defineFlow(
  {
    name: "gradeMasteryCheck",
    inputSchema: z.object({
      topic: z.string(),
      concept: z.object({ label: z.string(), summary: z.string() }),
      nextConcept: z
        .object({ label: z.string(), summary: z.string() })
        .nullable()
        .describe("the next concept on the path, if any"),
      lesson: z.object({
        messages: z.array(
          z.object({ kind: z.string(), text: z.string() }),
        ),
      }),
      question: z.string(),
      answer: z.string(),
      editContext: z
        .string()
        .default("")
        .describe("how the learner has curated their graph so far"),
    }),
    outputSchema: GradeSchema,
  },
  async ({
    topic,
    concept,
    nextConcept,
    lesson,
    question,
    answer,
    editContext,
  }) => {
    const res = await ai.generate({
      model,
      prompt: `You are a tutor grading a mastery check. The learner's goal: ${topic}.
${conceptIntro(concept)}
Next on their path: ${
        nextConcept
          ? `${nextConcept.label} — ${nextConcept.summary}`
          : "(nothing — this is the last concept)"
      }

The lesson so far:
${transcript(lesson as Lesson)}

Question: ${question}
Learner's answer: ${answer}

Grade it: "pass" only if the answer demonstrates real understanding of the
concept. Give brief, encouraging feedback either way — if it's a fail, say
what was missing without giving the full answer away.

${VOICE}

You may also adjust the path (adjustment field):
- "insert_remedial" with a remedial {label, summary} when the answer reveals
  a specific underlying gap worth its own small lesson before continuing.
- "skip_next" when the answer ALSO clearly demonstrates understanding of the
  next concept on the path.
- otherwise "none". Use these sparingly — only on strong evidence.
${editContext ? `\n${editContext}\nNever insert a remedial that recreates something they deleted.` : ""}`,
      output: { schema: GradeSchema },
    });
    const out = res.output;
    if (!out) throw new Error("mastery check: grading returned no output");
    if (out.adjustment === "insert_remedial" && !out.remedial) {
      return { ...out, adjustment: "none" as const };
    }
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
detours, and encourage them to revisit their knowledge graph.

${VOICE}`,
    });
    return { recap: res.text };
  },
);

/**
 * "Break it down" (CONTEXT.md): the learner says the Active Concept is too
 * hard. Too hard means a prerequisite is missing — every Concept should sit
 * on the leaf of what they already know — so the answer is an
 * insert_remedial Adjustment, never a restructuring of the Concept itself.
 * Only when the transcript carries no signal at all does it ask instead.
 */
export const BreakdownSchema = z.object({
  action: z
    .enum(["insert_remedial", "ask"])
    .describe(
      "insert_remedial when the lesson so far shows what they are missing; " +
        "ask only when there is genuinely nothing to go on yet",
    ),
  message: z
    .string()
    .describe(
      "insert_remedial: one or two sentences naming the gap and the detour. " +
        "ask: a single question about what is not landing.",
    ),
  remedial: z
    .object({
      label: z
        .string()
        .describe(
          "short human-readable concept name, as it will be shown to the " +
            "learner (e.g. 'Mutually exclusive events') — never an " +
            "identifier like mutually_exclusive_events, and never TeX",
        ),
      summary: z
        .string()
        .describe(
          "one sentence: what this fills in. Plain prose — this is shown " +
            "outside the lesson, where markdown and TeX do not render",
        ),
    })
    .optional()
    .describe("required when action is insert_remedial"),
});

export const breakDownConcept = ai.defineFlow(
  {
    name: "breakDownConcept",
    inputSchema: z.object({
      topic: z.string(),
      concept: z.object({ label: z.string(), summary: z.string() }),
      lesson: z.object({
        messages: z.array(z.object({ kind: z.string(), text: z.string() })),
      }),
      unlockedLabels: z.array(z.string()).default([]),
      editContext: z.string().default(""),
    }),
    outputSchema: BreakdownSchema,
  },
  async ({ topic, concept, lesson, unlockedLabels, editContext }) => {
    const res = await ai.generate({
      model,
      prompt: `You are a warm, precise tutor. The learner's goal: ${topic}.
${conceptIntro(concept)}
They already understand: ${unlockedLabels.join(", ") || "(nothing yet)"}.

The lesson so far:
${transcript(lesson as Lesson)}

The learner has just said this concept is too hard. That means something it
rests on is missing, not that the concept should be broken into pieces.

From the lesson so far — their questions, and any check attempts — identify
the ONE prerequisite that is actually missing and return "insert_remedial"
with a small, atomic remedial concept for it, plus a message naming the gap
and the detour in a sentence or two. Do not propose something they already
understand.

Only if the lesson so far gives you genuinely nothing to go on, return "ask"
with a single question about what is not landing.

${VOICE}
${editContext ? `\n${editContext}\nNever insert a remedial that recreates something they deleted.` : ""}`,
      output: { schema: BreakdownSchema },
    });
    const out = res.output;
    if (!out) throw new Error("break down: generation returned no output");
    if (out.action === "insert_remedial" && !out.remedial) {
      return { ...out, action: "ask" as const };
    }
    return out;
  },
);
