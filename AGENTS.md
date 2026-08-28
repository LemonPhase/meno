# Working on Meno

Ship small, correct changes quickly. Prefer the simplest design that is
actually right over a general one that might be — this codebase is young and
changing your mind later is cheap, so bias toward landing something clear now
rather than something clever eventually.

- **Read `CONTEXT.md` first.** It is the domain glossary and the source of
  truth for vocabulary; use its words in code and in what you write. The
  decisions in `docs/adr/` were expensive to reach — follow them, and don't
  re-litigate a settled one without saying why.

- **Write code that reads like the file it lives in.** Comment density,
  naming and idiom here are deliberate. Comments explain *why*, especially
  where the obvious approach is wrong; they don't narrate *what*.

- **Test where correctness is load-bearing, not everywhere.** Worth a test:
  pure logic with sharp edges, anything touching stored state, and any bug
  that would corrupt data silently rather than loudly. Not worth one: layout,
  copy, and one-line wiring — look at those in a browser instead. A test that
  only restates the implementation costs more than it protects. When a bug is
  found, the regression test for it is always worth writing.

- **Verify before you claim.** `npm run lint`, `npx tsc --noEmit` and
  `npm test` are all fast. For anything visual, actually look at it. Report
  what you observed, not what should have happened.

- **Seed, don't generate.** `npm run seed` fills the emulator with a Graph
  covering every UI state, so interface work costs no model calls. Reach for
  the real model when you are testing the agent's *behaviour* — prompts and
  their output — which the scripted fake cannot tell you anything about.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
