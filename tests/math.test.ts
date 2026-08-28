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

  it("does not rewrite $$ inside an indented code block", () => {
    const src = ["Code:", "", "    $$x = 1$$"].join("\n");
    expect(normalizeDisplayMath(src)).toBe(src);
  });

  // The rewrite's own failure mode: a dangling `$$` opens a block that
  // never closes, and the parse error swallows the rest of the message.
  // Every shape below must come back byte-identical.
  describe("leaves $$ inside prose alone", () => {
    const untouched = [
      "The famous result is $$E = mc^2$$",
      "The famous result is $$E = mc^2$$, and here is why.",
      "$$E = mc^2$$ is famous.",
      "## The identity $$e^{i\\pi} = -1$$",
      "- $$\\begin{aligned} x &= 1 \\end{aligned}$$",
      "> $$\\begin{aligned} x &= 1 \\end{aligned}$$",
    ];
    for (const src of untouched) {
      it(src.slice(0, 44), () => expect(normalizeDisplayMath(src)).toBe(src));
    }
  });

  it("does not let a prose $$ leak into the lines after it", () => {
    const src = [
      "$$E = mc^2$$ is famous.",
      "",
      "And this paragraph must survive.",
      "",
      "So must this one.",
    ].join("\n");
    expect(normalizeDisplayMath(src)).toBe(src);
  });

  it("still splits a glued fence when prose follows the block", () => {
    const src = [
      "Here it is:",
      "$$\\begin{aligned}",
      "x &= 1",
      "\\end{aligned}$$",
      "",
      "And prose after.",
    ].join("\n");
    expect(normalizeDisplayMath(src)).toBe(
      [
        "Here it is:",
        "$$",
        "\\begin{aligned}",
        "x &= 1",
        "\\end{aligned}",
        "$$",
        "",
        "And prose after.",
      ].join("\n"),
    );
  });
});
