# Architecture

![Meno architecture](architecture.svg)

Meno is one Next.js application deployed as a single Cloud Run service. The
browser holds no domain logic; every transition is a server round-trip, so a
reload — or a different device — resumes exactly where the Session stood.

## Identity

Google sign-in runs in the browser only to obtain an ID token, traded once at
`POST /api/auth/session` for an httpOnly session cookie — chosen over a bearer
token because it rides on every fetch the app already makes, so no existing
call site had to change. **The uid is the graphId** ([ADR-0005](adr/0005-uid-is-the-graph-id.md)):
scoping is structural, so a request never reaches another reader's subtree
rather than reaching it and being filtered. Every `store.ts` function takes
`graphId` as a required argument, so a forgotten one is a compile error instead
of a silent read of someone else's Graph. `firestore.rules` denies everything —
only the Admin SDK, behind the route handlers, ever touches the data.

## Layers

**Server interface** (`src/app/api/**/route.ts`) — the whole surface the
browser can reach. Every one of them but `/api/auth/session`, which mints the
cookie in the first place, resolves the uid from that cookie before anything
else: a signed-out request is 401 and writes nothing. Beyond that,
each route is one move in the domain: start a Session,
answer the diagnostic, ask a question in a Lesson, request the mastery Check,
answer it, move on, break it down, edit the Graph. Routes validate and
delegate; they hold no teaching logic. The tests call these handlers directly,
the way the browser does, which is why they are black-box.

**Domain core** (`src/lib/progression.ts`, `checks.ts`, `store.ts`) — pure and
model-free: linearizing a `requires` DAG into a Path, deciding what the next
Concept is, and the two bounded Adjustments the agent is allowed to make
(insert a remedial Concept, or skip the next one). Keeping this out of the
prompts is what makes the behaviour testable without a model.

**Agent layer** (`src/ai/*.ts`) — Genkit flows over Gemini 3.7 Flash on Vertex
AI. Three files, matching the three things the agent does:

| Flow file | Flows | Notes |
|---|---|---|
| `investigate.ts` | `investigateTopic` | Two calls: Google Search–grounded research, then structured extraction into Concepts + `requires` edges. Grounding and JSON-schema output don't reliably combine on Gemini, so they are deliberately separate calls. Extraction also performs **Attach** — matching a found concept to one already in the learner's Graph instead of duplicating it. |
| `diagnose.ts` | `generateDiagnostic`, `gradeDiagnostic` | Probes what the learner already knows before any Path exists. Known Concepts go straight to Unlocked+Skipped. |
| `lesson.ts` | `teachConcept`, `lessonReply`, `generateMasteryCheck`, `gradeMasteryCheck`, `breakDownConcept`, `writeRecap` | The Learning loop. The Check is written against the exposition it tests and never sees the conversation that follows, so what the learner asked can't move the bar they're held to. |

Every extraction and grading call returns a Zod-typed schema, and the server
re-validates the model's output against the Graph — unknown `requires` keys,
duplicate keys, and `attachTo` ids the Graph doesn't hold are dropped before
anything is written. The model proposes; the domain core decides.

**Persistence** (`src/lib/store.ts`) — Firestore, one Graph per user:

```
graphs/{uid}/concepts/{id}      durable: label, summary, requires, unlocked, skipped
graphs/{uid}/sessions/{id}      topic, phase, activeConceptId, conceptIds, path[]
graphs/{uid}/lessons/{sessionId__conceptId}
graphs/{uid}/checks/{id}        diagnostic and mastery Checks, with verdicts
graphs/{uid}/edits/{id}         append-only: the learner's renames and deletes
```

The split is [ADR-0002](adr/0002-graph-outlives-session.md) and
[ADR-0004](adr/0004-session-local-path-state.md): the Graph owns what the user
knows, a Session owns where it is. A Concept is therefore shared safely across
concurrent Sessions — unlocking it in one removes it from the others' Paths
rather than teaching it twice.

Every state move is a single guarded transactional commit. Model calls all
land *before* the write, and the write is conditional on the state the caller
read; a duplicate press or a stale client is refused with a 409 rather than
half-applied. `tests/concurrency.test.ts` covers this.

## The model seam

`MENO_MODEL` selects the model for every flow (`src/ai/genkit.ts`).
Anything else is a Vertex AI model name; `scripted` swaps in a deterministic
fake with no Vertex plugin and no network. That one seam is what lets the
entire test suite run against the Firestore emulator with no GCP credentials,
and what lets `npm run seed` build a full Graph for interface work without
spending a model call. `MENO_AUTH=scripted` opens the matching seam for
identity, and is barred in production.

## Delivery

Push to `main` runs `.github/workflows/deploy.yml`: lint and the emulator test
suite, then — via Workload Identity Federation, with no stored keys — a Docker
build, a push to Artifact Registry tagged by commit SHA, a Cloud Run deploy as
the `meno-runtime` service account, and a smoke check against the deployed
URL. The runtime service account holds exactly two roles:
`roles/aiplatform.user` and `roles/datastore.user`.
