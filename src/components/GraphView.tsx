"use client";

// GraphView renders the Session's Concepts as a node-link graph (see
// CONTEXT.md: "Node" is the UI-layer word for a Concept's rendered position).
// Layout is a deterministic layered DAG: each Concept sits on a layer given by
// its `requires` depth, layers flow top-to-bottom, and `requires` edges are
// drawn as curves with arrowheads. Clicking a Concept that has a Lesson opens
// that Lesson for read-only review.

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Concept, Lesson, LessonMessage } from "@/lib/types";

const VIEW_WIDTH = 640;
const MARGIN_Y = 44;
const LAYER_GAP = 92;
const NODE_HEIGHT = 34;
const CHAR_WIDTH = 7.2;
const NODE_PAD_X = 14;
const MAX_LABEL_CHARS = 22;

type NodePlacement = {
  concept: Concept;
  x: number;
  y: number;
  width: number;
  label: string;
};

/**
 * Depth of each Concept in the `requires` DAG: 0 for Concepts with no
 * prerequisites in the set, otherwise 1 + the deepest prerequisite. Memoized
 * DFS with a visiting guard so a malformed cycle cannot hang the layout.
 */
function computeDepths(concepts: Concept[]): Map<string, number> {
  const byId = new Map(concepts.map((c) => [c.id, c]));
  const depths = new Map<string, number>();
  const visiting = new Set<string>();

  function depthOf(id: string): number {
    const known = depths.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let depth = 0;
    const concept = byId.get(id);
    if (concept) {
      for (const requiredId of concept.requires) {
        if (byId.has(requiredId)) {
          depth = Math.max(depth, depthOf(requiredId) + 1);
        }
      }
    }
    visiting.delete(id);
    depths.set(id, depth);
    return depth;
  }

  for (const concept of concepts) depthOf(concept.id);
  return depths;
}

function truncateLabel(label: string): string {
  return label.length > MAX_LABEL_CHARS
    ? `${label.slice(0, MAX_LABEL_CHARS - 1)}…`
    : label;
}

function computeLayout(concepts: Concept[]): {
  placements: Map<string, NodePlacement>;
  height: number;
} {
  const depths = computeDepths(concepts);
  const layers: Concept[][] = [];
  for (const concept of concepts) {
    const depth = depths.get(concept.id) ?? 0;
    (layers[depth] ??= []).push(concept);
  }
  // Deterministic ordering within a layer: Path order first, then the
  // investigation's extraction order, then id as a stable tie-breaker.
  for (const layer of layers) {
    layer.sort(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) -
          (b.order ?? Number.MAX_SAFE_INTEGER) ||
        a.extractionIndex - b.extractionIndex ||
        a.id.localeCompare(b.id),
    );
  }

  const placements = new Map<string, NodePlacement>();
  layers.forEach((layer, layerIndex) => {
    layer.forEach((concept, i) => {
      const label = truncateLabel(concept.label);
      // Stagger crowded layers vertically so neighbouring labels don't touch.
      const stagger = layer.length >= 4 && i % 2 === 1 ? 18 : 0;
      placements.set(concept.id, {
        concept,
        label,
        width: Math.max(64, label.length * CHAR_WIDTH + NODE_PAD_X * 2),
        x: (VIEW_WIDTH * (i + 1)) / (layer.length + 1),
        y: MARGIN_Y + layerIndex * LAYER_GAP + stagger,
      });
    });
  });

  const layerCount = Math.max(layers.length, 1);
  return {
    placements,
    height: MARGIN_Y * 2 + (layerCount - 1) * LAYER_GAP + 18,
  };
}

function nodeRectClass(concept: Concept): string {
  if (concept.status === "active") {
    return "fill-blue-100 stroke-blue-500 dark:fill-blue-950 dark:stroke-blue-400";
  }
  if (concept.status === "unlocked") {
    return concept.origin === "remedial"
      ? "fill-emerald-100 stroke-amber-500 dark:fill-emerald-950 dark:stroke-amber-500"
      : "fill-emerald-100 stroke-emerald-500 dark:fill-emerald-950 dark:stroke-emerald-600";
  }
  // Locked.
  return concept.origin === "remedial"
    ? "fill-zinc-100 stroke-amber-500 dark:fill-zinc-900 dark:stroke-amber-600"
    : "fill-zinc-100 stroke-zinc-300 dark:fill-zinc-900 dark:stroke-zinc-700";
}

function nodeLabelClass(concept: Concept): string {
  if (concept.status === "active") {
    return "fill-blue-900 dark:fill-blue-100";
  }
  if (concept.status === "unlocked") {
    return "fill-emerald-900 dark:fill-emerald-100";
  }
  return "fill-zinc-500 dark:fill-zinc-500";
}

const TRANSITION: CSSProperties = {
  transition:
    "transform 600ms ease, opacity 400ms ease, stroke 400ms ease, fill 400ms ease",
};

export default function GraphView({
  concepts,
  lessons,
  onRename,
  onDelete,
}: {
  concepts: Concept[];
  lessons: Lesson[];
  /** When provided, the Concept panel offers renaming (recorded as an Edit). */
  onRename?: (conceptId: string, label: string) => Promise<void> | void;
  /** When provided, the Concept panel offers deletion (ADR-0003 semantics). */
  onDelete?: (conceptId: string) => Promise<void> | void;
}) {
  const [reviewedConceptId, setReviewedConceptId] = useState<string | null>(
    null,
  );

  const { placements, height } = useMemo(
    () => computeLayout(concepts),
    [concepts],
  );

  const edges = useMemo(() => {
    const result: { id: string; from: NodePlacement; to: NodePlacement }[] = [];
    for (const to of placements.values()) {
      for (const requiredId of to.concept.requires) {
        const from = placements.get(requiredId);
        if (from) result.push({ id: `${requiredId}->${to.concept.id}`, from, to });
      }
    }
    return result;
  }, [placements]);

  const reviewedConcept =
    concepts.find((c) => c.id === reviewedConceptId) ?? null;
  const reviewedLesson =
    lessons.find((l) => l.conceptId === reviewedConceptId) ?? null;

  if (concepts.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
        className="h-auto w-full rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
        role="img"
        aria-label="Graph of this Session's Concepts and their prerequisites"
        style={{ transition: "height 600ms ease" }}
      >
        <defs>
          <marker
            id="graph-view-arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path
              d="M 0 0 L 8 4 L 0 8 z"
              className="fill-zinc-400 dark:fill-zinc-600"
            />
          </marker>
        </defs>

        {edges.map(({ id, from, to }) => {
          const x1 = from.x;
          const y1 = from.y + NODE_HEIGHT / 2;
          const x2 = to.x;
          const y2 = to.y - NODE_HEIGHT / 2 - 4;
          const bend = Math.max((y2 - y1) / 2, 16);
          const d = `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
          return (
            <path
              key={id}
              d={d}
              fill="none"
              markerEnd="url(#graph-view-arrow)"
              className="stroke-zinc-300 dark:stroke-zinc-700"
              strokeWidth={1.5}
              // CSS `d` transitions the edge with its nodes where supported;
              // the attribute above is the fallback rendering elsewhere.
              style={
                {
                  d: `path("${d}")`,
                  transition: "d 600ms ease, opacity 400ms ease",
                } as CSSProperties
              }
            />
          );
        })}

        {[...placements.values()].map((placement) => {
          const { concept, label, width } = placement;
          const hasLesson = lessons.some((l) => l.conceptId === concept.id);
          const clickable = hasLesson || !!onRename || !!onDelete;
          return (
            <g
              key={concept.id}
              style={{
                ...TRANSITION,
                transform: `translate(${placement.x}px, ${placement.y}px)`,
                cursor: clickable ? "pointer" : "default",
              }}
              onClick={
                clickable ? () => setReviewedConceptId(concept.id) : undefined
              }
              role={clickable ? "button" : undefined}
              aria-label={clickable ? `Open ${concept.label}` : undefined}
            >
              <title>
                {concept.label}
                {concept.skipped
                  ? " — already knew"
                  : concept.origin === "remedial"
                    ? " — remedial"
                    : ""}
                {hasLesson ? " (click to review its Lesson)" : ""}
              </title>
              {concept.status === "active" && (
                <rect
                  x={-width / 2 - 5}
                  y={-NODE_HEIGHT / 2 - 5}
                  width={width + 10}
                  height={NODE_HEIGHT + 10}
                  rx={12}
                  className="animate-pulse fill-none stroke-blue-400 dark:stroke-blue-500"
                  strokeWidth={2}
                />
              )}
              <rect
                x={-width / 2}
                y={-NODE_HEIGHT / 2}
                width={width}
                height={NODE_HEIGHT}
                rx={9}
                className={nodeRectClass(concept)}
                strokeWidth={concept.status === "active" ? 2 : 1.5}
                strokeDasharray={concept.skipped ? "5 4" : undefined}
                style={TRANSITION}
              />
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={12}
                className={`${nodeLabelClass(concept)} select-none ${
                  concept.status === "active" ? "font-semibold" : "font-medium"
                }`}
                style={TRANSITION}
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>

      <GraphLegend />

      {reviewedConcept && (
        <ConceptPanel
          concept={reviewedConcept}
          lesson={reviewedLesson}
          dependents={concepts.filter((c) =>
            c.requires.includes(reviewedConcept.id),
          )}
          onRename={onRename}
          onDelete={onDelete}
          onClose={() => setReviewedConceptId(null)}
        />
      )}
    </div>
  );
}

function GraphLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
      <LegendSwatch className="border-blue-500 bg-blue-100 dark:bg-blue-950">
        Active
      </LegendSwatch>
      <LegendSwatch className="border-emerald-500 bg-emerald-100 dark:border-emerald-600 dark:bg-emerald-950">
        Unlocked
      </LegendSwatch>
      <LegendSwatch className="border-dashed border-emerald-500 bg-emerald-100 dark:border-emerald-600 dark:bg-emerald-950">
        Already knew
      </LegendSwatch>
      <LegendSwatch className="border-zinc-300 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900">
        Locked
      </LegendSwatch>
      <LegendSwatch className="border-amber-500 bg-zinc-100 dark:bg-zinc-900">
        Remedial
      </LegendSwatch>
    </div>
  );
}

function LegendSwatch({
  className,
  children,
}: {
  className: string;
  children: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={`inline-block h-3 w-4 rounded border-[1.5px] ${className}`}
      />
      {children}
    </span>
  );
}

function messageBubbleClass(kind: LessonMessage["kind"]): string {
  if (kind === "user" || kind === "check-answer") {
    return "self-end bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900";
  }
  if (kind === "check-question") {
    return "border border-amber-300 bg-amber-50 text-zinc-900 dark:border-amber-700 dark:bg-amber-950 dark:text-zinc-100";
  }
  return "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100";
}

function ConceptPanel({
  concept,
  lesson,
  dependents,
  onRename,
  onDelete,
  onClose,
}: {
  concept: Concept;
  lesson: Lesson | null;
  dependents: Concept[];
  onRename?: (conceptId: string, label: string) => Promise<void> | void;
  onDelete?: (conceptId: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(concept.label);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={concept.label}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 p-4 dark:border-zinc-800">
          <div className="min-w-0 flex-1">
            {onRename ? (
              <div className="flex gap-2">
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  aria-label="Concept label"
                  className="w-full rounded border border-transparent bg-transparent font-medium text-zinc-900 hover:border-zinc-300 focus:border-zinc-500 focus:outline-none dark:text-zinc-100 dark:hover:border-zinc-700"
                />
                {label.trim() !== concept.label && label.trim() !== "" && (
                  <button
                    onClick={async () => {
                      await onRename(concept.id, label.trim());
                      onClose();
                    }}
                    className="shrink-0 rounded bg-zinc-900 px-3 py-1 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    Rename
                  </button>
                )}
              </div>
            ) : (
              <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
                {concept.label}
              </h3>
            )}
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="capitalize">{concept.status}</span>
              {concept.skipped
                ? " · you already knew this"
                : concept.origin === "remedial"
                  ? " · remedial detour"
                  : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            Close
          </button>
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto p-4">
          {!lesson && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {concept.summary}
            </p>
          )}
          {lesson?.messages.length === 0 && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Nothing recorded in this Lesson yet.
            </p>
          )}
          {lesson?.messages.map((m, i) => (
            <div
              key={i}
              className={`whitespace-pre-wrap rounded-lg p-3 text-sm ${messageBubbleClass(m.kind)}`}
            >
              {m.kind === "check-question" && (
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
                  Mastery check
                </span>
              )}
              {m.text}
            </div>
          ))}
        </div>

        {onDelete && (
          <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
            {confirmingDelete ? (
              <div className="flex flex-col gap-2">
                {dependents.length > 0 && (
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    {dependents.map((d) => d.label).join(", ")}{" "}
                    {dependents.length === 1 ? "lists" : "list"} this as a
                    prerequisite — deleting won&apos;t remove them, but the
                    link will be gone.
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      await onDelete(concept.id);
                      onClose();
                    }}
                    className="rounded bg-red-600 px-3 py-1 text-sm font-medium text-white"
                  >
                    Delete for real
                  </button>
                  <button
                    onClick={() => setConfirmingDelete(false)}
                    className="rounded border border-zinc-300 px-3 py-1 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                  >
                    Keep it
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmingDelete(true)}
                className="text-sm text-red-600 hover:underline"
              >
                Delete this Concept…
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
