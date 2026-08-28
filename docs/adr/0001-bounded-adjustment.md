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
