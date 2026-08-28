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
 *   node scripts/migrate-adr-0004.mjs                     # against the emulator
 *   node scripts/migrate-adr-0004.mjs --apply             # …and write
 *   FIRESTORE_EMULATOR_HOST= node scripts/migrate-adr-0004.mjs --apply  # production
 */
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const apply = process.argv.includes("--apply");
const graphId = process.env.MENO_GRAPH_ID ?? "demoUser";
const projectId = process.env.GCP_PROJECT_ID ?? "demo-meno";

const db = getFirestore(initializeApp({ projectId }));
const graph = db.collection("graphs").doc(graphId);

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
    console.log(`Graph "${graphId}" is already in the ADR-0004 shape.`);
    return;
  }
  console.log(
    `${apply ? "Migrating" : "Would migrate"} graph "${graphId}" on project "${projectId}":`,
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
