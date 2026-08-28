# Meno

A learning assistant that turns any topic into a personal, adaptive curriculum.

Give it a topic (or a concept you're stuck on), and the agent investigates it, figures out what you need to know first, asks you questions to find out where you actually are, then walks you through it one atomic concept at a time — quizzing you as it goes and adapting the path when you struggle or when you already know more than it assumed. Everything you unlock becomes a node in a personal knowledge graph you can inspect, correct, and grow over time.

Named after Plato's *Meno* — the dialogue built around the paradox of how you search for knowledge you don't yet have.

## How it works

1. **Enter a topic** — a bare concept name or pasted text (e.g. an abstract).
2. **Investigate** — the agent researches the topic with Google Search grounding and identifies its prerequisites.
3. **Diagnose** — it asks you questions on the prerequisites and the topic itself to find your starting point.
4. **Preview the path** — it plans an ordered list of atomic concept nodes and shows you the whole journey upfront.
5. **Learn, one node at a time** — each node is taught and quizzed only when you reach it (lazy generation). Two levers sit in the composer: **Test me** when it's too easy (it skips the teaching, never the verification), and **Break it down** when it's too hard (the agent finds the prerequisite you're missing and teaches that first, as a short detour). Your answers can also trigger the agent to insert a remedial node or skip the next one — the graph reshapes live as this happens.
6. **Review the graph** — unlocked concepts form a node-link graph; each node links back to the session where you learned it. You can rename or delete nodes yourself; edits are recorded in an audit log that feeds back into future graph updates.

Sessions behave like conversations: several can be in progress at once, each resumable where you left off, and they all feed the one graph. A topic that rests on something you've already learned *attaches* to the concept you already have rather than duplicating it — and if you've already unlocked it, it's skipped rather than taught twice.

## Stack

- **Next.js** (App Router, TypeScript) — UI and API routes
- **Genkit** (`@genkit-ai/vertexai`) — agent orchestration, Gemini 3.5, Google Search grounding
- **Firestore** — graph nodes/edges, sessions, audit log
- **Cloud Run** — deployment target

## Getting started

### Prerequisites

- Node.js 22+
- A GCP project with the Vertex AI API enabled and billing configured
- A Firebase project (can be the same GCP project) with Firestore enabled

### Setup

```bash
npm install
cp .env.local.example .env.local
# set GCP_PROJECT_ID to your project; keep GCP_LOCATION=global
# (gemini-3.5 models are served from the global Vertex endpoint)
gcloud auth application-default login   # local Vertex AI + Firestore admin credentials
gcloud services enable aiplatform.googleapis.com firestore.googleapis.com
```

### Run locally

Two modes:

```bash
npm run dev       # real Gemini + your project's real Firestore
npm run dev:emu   # real Gemini + local Firestore emulator (data persists in .emulator-data/)
```

Open http://localhost:3000. `dev:emu` is the safe dogfooding mode: Sessions live only on your machine and survive restarts, without touching production data.

### Seed the emulator

Working on the interface needs a Graph to look at, and building one through the app costs real model calls. With `dev:emu` running:

```bash
npm run seed              # a Graph covering every UI state
npm run seed -- --reset   # wipe it first
```

That gives you two Sessions (one mid-Path, one complete), a remedial detour, both kinds of skip, Lessons with markdown and mathematics, a Check and an Edit — enough to exercise every screen without calling a model. It refuses to run unless it can reach an emulator, so it can never write to live Firestore.

### Run the tests

```bash
npm test
```

### Migrating an existing graph

The schema changed when Path state moved off the Concept and onto the
Session (ADR-0004). The app reads graphs written before that change, but to
rewrite them for good:

```bash
npm run migrate                 # dry run: prints what would change
npm run migrate -- --apply      # writes it

# against the emulator instead of your real Firestore:
FIRESTORE_EMULATOR_HOST=127.0.0.1:8792 npm run migrate
```

It reads `.env.local` for `GCP_PROJECT_ID` and credentials, names the target
it is about to touch (live Firestore or the emulator) before doing anything,
and refuses to run rather than guess a project id. It is idempotent: a graph
already in the new shape is left alone.

Tests are black-box: they call the server interface (route handlers) the way the browser would, running against the **Firestore emulator** (needs Java 21+; started automatically) with a **scripted fake model** substituted at the model-injection seam (`MENO_MODEL=scripted`), so no GCP credentials or network are needed.

### Deploy to Cloud Run

**CI/CD (how deploys actually happen):** every push to `main` runs `.github/workflows/deploy.yml` — lint + the emulator test suite, then (via Workload Identity Federation, no stored keys) builds the Docker image, pushes it to Artifact Registry, and deploys to Cloud Run as the `meno-runtime` service account. Configuration comes from GitHub repo variables: `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_WIF_PROVIDER`, `GCP_DEPLOYER_SA`, `GCP_RUNTIME_SA`.

**Manual deploy** (equivalent, for a machine with `gcloud`):

One-time: create the runtime service account and grant it the two roles the app needs.

```bash
gcloud iam service-accounts create meno-runtime \
  --display-name="Meno Cloud Run runtime" --project=<your-project-id>

gcloud projects add-iam-policy-binding <your-project-id> \
  --member="serviceAccount:meno-runtime@<your-project-id>.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

gcloud projects add-iam-policy-binding <your-project-id> \
  --member="serviceAccount:meno-runtime@<your-project-id>.iam.gserviceaccount.com" \
  --role="roles/datastore.user"
```

Then deploy (note `GCP_LOCATION=global` — gemini-3.5 models are only served from the global Vertex endpoint; the Cloud Run region is independent of it):

```bash
gcloud run deploy meno \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --service-account meno-runtime@<your-project-id>.iam.gserviceaccount.com \
  --set-env-vars GCP_PROJECT_ID=<your-project-id>,GCP_LOCATION=global
```

## Status

Early build — in progress. Current scope is a single learning session per demo user (no auth), text-only topic input (file upload planned), and a bounded adaptive path (insert-remedial / skip-next). Cross-session graph merging, richer graph editing (merge nodes, manual edges), and a dedicated LLM-analysis layer over the edit audit log are explicit future work.
