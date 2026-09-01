// The ```viz fence is raw model markup that the frontend renders as
// DOM. Its security contract lives in Viz.tsx (allowlist sanitizer +
// ink tokens) and lesson.ts (the prompt contract); this file pins the
// pieces that must not silently drift: only the viz fence routes to
// the renderer, the sanitizer's ink tokens reject hostile values, and
// the model is taught only the kit vocabulary the stylesheet implements.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const lessonSrc = readFileSync("src/ai/lesson.ts", "utf8");
const markdownSrc = readFileSync("src/components/session/Markdown.tsx", "utf8");
const vizSrc = readFileSync("src/components/session/Viz.tsx", "utf8");
const css = readFileSync("src/app/globals.css", "utf8");

describe("viz rendering path", () => {
  it("routes only the viz fence to the sanitizer/renderer", () => {
    expect(markdownSrc).toContain('className === "language-viz"');
    // The fence body is never trusted as raw markup anywhere — no raw
    // rendering was introduced to make figures work.
    for (const src of [markdownSrc, vizSrc]) {
      expect(src).not.toMatch(/dangerouslySetInnerHTML/);
      expect(src).not.toMatch(/innerHTML/);
    }
  });

  it("does not attach the animated word-reveal to figures", () => {
    // Viz mounts from baseComponents only; animatedComponents never
    // learns about it, so a figure never replays a word reveal.
    const animated = markdownSrc.slice(markdownSrc.indexOf("animatedComponents"));
    expect(animated).not.toContain("Viz");
  });
});

describe("viz sanitizer", () => {
  // The regex as written in Viz.tsx, evaluated — the test reads the
  // source so the contract tested is the contract shipped.
  const inkPattern = /const INK_VALUE\s*=\s*\/\^(.+?)\$\//;
  const m = inkPattern.exec(vizSrc);
  it("pins ink values to palette tokens", () => {
    expect(m).not.toBeNull();
  });
  if (!m) return;

  const INK_VALUE = new RegExp(`^(${m[1]})$`);

  it.each([
    "lapis", "laurel", "rubric", "ink", "ink2", "ink3", "rule", "sheet",
    "lapis-bg", "laurel-bg", "rubric-bg", "none",
  ])("accepts the ink token %s", (token) => {
    expect(INK_VALUE.test(token)).toBe(true);
  });

  it.each([
    "#39568f", // raw hex
    "rgb(57, 86, 143)",
    "url(http://evil.example/x.svg)",
    "url(#ok)","#fff",
    "expression(alert(1))",
    "lapis; color: red",
    "var(--lapis)",
    "calc(1px + 2px)",
  ])("rejects the hostile value %s", (value) => {
    expect(INK_VALUE.test(value)).toBe(false);
  });
});

describe("viz prompt contract", () => {
  const voice = lessonSrc.slice(
    lessonSrc.indexOf("const VOICE"),
    lessonSrc.indexOf("export const teachConcept"),
  );

  it("is taught in VOICE next to the KaTeX rules", () => {
    const flat = voice.replace(/\\`/g, "`").replace(/\s+/g, " ");
    expect(flat).toContain("```viz");
    expect(flat).toContain("never a raw color");
    expect(flat).toMatch(/not as \$\.\.\.\$/i);
  });

  it("teaches only classes the stylesheet implements", () => {
    const taught = [...new Set([...voice.matchAll(/viz-[a-z0-9-]+/g)].map((m) => m[0]))];
    expect(taught.length).toBeGreaterThan(0);
    for (const cls of taught) {
      expect(css).toContain(`.${cls}`);
    }
  });

  it("the kit vocabulary exists in the stylesheet", () => {
    for (const cls of ["viz-flow", "viz-axis", "viz-branch", "viz-step", "viz-tag", "viz-now", "viz-done", "viz-mount"]) {
      expect(css).toContain(`.${cls}`);
    }
    // The SVG escape hatch rides the same token palette.
    expect(css).toContain("data-ink");
    expect(css).toContain("data-fill");
  });
});
