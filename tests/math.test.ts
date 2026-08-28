import { describe, expect, it } from "vitest";
import { normalizeDisplayMath } from "@/components/session/Markdown";

// remark-math reads whatever follows an opening `$$` as a fence info
// string and discards it, exactly as a code fence does. A model that
// writes `$$\begin{aligned}` therefore loses the `\begin`, never closes
// the block, and the resulting parse error swallows the rest of the
// message — so every `$$` is put on a line of its own before parsing.

describe("normalizeDisplayMath", () => {
  it("splits a fence the model glued to its formula", () => {
    const src = ["$$\\begin{aligned}", "x &= 1", "\\end{aligned}$$"].join("\n");
    expect(normalizeDisplayMath(src)).toBe(
      ["$$", "\\begin{aligned}", "x &= 1", "\\end{aligned}", "$$"].join("\n"),
    );
  });

  it("splits a one-line displayed formula", () => {
    expect(normalizeDisplayMath("$$E = mc^2$$")).toBe("$$\nE = mc^2\n$$");
  });

  it("leaves a correctly written block alone", () => {
    const src = ["$$", "x = 1", "$$"].join("\n");
    expect(normalizeDisplayMath(src)).toBe(src);
  });

  it("leaves inline math and prose untouched", () => {
    const src = "The gradient $\\nabla f$ costs \\$5 and points uphill.";
    expect(normalizeDisplayMath(src)).toBe(src);
  });

  it("keeps a formula inside a list item indented", () => {
    const src = ["- Here it is:", "  $$x = 1$$"].join("\n");
    expect(normalizeDisplayMath(src)).toBe(
      ["- Here it is:", "  $$", "  x = 1", "  $$"].join("\n"),
    );
  });

  it("does not rewrite $$ inside a fenced code block", () => {
    const src = ["```", "$$not math$$", "```"].join("\n");
    expect(normalizeDisplayMath(src)).toBe(src);
  });
});
