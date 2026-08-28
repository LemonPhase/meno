#!/usr/bin/env node
/**
 * Migrate a Graph written before ADR-0004 (Path state moved off the Concept
 * and onto the Session).
 *
 *   Concept: status/order/origin/sessionId/extractionIndex
 *            → unlocked + originSessionId
 *   Session: + conceptIds[] and path[] (derived from the old orders)
 *   Lesson:  keyed by conceptId → keyed by sessionId__conceptId
 *
 * Idempotent: documents already in the new shape are left alone, so it is
 * safe to run twice. Dry run by default — pass --apply to write.
 *
 *   npm run migrate                  # dry run against GCP_PROJECT_ID
 *   npm run migrate -- --apply       # …and write
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8792 npm run migrate   # the emulator
 *
 * Credentials and project id come from .env.local, the same file the app
 * reads — a plain `node` run doesn't pick it up the way `next` does.
 */
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Not every checkout has one; the environment may supply these directly.
  }
}

/** An env var that is set but empty is not set. */
const env = (key) => {
  const value = process.env[key];
  return value && value.trim() !== "" ? value.trim() : undefined;
};

const apply = process.argv.includes("--apply");
const graphId = env("MENO_GRAPH_ID") ?? "demoUser";
const emulator = env("FIRESTORE_EMULATOR_HOST");
// Against the emulator any project id will do; against Google's Firestore
// guessing one is how you get a confusing PERMISSION_DENIED for a project
// that was never yours.
const projectId = env("GCP_PROJECT_ID") ?? (emulator ? "demo-meno" : null);
if (!projectId) {
  console.error(
    "GCP_PROJECT_ID is not set, and no FIRESTORE_EMULATOR_HOST either.\n" +
      "Set GCP_PROJECT_ID (or put it in .env.local) to migrate your real\n" +
      "Firestore, or point FIRESTORE_EMULATOR_HOST at the emulator.",
  );
  process.exit(1);
}

const db = getFirestore(initializeApp({ projectId }));
const graph = db.collection("graphs").doc(graphId);

// Say plainly what is about to be touched: one of these is production.
const target = emulator
  ? `Target: emulator at ${emulator} (project "${projectId}")`
  : `Target: LIVE Firestore, project "${projectId}"`;

const plan = [];
const note = (what) => plan.push(what);

async function main() {
  const [sessionSnap, conceptSnap, lessonSnap] = await Promise.all([
    graph.collection("sessions").get(),
    graph.collection("concepts").get(),
    graph.collection("lessons").get(),
  ]);

  const concepts = conceptSnap.docs.map((d) => ({ ref: d.ref, data: d.data() }));
  const batch = db.batch();

  // --- Concepts: durable facts only ---
  for (const { ref, data } of concepts) {
    if (data.unlocked !== undefined && data.originSessionId !== undefined) continue;
    const update = {
      unlocked: data.unlocked ?? data.status === "unlocked",
      skipped: data.skipped ?? false,
      originSessionId: data.originSessionId ?? data.sessionId ?? "",
      status: FieldValue.delete(),
      origin: FieldValue.delete(),
      order: FieldValue.delete(),
      sessionId: FieldValue.delete(),
      extractionIndex: FieldValue.delete(),
    };
    note(`concept ${data.label} → unlocked=${update.unlocked}`);
    if (apply) batch.update(ref, update);
  }

  // --- Sessions: gain conceptIds and the Path ---
  for (const doc of sessionSnap.docs) {
    const data = doc.data();
    if (Array.isArray(data.path) && Array.isArray(data.conceptIds)) continue;
    const mine = concepts
      .filter((c) => c.data.sessionId === data.id)
      .sort(
        (a, b) =>
          (a.data.extractionIndex ?? a.data.createdAt ?? 0) -
          (b.data.extractionIndex ?? b.data.createdAt ?? 0),
      );
    const path = mine
      .filter((c) => c.data.order !== null && c.data.order !== undefined)
      .sort((a, b) => a.data.order - b.data.order)
      .map((c) => ({
        conceptId: c.data.id,
        origin: c.data.origin ?? "planned",
      }));
    note(
      `session "${data.topic}" → ${mine.length} concepts, path of ${path.length}`,
    );
    if (apply) {
      batch.update(doc.ref, {
        conceptIds: mine.map((c) => c.data.id),
        path,
      });
    }
  }

  // --- Lessons: re-key by Session and Concept ---
  const moves = [];
  for (const doc of lessonSnap.docs) {
    const data = doc.data();
    const key = `${data.sessionId}__${data.conceptId}`;
    if (doc.id === key) continue;
    note(`lesson ${doc.id} → ${key}`);
    moves.push({ from: doc.ref, to: graph.collection("lessons").doc(key), data });
  }
  if (apply) {
    for (const move of moves) {
      batch.set(move.to, move.data);
      batch.delete(move.from);
    }
  }

  if (plan.length === 0) {
    console.log(`${target}\nGraph "${graphId}" is already in the ADR-0004 shape.`);
    return;
  }
  console.log(
    `${target}\n${apply ? "Migrating" : "Would migrate"} graph "${graphId}":`,
  );
  for (const line of plan) console.log(`  ${line}`);
  if (apply) {
    await batch.commit();
    console.log(`\nDone — ${plan.length} change(s) written.`);
  } else {
    console.log(`\n${plan.length} change(s). Re-run with --apply to write.`);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
