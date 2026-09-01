# Research — model-drawn visualisations in the Lesson

*2026-08-30. Question: should the tutor be able to draw — not just typeset —
when explaining a Concept, and if so with what?*

## The existing pipeline (what any option must fit)

- Model output is **Markdown + KaTeX strings**, rendered client-side by
  `react-markdown` with `remark-gfm`, `remark-math`, `rehype-katex`
  (`src/components/session/Markdown.tsx`). Server flows return `{ text }`
  payloads stored as `LessonMessage.text` in the Lesson.
- **Streaming is Firestore-based, not token streaming**: `teachConcept` and
  `lessonReply` are one-shot `ai.generate` calls; the client polls/snapshots
  and the Markdown component reveals word-by-word with the `.w` spans. So
  any visualisation arrives **whole** — no incremental diagram redraw, no
  need for a library that handles streaming.
- **Security**: all model text is stored and re-rendered on every reopen.
  Anything rendered raw (`dangerouslySetInnerHTML`) is a stored-XSS hole,
  since the model can be steered by pasted Topic input. Nothing today is
  raw; keep it that way.
- **Design language**: strict three-ink marginalia (lapis / rubric / laurel
  on paper), fonts `Newsreader` (serif) + `IBM Plex Sans` (--font-plex),
  everything rides on CSS custom properties with light/dark themes. Hairline
  rules, `--sheet` panels, uppercase sans labels (`.sc`).

## The question behind the question

The existing pipeline already gives visuals for **quantitative** content:
KaTeX display math covers formalism beautifully. What it cannot do is
**structural** or **process** visuals — a pipeline, a feedback loop, a tree,
a timeline, "how A depends on B". That's the actual gap.

There are two fundamentally different strategies:

1. **Structured diagram-as-code** — the model emits a text DSL
   (Mermaid, GraphViz…), the frontend renders it deterministically.
2. **Free-form SVG/HTML** — the model emits markup directly, the frontend
   renders it (sandboxed or sanitized).

## Option A — Mermaid (diagram-as-code)

The industry-standard DSL for flowcharts, sequence diagrams, state
machines, ER diagrams, timelines, mindmaps, pie charts, gantt, git graphs.
`npm: mermaid`, v11.17.2 (2026-08-25, actively maintained).

- **Pros**: model-friendly (tons of training data), deterministic layout
  (dagre layout engine), incremental builds, broad diagram taxonomy, big
  ecosystem (many editor integrations, `mermaid.ink` for static export).
- **Cons**:
  - **84 MB unpacked** (~2.8 MB minified+gzip ≈ 1.4 MB brotli, plus
    async-chunked imports). Heavyweight for a lesson surface.
  - **Layout is a black box** — good when it works, unusable when it
    doesn't (no manual nudge).
  - **Theming is CSS-in-JS and awkward**: Mermaid's own theme engine
    (base + themeVariables) fights the three-ink system. Getting the
    "marginalia" look means overriding Mermaid's `themeVariables` AND
    shipping CSS overrides for node labels; expect drift from the sheet's
    Newsreader/plex voice, especially in dark mode.
  - Renders into its own `<svg>`; hard to integrate with the word-by-word
    reveal.

## Option B — free-form SVG from the model

The model writes SVG markup directly; the frontend renders it.

- **Pros**: stylistically perfect — every attribute is under the model's
  control, so it can literally write `stroke="var(--lapis)"` and set
  `font-family: var(--font-serif)`; the figure lives in the marginalia's
  own ink. Zero new dependencies. Maximally flexible (arrows, custom
  layouts, bespoke geometry that no diagram DSL can express).
- **Cons**:
  - **Layout is hand-computed by the model** — coordinates, text widths
    (no text measurement in the model), overlapping labels are the classic
    failure. Quality varies wildly between model calls; the same prompt
    can produce a beautiful figure or a broken one.
  - **Security: raw SVG is an XSS vector** (e.g. `<foreignObject>`,
    `<script>`, `onload` attrs, `<use href>`). Rendering model SVG raw is
    only safe with **sanitization** (DOMPurify or equivalent). Not
    optional.
  - Difficult to iterate: model can't see its own output, so a broken
    figure stays broken.

## Option C — restricted HTML/CSS blocks

A fenced code block ```html (or ```viz) in the model's markdown, rendered
in a fixed, design-language-aware container (flex/grid, ink colors, .sc
labels), with a small component vocabulary (`.viz-step`, `.viz-arrow`,
`.viz-branch`...).

- **Pros**:
  - **Stylistically native** — the model writes semantic classes, the
    stylesheet owns the look. Three inks, hairlines, .sc labels come free
    and stay consistent across every figure, every theme.
  - **Layout is delegated to CSS**, not computed by the model — the
    single biggest quality lever versus raw SVG. Flexbox/grid handle
    centering, spacing, wrapping; text is real text (selectable, flowed).
  - **Security surface is tiny and auditable** — the component vocabulary
    is the sanitizer's allowlist. No `dangerouslySetInnerHTML` anywhere.
  - **Model-friendly**: HTML/CSS is the highest-data format in any
    training corpus.
  - Renders as a normal block in the react-markdown flow (a custom code
    component), so the word-by-word reveal, theming, and export all work
    unchanged.
- **Cons**:
  - Less expressive for **geometry-heavy** visuals (precise arrows,
    curved connectors, coordinates). Best for **flow** (steps, branches,
    loops, trees, comparisons) — which is exactly the lesson-shaped
    majority.
  - New mini-DSL to maintain (but it's CSS classes, not JS logic).

## Comparison

| | Mermaid | raw SVG | HTML component kit |
|---|---|---|---| ponytail
| deps | 84MB, ~2MB gzip | 0 | 0 |
| layout | automatic (black box) | hand-computed | CSS |
| style match | fight the theme engine | perfect, if model nails it | native by construction |
| XSS risk | low (sanitizer inside) | high, needs DOMPurify | none (no raw HTML) |
| model reliability | high (DSL is common) | low (coords, overlap) | high (HTML is common) |
| expressiveness | diagram taxonomy | unlimited | flow/comparison/branch |

## Recommendation

**Option C** — a small HTML/CSS component kit, rendered from a fenced
```viz block by a custom component in Markdown.tsx, with **Option B (raw
SVG inside that block) as a deliberate escape hatch** for the rare
visualisation that flow-shaped components can't express (geometry, real
curves, bespoke diagrams). Both are zero-dependency, and both live inside
the design language by construction rather than by fighting a theming
engine.

- The kit is the 90% path (flows, branches, loops, comparisons, timelines).
- SVG-in-viz is the 10% escape hatch, sanitized and constrained
  (viewBox-scoped, no foreignObject, no scripts, three-ink palette only).
- **Mermaid is explicitly rejected**: 84MB and a foreign theming engine
  are too high a price for diagram taxonomy the tutor rarely needs; if a
  Concept genuinely needs a sequence diagram, the model can draw it in
  SVG within the escape hatch.

## Precedent

- **Every major chat surface (Claude, ChatGPT, Gemini) renders AI
  "artifacts"/canvas as sandboxed HTML/SVG, not Mermaid** — free-form
  markup inside a sandbox is the mainstream answer to "let the model
  draw". Mermaid appears as one *optional* diagram format among several.
- **Mermaid is the standard when diagrams-as-code must round-trip through
  editors** (GitHub, Notion, Obsidian) — not the case here; Meno's
  visualisations are generated-and-displayed, never hand-edited.
- This is also how the repo already handles model markup: the model writes
  Markdown+TeX, the renderer constrains and styles it. A viz block is the
  same move, one level up.
