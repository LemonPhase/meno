# Adjustments are bounded to two actions, not full replanning

When a mastery Check is graded, the agent may adjust the Session's Path — but only via two named actions: `insert_remedial` (splice one remedial Concept in after the current one) or `skip_next` (mark the next Concept Unlocked). We deliberately rejected letting the model regenerate the remaining Path. Full replanning would demand an extra Gemini round-trip per answer, produce unbounded path mutations that are hard to render and debug, and destroy the upfront Path preview the user was promised. The Adjustment rides along as one structured field on the grading call we already make, so adaptivity costs no extra latency. If richer replanning is ever wanted, it should be added as a new, explicitly-invoked action — not by loosening this constraint silently.

## Addendum — "Break it down" (2026-08-28)

The learner can now ask for a remedial detour directly, rather than only
having one offered after a failed Check. This is the "new, explicitly-invoked
action" the last sentence above anticipates: it reuses `insert_remedial`
unchanged, and does not loosen the constraint. The Concept being learned is
never restructured — every Concept should sit on the leaf of the learner's
current knowledge, so "too hard" means a prerequisite is missing, not that
this Concept is wrong.

It does cost one extra model round-trip, but only when the learner asks for
it, so the no-extra-latency property of the graded path is preserved.

## Addendum — `skip_next` rides only a pass (2026-08-30)

`skip_next` used to fire on either verdict, on the reasoning that the verdict
judges *this* Concept while the Adjustment observes whatever else the answer
revealed. It now fires only when the answer passes.

The Path is a prerequisite claim: each Concept on it is a prerequisite of the
one after. So an answer that fails the Active Concept while appearing to
demonstrate the next one is not a licence to skip ahead — it is evidence the
Path was built wrong, or that the diagnostic was not thorough enough. The
right response to that is to teach this Concept properly, not to hand the
learner the next one on the strength of an answer that just failed.

`skip_next` is now what it should always have been: a safety net for genuine
familiarity, where the learner answers this Concept's Check completely *and*
demonstrates the next just as completely. `insert_remedial` is unchanged and
still rides either verdict — a failed answer revealing a specific gap is
exactly when a detour is right.

This also closes a real defect. Attempts on a Check are uncapped and re-ask
the same question, so a learner failing the same Concept three times could
draw three separate `skip_next` calls, each aimed at whatever was next by
then — unlocking three untaught Concepts, Graph-wide and durable, for a
learner who had demonstrated nothing.

## Addendum — the remedial goes in front, and is taught first (2026-08-31)

`insert_remedial` used to splice the remedial Concept in *after* the Active
one, and leave it there to be reached in turn. Both halves of that were
wrong, and this supersedes the wording at the top of this record ("splice one
remedial Concept in after the current one").

A remedial exists because a prerequisite is missing. A prerequisite taught
after the thing it holds up is not a prerequisite — it is a footnote the
learner reads once they no longer need it. Worse, reaching it meant passing
the Concept it was inserted to unblock: the learner had to get through the
thing they were stuck on before being taught what they were stuck on. So the
remedial now takes the seat in front of the Concept it unblocks, and that
Concept gains a `requires` edge on it — the Path and the graph both say what
rests on what.

Being in front is not enough on its own, so a remedial asked for with "Break
it down" is also *taken* at once. The Concept the learner is pulled off is
interrupted rather than left — it is not Unlocked, it keeps its Lesson and
its unanswered Check, and it is the next thing on the Path when the detour is
passed. Returning to it generates nothing: a Concept is taught once, and its
one mastery question is the one it was written with.

**Grading suggests a detour; it never takes one.** A failing answer changes
the Path in no way at all. Where the gap it reveals is a missing prerequisite
rather than a slip, the feedback names that and points at "Break it down" —
the control already under the composer — and stops there. Taking it is the
learner's press.

That is a deliberate narrowing of this record's original "insert_remedial
rides either verdict", and of the 2026-08-28 addendum above. Leaving a
Concept is the learner's act everywhere else in Meno (CONTEXT.md, Moving
on), and a detour was the one place the agent could quietly take it from
them: it would swap the page out from under an answer they had just pressed,
on the strength of its own reading of one wrong answer, and their feedback
with it. A wrong answer is also thin evidence — attempts are uncapped and
re-ask the same question, so a learner having a hard time could be walked
steadily further under the Concept they came for, one bounded step at a time,
which is the unbounded replanning this record exists to prevent. The learner
pressing the lever is neither of those things, so that press stays unbounded.

A remedial on a *passing* answer still rides the grade, and sits behind the
Concept it came out of: nothing is being unblocked there, the learner stays
where a pass always leaves them, and the remedial is simply what comes next
when they choose to move on.

This costs two more model calls on a "Break it down" that takes a detour
(the remedial's exposition and its Check) — the same two any Concept costs
when it is reached, moved to the moment the learner is stuck instead of
later.

Three things follow, and are part of this decision rather than incidental
to it:

**`skip_next` can never take the interrupted Concept.** Mid-detour, the next
Concept on the Path is the one the learner was pulled off — the one thing
there they have demonstrably *not* got, often with a failed attempt on its
own page. Skipping it would Unlock it Graph-wide and for good on the
strength of an answer about something else, which is the defect the
2026-08-30 addendum above was written to close, arriving through a door that
addendum could not have anticipated. A Concept this Session has already
taught is never a skip target, and is not offered to the grader as what
comes next.

**Being interrupted is a state the rest of the app has to know about.** A
Concept can now be Locked and still hold a Lesson, which had never been
possible: it is not deletable (the guard used to ask only whether a Concept
was Active), it is not a skip target, and the rail says the learner is
coming back to it rather than leaving it looking unreached.
