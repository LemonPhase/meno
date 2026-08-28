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
 * parse error eats the rest of the message. Give every `$$` its own line.
 * Only leading and trailing `$$` move, so prose is never re-flowed, and
 * indentation is kept so a formula inside a list stays inside it.
 */
export function normalizeDisplayMath(src: string): string {
  const out: string[] = [];
  let fence: string | null = null;

  for (const line of src.split("\n")) {
    const trimmed = line.trim();
    const opener = /^(`{3,}|~{3,})/.exec(trimmed);
    if (opener) {
      if (fence === null) fence = opener[1][0];
      else if (trimmed.startsWith(fence)) fence = null;
      out.push(line);
      continue;
    }
    if (fence !== null || !trimmed.includes("$$")) {
      out.push(line);
      continue;
    }

    const indent = line.slice(0, line.length - line.trimStart().length);
    let rest = trimmed;
    const tail: string[] = [];
    while (rest.startsWith("$$") && rest !== "$$") {
      out.push(`${indent}$$`);
      rest = rest.slice(2).trim();
    }
    while (rest.endsWith("$$") && rest !== "$$") {
      tail.unshift(`${indent}$$`);
      rest = rest.slice(0, -2).trim();
    }
    if (rest) out.push(indent + rest);
    out.push(...tail);
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
