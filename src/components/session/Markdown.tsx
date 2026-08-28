"use client";

// The model writes markdown; this renders it in the sheet's own voice.
// Newly-arrived text still reveals word by word: rather than splitting a
// raw string, the block components wrap each text node's words, so the
// reveal survives bold, links, lists and tables intact.

import {
  cloneElement,
  Fragment,
  isValidElement,
  memo,
  useMemo,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const STEP_MS = 15;
const MAX_DELAY_MS = 850;

type Counter = { i: number };

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
  if (isValidElement<{ children?: ReactNode }>(node)) {
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
  return (
    <div className={`md${className ? ` ${className}` : ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** Rendering is pure in its props; a parent re-render must not replay it. */
export default memo(Markdown);
