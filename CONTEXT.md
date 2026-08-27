# Meno

Meno investigates a Topic, diagnoses what the user already knows, and walks them through it one atomic Concept at a time — building a personal knowledge Graph as they go.

## Language

**Topic**:
The raw, unstructured input a user provides to start a Session — a concept name, a topic, or pasted text such as an abstract. Investigating a Topic produces Concepts; a Topic is never itself a Concept.
_Avoid_: content, query, prompt.

**Concept**:
A structured, atomic idea extracted by investigating a Topic. Has a label, a summary, and a status. The canonical domain entity — used in code, the Edit log, and everywhere else in this glossary.
_Avoid_: content.

**Node**:
UI-layer word only, for a Concept's rendered position on the graph canvas. Never used as a domain/backend term — say Concept there.

**Graph**:
The single, durable, long-lived collection of Concepts owned by one user. One Graph per user; many Sessions contribute Concepts to it over time.

**Session**:
One run of the app, from entering a Topic through completing (or abandoning) its Path. Contributes Concepts to the user's Graph; each Concept records which Session originated it.

**Path**:
Not a persisted entity — the ordering of a Session's Concepts (each Concept carries its order within the Session). A linearization of the Concepts' `requires` structure, containing only Concepts still to learn — Concepts the diagnostic showed the user already knows go straight into the Graph as Unlocked, never onto the Path. Has no meaning independent of its Concepts, and nothing remains of it once the Session ends beyond those Concepts sitting in the Graph.

**Check**:
A question and its graded answer. One mechanism, used in two phases: `diagnostic` (before a Path exists, assessing prerequisite/Topic understanding) and `mastery` (per-Concept, gates it from Active to Unlocked).
_Avoid_: quiz, diagnostic question — both are Checks, not separate types.

**Concept status** (Locked / Active / Unlocked):
Locked: not yet reached. Active: open for teaching and free-form conversation; the user requests a mastery Check whenever they feel ready, and may attempt it any number of times. Unlocked: a mastery Check has been passed — i.e., learned. A Skipped Concept is also Unlocked (see Skipped).

**Lesson**:
The record of everything that happens while one Concept is Active: its teaching exposition, any free-form Q&A, and every mastery Check attempt. What a Concept links back to when the user wants to review how they learned it.

**Skipped**:
A flag on a Concept, set when it reached Unlocked because the agent judged the user already knew it — from the diagnostic, or via a skip Adjustment — rather than because the user passed its own mastery Check.

**Origin** (planned / remedial):
Whether a Concept was part of the upfront Path preview (planned) or inserted mid-Session by the agent (remedial).

**Requires**:
The prerequisite relationship between Concepts, pointing from a Concept to the Concepts it requires (e.g. Attention requires Softmax). Produced by investigating the Topic (a small DAG), then linearized into the Path. Deleting a Concept removes it from any dependents' `requires` — no cascade, no block.

**Edit**:
A recorded, user-made change to a Concept in their Graph (rename or delete), allowed on a Concept of any status — deleting a Locked Concept prunes it from the Path. Stored append-only and surfaced to the agent as context for future Graph updates.
_Avoid_: audit log entry, revision.

**Adjustment**:
A bounded change the agent makes to a Session's Path after a mastery Check: inserting a remedial Concept, or marking the next Concept Unlocked via skip. Deliberately not a full replan of the remaining Path.
_Avoid_: replan (implies unbounded regeneration, which this isn't).

**Session phase** (Investigating / Diagnosing / Previewing / Learning / Complete):
Investigating: researching the Topic. Diagnosing: running diagnostic Checks. Previewing: skeleton Path shown to the user. Learning: stepping through Concepts. Complete: Path finished, closed by a Recap. During Learning, exactly one Concept is Active at any time — that Concept is the Session's current position. A Session survives interruption: reloading the app resumes it in the same phase, at the same position.

**Recap**:
The agent's closing summary when a Session completes: congratulates the user and recounts what was unlocked, including any remedial detours or skips along the way.
