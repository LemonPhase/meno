# Meno

A learning assistant that turns any topic into a personal, adaptive curriculum.

Give it a topic (or a concept you're stuck on), and the agent investigates it, figures out what you need to know first, asks you questions to find out where you actually are, then walks you through it one atomic concept at a time — quizzing you as it goes and adapting the path when you struggle or when you already know more than it assumed. Everything you unlock becomes a node in a personal knowledge graph you can inspect, correct, and grow over time.

Named after Plato's *Meno* — the dialogue built around the paradox of how you search for knowledge you don't yet have.

## How it works

1. **Enter a topic** — a bare concept name or pasted text (e.g. an abstract).
2. **Investigate** — the agent researches the topic with Google Search grounding and identifies its prerequisites.
3. **Diagnose** — it asks you questions on the prerequisites and the topic itself to find your starting point.
4. **Preview the path** — it plans an ordered list of atomic concept nodes and shows you the whole journey upfront.
5. **Learn, one node at a time** — each node is taught and quizzed only when you reach it (lazy generation). Your answer can trigger the agent to insert a remedial node before continuing, or skip the next one if you clearly already know it — the graph reshapes live as this happens.
6. **Review the graph** — unlocked concepts form a node-link graph; each node links back to the session where you learned it. You can rename or delete nodes yourself; edits are recorded in an audit log that feeds back into future graph updates.

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
# fill in .env.local with your Firebase web config and GCP project id
gcloud auth application-default login   # local Vertex AI + Firestore admin credentials
```

### Run locally

```bash
npm run dev
```

Open http://localhost:3000.

### Deploy to Cloud Run

```bash
gcloud run deploy meno \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars GCP_PROJECT_ID=<your-project-id>,GCP_LOCATION=us-central1
```

The Cloud Run service's attached service account needs the `roles/aiplatform.user` and `roles/datastore.user` IAM roles.

## Status

Early build — in progress. Current scope is a single learning session per demo user (no auth), text-only topic input (file upload planned), and a bounded adaptive path (insert-remedial / skip-next). Cross-session graph merging, richer graph editing (merge nodes, manual edges), and a dedicated LLM-analysis layer over the edit audit log are explicit future work.
