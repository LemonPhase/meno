#!/usr/bin/env node
/**
 * Copy one Graph onto another — the pre-auth `demoUser` Graph onto your own
 * Firebase uid, once you have signed in and know what it is.
 *
 * ADR-0005 made the uid the Graph id, which left every Graph written before
 * sign-in existed sitting under "demoUser" where nobody can reach it. This
 * moves it. Everything under `graphs/{from}` is copied verbatim — Concepts,
 * Sessions, Lessons, Checks, Edits — because ids are namespaced by Session,
 * not by Graph, so nothing needs rewriting.
 *
 *   npm run adopt -- --to <uid>              # dry run against GCP_PROJECT_ID
 *   npm run adopt -- --to <uid> --apply      # …and write
 *   npm run adopt -- --from demoUser --to <uid> --apply
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8792 npm run adopt -- --to <uid>
 *
 * The source is left untouched: this is a copy, so a bad --to can be
 * abandoned rather than recovered from. Re-running overwrites the same
 * documents, so it is idempotent — but a target that already holds a Graph
 * is refused unless you pass --merge, since the usual cause is a typo'd uid.
 *
 * Credentials and project id come from .env.local, the same file the app
 * reads — a plain `node` run doesn't pick it up the way `next` does.
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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

const flag = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
};

const apply = process.argv.includes("--apply");
const merge = process.argv.includes("--merge");
const from = flag("from") ?? "demoUser";
const to = flag("to");

if (!to || to.startsWith("--")) {
  console.error(
    "Which uid should the Graph move to? Pass --to <uid>.\n" +
      "It is shown on the Settings page once you are signed in.",
  );
  process.exit(1);
}
if (to === from) {
  console.error(`--from and --to are both "${from}"; nothing to do.`);
  process.exit(1);
}

const emulator = env("FIRESTORE_EMULATOR_HOST");
// Against the emulator any project id will do; against Google's Firestore
// guessing one is how you get a confusing PERMISSION_DENIED for a project
// that was never yours.
const projectId = env("GCP_PROJECT_ID") ?? (emulator ? "demo-meno" : null);
if (!projectId) {
  console.error(
    "GCP_PROJECT_ID is not set, and no FIRESTORE_EMULATOR_HOST either.\n" +
      "Set GCP_PROJECT_ID (or put it in .env.local) to touch your real\n" +
      "Firestore, or point FIRESTORE_EMULATOR_HOST at the emulator.",
  );
  process.exit(1);
}

const db = getFirestore(initializeApp({ projectId }));
const graphs = db.collection("graphs");
const COLLECTIONS = ["concepts", "sessions", "lessons", "checks", "edits"];

// Say plainly what is about to be touched: one of these is production.
const target = emulator
  ? `Target: emulator at ${emulator} (project "${projectId}")`
  : `Target: LIVE Firestore, project "${projectId}"`;

async function main() {
  console.log(`${target}\nCopying graphs/${from} → graphs/${to}\n`);

  const source = graphs.doc(from);
  const [sourceDoc, ...sourceSnaps] = await Promise.all([
    source.get(),
    ...COLLECTIONS.map((name) => source.collection(name).get()),
  ]);

  const counts = Object.fromEntries(
    COLLECTIONS.map((name, i) => [name, sourceSnaps[i].size]),
  );
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0 && !sourceDoc.exists) {
    console.log(`Nothing at graphs/${from} — no Graph to copy.`);
    return;
  }

  const existing = await Promise.all(
    COLLECTIONS.map((name) => graphs.doc(to).collection(name).limit(1).get()),
  );
  const occupied = existing.some((snap) => !snap.empty);
  if (occupied && !merge) {
    console.error(
      `graphs/${to} already holds a Graph. A wrong uid is the usual reason\n` +
        "for seeing this — check it on the Settings page. To copy on top of\n" +
        "what is there anyway, re-run with --merge.",
    );
    process.exit(1);
  }

  for (const name of COLLECTIONS) {
    console.log(`  ${name}: ${counts[name]}`);
  }
  console.log(`  ${total} document(s) in all`);

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to write.");
    return;
  }

  // Batches cap at 500 writes, and a Graph can exceed that.
  let batch = db.batch();
  let queued = 0;
  const flush = async () => {
    if (queued === 0) return;
    await batch.commit();
    batch = db.batch();
    queued = 0;
  };
  const write = async (ref, data) => {
    batch.set(ref, data);
    if (++queued === 450) await flush();
  };

  const destination = graphs.doc(to);
  if (sourceDoc.exists) await write(destination, sourceDoc.data());
  for (const [i, name] of COLLECTIONS.entries()) {
    for (const doc of sourceSnaps[i].docs) {
      await write(destination.collection(name).doc(doc.id), doc.data());
    }
  }
  await flush();

  console.log(
    `\nDone — ${total} document(s) copied. graphs/${from} is untouched;\n` +
      "delete it yourself once you are satisfied the copy is good.",
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
