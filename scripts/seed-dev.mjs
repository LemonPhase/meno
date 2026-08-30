#!/usr/bin/env node
// Seed the Firestore emulator with a Graph that exercises every UI state,
// so working on the interface needs no model calls at all: three Sessions
// (one mid-Path with its Check still to face, one mid-Path with it passed
// and the move on offer, one complete), a remedial detour, both kinds of
// skip, Lessons with markdown and mathematics, Checks, and an Edit.
//
//   npm run seed          seed alongside whatever is already there
//   npm run seed -- --reset   wipe the Graph first
//
// The emulator only. This refuses to run against live Firestore — see the
// guard below — because it writes fabricated learning data.

if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // No .env.local is fine; the defaults below cover it.
  }
}

const env = (name) => {
  const value = process.env[name];
  return value !== undefined && value !== "" ? value : undefined;
};

const host = env("FIRESTORE_EMULATOR_HOST") ?? "127.0.0.1:8792";
process.env.FIRESTORE_EMULATOR_HOST = host;

// The emulator namespaces by the project the *client* connects as, not by
// whatever --project started it, so this must match what the app uses or
// the seeded Graph lands somewhere the app never looks.
const projectId = env("GCP_PROJECT_ID");
if (!projectId) {
  console.error(
    "GCP_PROJECT_ID is not set. The emulator stores data under the project\n" +
      "the client connects as, so seeding without it would write to a\n" +
      "namespace the app never reads. Set it in .env.local.",
  );
  process.exit(1);
}

// A live connection would be a real write of fabricated data to a real
// user's Graph. Reachability of the emulator is the only proof we accept.
try {
  const res = await fetch(`http://${host}/`);
  if (!res.ok) throw new Error(String(res.status));
} catch {
  console.error(
    `No Firestore emulator answering at ${host}.\n` +
      "Start one first (npm run dev:emu), or point FIRESTORE_EMULATOR_HOST\n" +
      "at a running emulator. This script never writes to live Firestore.",
  );
  process.exit(1);
}

const { initializeApp } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
initializeApp({ projectId });
const db = getFirestore();

const GRAPH_ID = "demoUser";
const graph = db.collection("graphs").doc(GRAPH_ID);

console.log(`Target: emulator at ${host}, project "${projectId}"`);
console.log(`Graph:  ${GRAPH_ID}`);

const reset = process.argv.includes("--reset");
if (reset) {
  await db.recursiveDelete(graph);
  console.log("Reset:  existing Graph deleted");
}

const t0 = Date.now() - 1000 * 60 * 60 * 24 * 3;
let clock = t0;
const at = (minutes = 7) => (clock += minutes * 60 * 1000);

const batch = db.batch();
const concept = (c) => batch.set(graph.collection("concepts").doc(c.id), c);
const put = (col, id, doc) => batch.set(graph.collection(col).doc(id), doc);

/* ---------------- Session one: complete, with a detour ---------------- */

const S1 = "seed-svm";
const svm = [
  ["vector-space", "Vector Space", "A set closed under addition and scalar multiplication.", [], true],
  ["hyperplane", "Hyperplane", "A flat subspace one dimension below the space holding it.", ["vector-space"], true],
  ["hard-margin", "Hard Margin", "The widest separating slab when the data separates cleanly.", ["hyperplane"], true],
  ["support-vectors", "Support Vectors", "The few points touching the margin, which alone determine it.", ["hard-margin"], true],
  ["soft-margin", "Soft Margin", "Allowing bounded violations so noisy data still separates.", ["support-vectors"], true],
];
for (const [key, label, summary, requires, unlocked] of svm) {
  concept({
    id: `${S1}_${key}`,
    label,
    summary,
    unlocked,
    skipped: false,
    requires: requires.map((r) => `${S1}_${r}`),
    originSessionId: S1,
    createdAt: at(2),
  });
}
// A remedial detour, spliced in after the learner asked to break it down.
concept({
  id: `${S1}_rem_lagrange`,
  label: "Lagrange duality",
  summary: "Turning a constrained problem into its dual.",
  unlocked: true,
  skipped: false,
  requires: [`${S1}_soft-margin`],
  originSessionId: S1,
  createdAt: at(2),
});
// Found already known by the diagnostic: unlocked, and never on the Path.
concept({
  id: `${S1}_calculus`,
  label: "Partial Derivatives",
  summary: "Differentiating one variable while the rest are held fixed.",
  unlocked: true,
  skipped: true,
  requires: [],
  originSessionId: S1,
  createdAt: at(1),
});

put("sessions", S1, {
  id: S1,
  topic: "support vector machines",
  phase: "complete",
  activeConceptId: null,
  recap: "You built up from **vector spaces** to the margin itself, took a detour through Lagrange duality, and finished at the separating condition $\\mathbf{w}^\\top\\mathbf{x} + b = 0$.",
  conceptIds: [...svm.map(([k]) => `${S1}_${k}`), `${S1}_rem_lagrange`, `${S1}_calculus`],
  path: [
    ...svm.map(([k]) => ({ conceptId: `${S1}_${k}`, origin: "planned" })),
    { conceptId: `${S1}_rem_lagrange`, origin: "remedial" },
  ],
  createdAt: t0,
});

put("lessons", `${S1}__${S1}_hyperplane`, {
  sessionId: S1,
  conceptId: `${S1}_hyperplane`,
  messages: [
    {
      kind: "exposition",
      text: "A **hyperplane** in $\\mathbb{R}^n$ is the solution set of a single linear equation:\n\n$$\n\\mathbf{w}^\\top \\mathbf{x} + b = 0\n$$\n\nIn $\\mathbb{R}^2$ that is a line; in $\\mathbb{R}^3$, a plane. The vector $\\mathbf{w}$ is normal to it, and $b$ slides it off the origin.\n\n- $\\mathbf{w}$ sets the orientation\n- $b$ sets the offset\n\n```viz\n<figure class=\"viz\">\n  <figcaption class=\"sc viz-cap\">One equation, one flat surface</figcaption>\n  <ol class=\"viz-flow\">\n    <li class=\"viz-step\"><span class=\"viz-tag sc\">The equation</span> every x with w\u00b7x held constant</li>\n    <li class=\"viz-step\"><span class=\"viz-tag sc\">The shape</span> flat — a line in the plane, a plane in space</li>\n    <li class=\"viz-step viz-now\"><span class=\"viz-tag sc\">The normal</span> w points straight out of it</li>\n  </ol>\n</figure>\n```",
      createdAt: at(),
    },
    { kind: "user", text: "So w always points away from the surface?", createdAt: at(1) },
    {
      kind: "reply",
      text: "Perpendicular to it, and its sign picks a side — which is exactly what lets $\\operatorname{sign}(\\mathbf{w}^\\top\\mathbf{x}+b)$ act as a classifier.",
      createdAt: at(1),
    },
    { kind: "check-question", text: "Why is $\\mathbf{w}$ called the normal vector?", checkId: "seed-check-1", createdAt: at(2) },
    { kind: "check-answer", text: "Because it is perpendicular to the hyperplane.", checkId: "seed-check-1", createdAt: at(1) },
    { kind: "check-feedback", text: "Exactly right — and that is why the distance from a point to the plane divides by $\\lVert\\mathbf{w}\\rVert$.", checkId: "seed-check-1", createdAt: at(1) },
  ],
});

put("checks", "seed-check-1", {
  id: "seed-check-1",
  sessionId: S1,
  phase: "mastery",
  conceptIds: [`${S1}_hyperplane`],
  question: "Why is $\\mathbf{w}$ called the normal vector?",
  answer: "Because it is perpendicular to the hyperplane.",
  verdict: "pass",
  createdAt: at(),
});

/* ------------- Session two: learning, mid-Path, with a skip ------------- */

const S2 = "seed-attn";
const attn = [
  ["dot-product", "Dot Product as Similarity", "Why an inner product reads as alignment.", [], "unlocked"],
  ["softmax", "Softmax and Scaling", "Turning scores into weights that sum to one.", ["dot-product"], "skipped"],
  ["qkv", "Query, Key, Value", "Three projections of the same sequence, each with a role.", ["softmax"], "active"],
  ["masking", "Attention Masking", "Preventing a position from reading the future.", ["qkv"], "locked"],
  ["attention", "Scaled Dot-Product Attention", "The whole mechanism assembled.", ["masking"], "locked"],
];
for (const [key, label, summary, requires, state] of attn) {
  concept({
    id: `${S2}_${key}`,
    label,
    summary,
    // "skipped" here is a mid-Session skip_next: unlocked, but still on
    // the Path — distinct from the diagnostic's "already known" above.
    unlocked: state === "unlocked" || state === "skipped",
    skipped: state === "skipped",
    requires: requires.map((r) => `${S2}_${r}`),
    originSessionId: S2,
    createdAt: at(1),
  });
}

put("sessions", S2, {
  id: S2,
  topic: "attention in transformers",
  phase: "learning",
  activeConceptId: `${S2}_qkv`,
  recap: null,
  conceptIds: attn.map(([k]) => `${S2}_${k}`),
  path: attn.map(([k]) => ({ conceptId: `${S2}_${k}`, origin: "planned" })),
  createdAt: at(60),
});

put("lessons", `${S2}__${S2}_qkv`, {
  sessionId: S2,
  conceptId: `${S2}_qkv`,
  messages: [
    {
      kind: "exposition",
      text: "Attention gives every token three roles at once. From one input $\\mathbf{x}$ we make:\n\n$$\n\\begin{aligned}\n\\mathbf{q} &= W_Q\\,\\mathbf{x} \\\\\n\\mathbf{k} &= W_K\\,\\mathbf{x} \\\\\n\\mathbf{v} &= W_V\\,\\mathbf{x}\n\\end{aligned}\n$$\n\nThe **query** asks, the **key** advertises, and the **value** is what gets carried forward once the match is scored.",
      createdAt: at(),
    },
    { kind: "event", text: "Softmax and Scaling skipped — you already had it", createdAt: at(1) },
  ],
});

// Primed, not revealed: a Concept's one mastery question is written with
// its exposition and waits there, so "Test me" costs nothing. Absent from
// the Lesson's messages is exactly what makes it primed rather than asked.
put("checks", "seed-check-2", {
  id: "seed-check-2",
  sessionId: S2,
  phase: "mastery",
  conceptIds: [`${S2}_qkv`],
  question: "If the query and key projections were the same matrix, what would break?",
  answer: null,
  verdict: null,
  createdAt: at(),
});

/* ---------- Session three: learning, Check passed, free to move on ---------- */

const S3 = "seed-bayes";
const bayes = [
  ["conditional", "Conditional Probability", "Restricting the sample space to what you already know.", [], "unlocked"],
  ["bayes", "Bayes' Rule", "Inverting a conditional by weighting it with the prior.", ["conditional"], "active"],
  ["posterior", "Posterior Predictive", "Averaging predictions over what you still don't know.", ["bayes"], "locked"],
];
for (const [key, label, summary, requires, state] of bayes) {
  concept({
    id: `${S3}_${key}`,
    label,
    summary,
    unlocked: state === "unlocked",
    skipped: false,
    requires: requires.map((r) => `${S3}_${r}`),
    originSessionId: S3,
    createdAt: at(1),
  });
}

put("sessions", S3, {
  id: S3,
  topic: "bayesian inference",
  phase: "learning",
  activeConceptId: `${S3}_bayes`,
  recap: null,
  conceptIds: bayes.map(([k]) => `${S3}_${k}`),
  path: bayes.map(([k]) => ({ conceptId: `${S3}_${k}`, origin: "planned" })),
  createdAt: at(30),
});

put("lessons", `${S3}__${S3}_bayes`, {
  sessionId: S3,
  conceptId: `${S3}_bayes`,
  messages: [
    {
      kind: "exposition",
      text: "Bayes' rule is conditional probability read backwards:\n\n$$\nP(H \\mid E) = \\frac{P(E \\mid H)\\,P(H)}{P(E)}\n$$\n\nThe **likelihood** $P(E \\mid H)$ says how well the hypothesis explains what you saw; the **prior** $P(H)$ says how much you believed it beforehand. Their product, normalised, is the **posterior**.",
      createdAt: at(),
    },
    { kind: "check-question", text: "A test with a 1% false positive rate comes back positive for a disease affecting 1 in 10,000. Why is the posterior still small?", checkId: "seed-check-3", createdAt: at(2) },
    { kind: "check-answer", text: "Because the prior is tiny, so most positives are false ones from the huge healthy group.", checkId: "seed-check-3", createdAt: at(1) },
    { kind: "check-feedback", text: "Right — the base rate does the work. Worth carrying forward: 100 false positives against 1 true one is the whole of the argument, and it is the *ratio* of those counts, not either alone, that the posterior reports.", checkId: "seed-check-3", createdAt: at(1) },
  ],
});

// Passed, and the Concept still Active: the learner has earned the move to
// the next Concept and has not taken it. This is the state the "Next
// concept" offer renders from — see passedCheck in @/lib/checks.
put("checks", "seed-check-3", {
  id: "seed-check-3",
  sessionId: S3,
  phase: "mastery",
  conceptIds: [`${S3}_bayes`],
  question: "A test with a 1% false positive rate comes back positive for a disease affecting 1 in 10,000. Why is the posterior still small?",
  answer: "Because the prior is tiny, so most positives are false ones from the huge healthy group.",
  verdict: "pass",
  createdAt: at(),
});

put("edits", "seed-edit-1", {
  id: "seed-edit-1",
  conceptId: `${S2}_dot-product`,
  kind: "rename",
  before: "Dot product",
  after: "Dot Product as Similarity",
  createdAt: at(2),
});

await batch.commit();

const counts = await Promise.all(
  ["concepts", "sessions", "lessons", "checks", "edits"].map(async (c) => [
    c,
    (await graph.collection(c).get()).size,
  ]),
);
console.log(
  "Seeded: " + counts.map(([c, n]) => `${n} ${c}`).join(" · "),
);
console.log(`Open:   http://localhost:3000/sessions/${S2}  (mid-Path, Check still to face)`);
console.log(`        http://localhost:3000/sessions/${S3}  (Check passed, free to move on)`);
