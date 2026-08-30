"use client";

// A ```viz fence is the tutor drawing: a small HTML figure from the kit
// (see the .viz styles in globals.css) plus inline SVG for geometry no
// flow can express. The fence body is raw markup from the model, and it
// is stored and re-rendered on every reopen — so nothing reaches React
// until this allowlist has walked it. The class vocabulary doubles as
// the sanitizer allowlist: a token not in it is dropped, not rendered.
// Elements become React nodes; nothing is handed to the DOM as markup.

import { createElement, Fragment, type ReactNode } from "react";

/** HTML the kit understands — structure only, the stylesheet owns look. */
const HTML_TAGS = new Set([
  "figure", "figcaption", "p", "ol", "ul", "li",
  "span", "em", "strong", "b", "i", "br", "h4",
]);

/** SVG for geometry: shapes, text, and arrowhead markers. Everything
    else — foreignObject, script, use, image, style — dies with its
    subtree, so a smuggled element has nothing to smuggle into. */
const SVG_TAGS = new Set([
  "svg", "g", "defs", "marker",
  "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan",
]);

const SVG_ATTRS = new Set([
  "viewbox", "preserveaspectratio",
  "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry",
  "width", "height", "d", "points", "transform",
  "opacity", "fill-opacity", "stroke-opacity",
  "refx", "refy", "markerwidth", "markerheight", "orient",
  "marker-start", "marker-mid", "marker-end",
  "text-anchor", "dominant-baseline",
  "font-size", "font-style", "font-weight",
  "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray",
  "data-ink", "data-fill",
]);

// SVG attributes are case-sensitive in the DOM, and the model writes
// (and the HTML parser lowercases) `viewBox`-style names. React passes
// props through verbatim, so these must be re-camelCased by hand.
const CAMEL: Record<string, string> = {
  viewbox: "viewBox",
  preserveaspectratio: "preserveAspectRatio",
  refx: "refX",
  refy: "refY",
  markerwidth: "markerWidth",
  markerheight: "markerHeight",
};

/** Inks are palette tokens, never raw colors: figures stay on the three
    inks (and their backgrounds) in both themes by construction. */
const INK_VALUE =
  /^(none|sheet|ink|ink2|ink3|rule|lapis|lapis-bg|laurel|laurel-bg|rubric|rubric-bg)$/;

/** Marker refs must be local — url(#id) — so nothing loads from afar. */
const MARKER_REF = /^url\(#[A-Za-z0-9_-]+\)$/;

/** Kit classes plus the sheet's small-caps apparatus (figures label
    themselves with it); anything else renders unstyled and off-voice. */
const CLASS_TOKEN = /^(viz(-[a-z0-9-]+)?|sc|sc-11)$/;

// A figure is a drawing, not a document: caps keep a runaway fence from
// growing unbounded in the stored Lesson.
const MAX_NODES = 400;
const MAX_DEPTH = 12;
const MAX_TEXT = 2000;

function cleanClass(raw: string): string | null {
  const kept = raw.split(/\s+/).filter((t) => CLASS_TOKEN.test(t));
  return kept.length ? kept.join(" ") : null;
}

function cleanInk(raw: string): string | null {
  const v = raw.trim().replace(/^--/, "");
  return INK_VALUE.test(v) ? v : null;
}

/**
 * Walk the parsed fence and rebuild it as React nodes, keeping only the
 * allowlisted. An unknown element loses its whole subtree — cheaper to
 * reason about than "keep children of dropped parents", and the kit
 * never nests unknown-inside-known legitimately.
 */
function build(
  node: Node,
  budget: { n: number },
  depth: number,
  keyPrefix: string,
): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? "").slice(0, MAX_TEXT);
    return text.length ? text : null;
  }
  if (node.nodeType !== Node.ELEMENT_NODE || depth <= 0) return null;
  if (budget.n-- <= 0) return null;

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  const props: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (name === "class") {
      const cls = cleanClass(attr.value);
      if (cls) props.className = cls;
    } else if (name === "data-ink" || name === "data-fill") {
      const ink = cleanInk(attr.value);
      if (ink) props[name] = ink;
    } else if (name === "marker-start" || name === "marker-mid" || name === "marker-end") {
      if (MARKER_REF.test(attr.value.trim())) props[name] = attr.value.trim();
    } else if (SVG_ATTRS.has(name) && el.namespaceURI?.includes("svg")) {
      props[CAMEL[name] ?? name] = attr.value.slice(0, 200);
    }
    // Anything else — style, href, every on* handler — is simply never
    // copied. The allowlist is the whole defence; there is no denylist
    // to fall behind.
  }

  const children: ReactNode[] = [];
  let k = 0;
  for (const child of Array.from(el.childNodes)) {
    const built = build(child, budget, depth - 1, `${keyPrefix}-${k}`);
    if (built !== null) children.push(
      <Fragment key={`${keyPrefix}-${k++}`}>{built}</Fragment>,
    );
  }

  if (HTML_TAGS.has(tag)) {
    return createElement(tag, props, children);
  }
  if (SVG_TAGS.has(tag)) {
    return createElement(tag, props, children);
  }
  return null;
}

/**
 * Render one ```viz fence body. Returns null when there is no DOM to
 * parse with (server prerender) or when nothing survives the walk —
 * a fence with no valid figure renders nothing rather than echoing
 * whatever was dropped. Every top-level node is a candidate: a junk
 * sibling must not take the figure down with it.
 */
export default function Viz({ code }: { code: string }) {
  if (typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(code, "text/html");
  const budget = { n: MAX_NODES };
  const kept: ReactNode[] = [];
  let k = 0;
  for (const child of Array.from(doc.body.childNodes)) {
    const built = build(child, budget, MAX_DEPTH, `v${k}`);
    if (built !== null) kept.push(<Fragment key={`v${k++}`}>{built}</Fragment>);
  }
  if (!kept.length) return null;
  return <div className="viz-mount">{kept}</div>;
}
