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
The single, durable, long-lived collection of Concepts owned by one user — the record of what the user knows, and equally what the agent knows about the user. One Graph per user; many Sessions contribute Concepts to it over time, and later Sessions' investigations consult it (see Attach).

**Session**:
One run of learning a Topic, from entering it through completing (or abandoning) its Path. Sessions behave like conversations: many may be in progress at once, and any of them can be reopened and resumed where it left off. A completed Session stays readable — its Recap, tally, and Lessons in Path order. Each Concept records which Session originated it.

**Path**:
A Session's ordering of the Concepts it still has to teach — a linearization of their `requires` structure, containing only Concepts not yet Unlocked. Path membership, order, and Locked/Active state are facts of the Session, not the Concept: the same un-Unlocked Concept may sit on several Sessions' Paths, and when one Session Unlocks it, it leaves the others' Paths as already known. Nothing of a Path outlives its Session beyond the Concepts sitting in the Graph.

**Attach**:
During investigation, matching a found concept to an existing Concept in the user's Graph instead of creating a duplicate. An attached Concept that is already Unlocked goes straight to "already yours" — excluded from the diagnostic, never on the Path.
_Avoid_: dedup, merge.

**Check**:
A question and its graded answer. One mechanism, used in two phases: `diagnostic` (before a Path exists, assessing prerequisite/Topic understanding) and `mastery` (per-Concept, gates it to Unlocked). A Concept has exactly one mastery question, written alongside its exposition and never rewritten — it asks what was taught, not what the user happened to ask about, so conversation cannot reshape the bar. "Test me" — the user asking for the mastery Check whenever they feel ready, including immediately if the Concept looks too easy — is the only route to Unlocked; there is no self-declared skip. Attempts are uncapped and re-ask the same question; a pass is final and offers the move to the next Concept without making it (see Moving on).
_Avoid_: quiz, diagnostic question — both are Checks, not separate types.

**Moving on**:
Leaving the Active Concept for the next one on the Path — the user's act, not the agent's. Offered only once the mastery Check is passed, and from then on always offered: the user stays as long as they want, asking whatever they still want to ask, and the Unlock happens on the way out. Grading a Check therefore ends in feedback and nothing else; a pass that is generous about a partial answer is fine, because the feedback fills the gap and the user is still standing on the Concept when they read it.
_Avoid_: advance (that is the request's name, not the user's action), continue.

**Concept status** (Locked / Active / Unlocked):
Unlocked is a fact of the Graph — durable, meaning learned. Locked and Active are facts of one Session's Path: Locked = not yet reached in that Session; Active = open for teaching and free-form conversation there, with exactly one Active Concept per Session. A Concept can be Locked in one Session and Active in another — but once Unlocked, it is Unlocked everywhere.

**Lesson**:
The record of everything that happens while one Concept is Active: its teaching exposition, any free-form Q&A, and every mastery Check attempt. What a Concept links back to when the user wants to review how they learned it.

**Skipped**:
A flag on a Concept, set when it reached Unlocked because the agent judged the user already knew it — from the diagnostic, or via a skip Adjustment — rather than because the user passed its own mastery Check.

**Origin** (planned / remedial):
Whether a Concept was part of the upfront Path preview (planned) or inserted mid-Session by the agent (remedial).

**Requires**:
The prerequisite relationship between Concepts, pointing from a Concept to the Concepts it requires (e.g. Attention requires Softmax). Produced by investigating the Topic (a small DAG), then linearized into the Path. Deleting a Concept removes it from any dependents' `requires` — no cascade, no block.

**Edit**:
A recorded, user-made change to a Concept in their Graph (rename or delete). Deleting prunes the Concept from every Session's Path — but a Concept currently Active in any in-progress Session cannot be deleted. During a Lesson the Session view offers no direct Concept editing; the user's levers there are Test me and Break it down, both offered until the Concept's mastery Check is passed and neither after it. Stored append-only and surfaced to the agent as context for future Graph updates.
_Avoid_: audit log entry, revision.

**Adjustment**:
A bounded change the agent makes to a Session's Path: inserting a remedial Concept, or marking the next Concept Unlocked via skip. Triggered by grading a mastery Check, or explicitly by the user via Break it down. Deliberately not a full replan of the remaining Path. The skip rides only a passing answer — the Path is a prerequisite claim, so knowing the next Concept while failing this one says the Path is wrong, not that the learner may move past it; inserting a remedial rides either verdict.
_Avoid_: replan (implies unbounded regeneration, which this isn't).

**Break it down**:
The user's signal, during a Lesson, that the Active Concept is too hard. Always answered with an insert-remedial Adjustment — the Concept itself is never restructured, because too hard means a prerequisite is missing: every Concept should sit on the leaf of the user's current knowledge. (The too-easy counterpart is simply Test me.)

**Session phase** (Investigating / Diagnosing / Previewing / Learning / Complete):
Investigating: researching the Topic. Diagnosing: running diagnostic Checks. Previewing: skeleton Path shown to the user. Learning: stepping through Concepts. Complete: Path finished, closed by a Recap. During Learning, exactly one Concept is Active at any time — that Concept is the Session's current position. Any Session can be reopened at any time and resumes in the same phase, at the same position.

**Recap**:
The agent's closing summary when a Session completes: congratulates the user and recounts what was unlocked, including any remedial detours or skips along the way.
