"use client";

// The model writes markdown and TeX; this renders it in the sheet's own
// voice. Newly-arrived text still reveals word by word: rather than
// splitting a raw string, the block components wrap each text node's
// words, so the reveal survives bold, links, lists and tables intact.

import "katex/dist/katex.min.css";

import {
  cloneElement,
  Fragment,
  isValidElement,
  memo,
  useMemo,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

const STEP_MS = 15;
const MAX_DELAY_MS = 850;

/** A formula costs a few words of stagger, so prose after it lags a beat. */
const MATH_STEPS = 3;

const remarkPlugins: Options["remarkPlugins"] = [remarkGfm, remarkMath];
// Bad TeX from the model is set in rubric red rather than thrown: a
// malformed formula must never take the whole lesson down with it.
const rehypePlugins: Options["rehypePlugins"] = [
  [rehypeKatex, { throwOnError: false, errorColor: "var(--rubric-ink)" }],
];

/**
 * remark-math reads anything after an opening `$$` as a fence info string,
 * exactly as a code fence does, and drops it — so a model writing
 * `$$\begin{aligned}` loses the `\begin`, never closes the block, and the
 * parse error eats the rest of the message. Give the fences of a display
 * block their own lines, keeping indentation so a formula inside a list
 * stays inside it.
 *
 * The rewrite is deliberately narrow. `$$` is only a fence when a block is
 * being opened or closed, so the state of that block is tracked: a leading
 * `$$` splits only outside one, a trailing `$$` only inside one. Without
 * that, `The result is $$E = mc^2$$` — inline maths mid-sentence, and one
 * of the commonest things a model writes — would gain a dangling `$$` and
 * open an unterminated block that swallows the rest of the message, which
 * is the very failure this exists to prevent.
 */
export function normalizeDisplayMath(src: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  let inMath = false;

  for (const line of src.split("\n")) {
    const trimmed = line.trim();

    const opener = /^(`{3,}|~{3,})/.exec(trimmed);
    if (opener && !inMath) {
      if (fence === null) fence = opener[1][0];
      else if (trimmed.startsWith(fence)) fence = null;
      out.push(line);
      continue;
    }
    // An indented code block is content too, and no fence marks it.
    if (fence !== null || (!inMath && /^(?: {4}|\t)/.test(line))) {
      out.push(line);
      continue;
    }
    if (!trimmed.includes("$$")) {
      out.push(line);
      continue;
    }

    const indent = line.slice(0, line.length - line.trimStart().length);
    const opens = trimmed.startsWith("$$");
    const closes = trimmed.endsWith("$$");
    const bare = trimmed === "$$";

    if (bare) {
      out.push(line);
      inMath = !inMath;
    } else if (inMath) {
      // Looking for the closing fence; anything else is formula content.
      if (closes) {
        out.push(indent + trimmed.slice(0, -2).trim());
        out.push(`${indent}$$`);
        inMath = false;
      } else {
        out.push(line);
      }
    } else if (opens && closes) {
      // A whole-line display formula: `$$ … $$` split onto three lines.
      out.push(`${indent}$$`);
      out.push(indent + trimmed.slice(2, -2).trim());
      out.push(`${indent}$$`);
    } else if (opens && !trimmed.slice(2).includes("$$")) {
      // An opening fence the model glued to the start of its formula. A
      // second `$$` later on the line would mean the first one is closed
      // inline instead, and nothing here is a fence.
      out.push(`${indent}$$`);
      out.push(indent + trimmed.slice(2).trim());
      inMath = true;
    } else {
      // `$$` somewhere inside prose. Ambiguous, and not ours to resolve —
      // rewriting it is what breaks the sentence, so leave it exactly as
      // written and let remark-math read it.
      out.push(line);
    }
  }
  return out.join("\n");
}

type Counter = { i: number };

/**
 * KaTeX emits a precisely structured tree of inline-blocks plus a MathML
 * annotation. Splitting its text nodes would shred the layout and print
 * the source twice, so a formula is one token, not many.
 */
function isMath(node: React.ReactElement<{ className?: string }>): boolean {
  const { className } = node.props;
  return typeof className === "string" && /\b(katex|math)\b/.test(className);
}

function wrapWords(node: ReactNode, ctr: Counter): ReactNode {
  if (typeof node === "string") {
    // Keep whitespace as its own token so spacing is unchanged.
    return node.split(/(\s+)/).map((token, k) =>
      token === "" || /^\s+$/.test(token) ? (
        token
      ) : (
        <span
          key={k}
          className="w"
          style={{
            animationDelay: `${Math.min(ctr.i++ * STEP_MS, MAX_DELAY_MS)}ms`,
          }}
        >
          {token}
        </span>
      ),
    );
  }
  if (Array.isArray(node)) {
    return node.map((child, k) => (
      <Fragment key={k}>{wrapWords(child, ctr)}</Fragment>
    ));
  }
  if (isValidElement<{ children?: ReactNode; className?: string }>(node)) {
    if (isMath(node)) {
      const delay = Math.min(ctr.i * STEP_MS, MAX_DELAY_MS);
      ctr.i += MATH_STEPS;
      return (
        <span className="w" style={{ animationDelay: `${delay}ms` }}>
          {node}
        </span>
      );
    }
    const { children } = node.props;
    if (children === undefined) return node;
    return cloneElement(node, undefined, wrapWords(children, ctr));
  }
  return node;
}

/** Block-level components that reveal their text as it arrives. */
function animatedComponents(ctr: Counter): Components {
  const wrap = (Tag: keyof React.JSX.IntrinsicElements) => {
    const Block = ({ children, ...props }: { children?: ReactNode }) => {
      const Element = Tag as React.ElementType;
      return <Element {...props}>{wrapWords(children, ctr)}</Element>;
    };
    Block.displayName = `MarkdownBlock(${Tag})`;
    return Block;
  };
  return {
    p: wrap("p"),
    li: wrap("li"),
    h1: wrap("h1"),
    h2: wrap("h2"),
    h3: wrap("h3"),
    h4: wrap("h4"),
    blockquote: wrap("blockquote"),
    td: wrap("td"),
    th: wrap("th"),
  };
}

function Markdown({
  text,
  animate = false,
  className = "",
}: {
  text: string;
  /** Reveal word by word (only for text arriving during this visit). */
  animate?: boolean;
  className?: string;
}) {
  // Stable across renders: a fresh components object would hand
  // react-markdown new component types, remounting every block and
  // replaying the reveal from the top.
  const components = useMemo(
    () => (animate ? animatedComponents({ i: 0 }) : undefined),
    [animate],
  );
  const source = useMemo(() => normalizeDisplayMath(text), [text]);
  return (
    <div className={`md${className ? ` ${className}` : ""}`}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

/** Rendering is pure in its props; a parent re-render must not replay it. */
export default memo(Markdown);
