"use client";

// GraphView renders Concepts as a node-link graph in the reading voice:
// a dot and a serif label per Concept (see CONTEXT.md: "Node" is the
// UI-layer word), `requires` edges as quiet curves. Clicking a Concept
// opens its detail — summary, provenance, the Lesson it came from, and
// the user's Edit controls (rename always; delete blocked while a Concept
// is being learned).

import { useEffect, useMemo, useState } from "react";
import LessonFlow from "@/components/session/LessonFlow";
import { computeLayout } from "@/lib/dag-layout";
import type { Check, Concept, Lesson, Session } from "@/lib/types";

const FULL = {
  viewWidth: 640,
  marginY: 46,
  layerGap: 96,
  charWidth: 7.2,
  padX: 14,
  maxLabelChars: 24,
  stagger: 20,
  fitToSlot: true,
  maxHeight: 760,
};

export default function GraphView({
  concepts,
  lessons,
  checks = [],
  sessions = [],
  onRename,
  onDelete,
}: {
  concepts: Concept[];
  lessons: Lesson[];
  checks?: Check[];
  sessions?: Session[];
  /** When provided, the detail panel offers renaming (recorded as an Edit). */
  onRename?: (conceptId: string, label: string) => Promise<void> | void;
  /** When provided, the detail panel offers deletion (ADR-0003 semantics). */
  onDelete?: (conceptId: string) => Promise<void> | void;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [label, setLabel] = useState("");
  const [confirming, setConfirming] = useState(false);

  const { placements, height } = useMemo(
    () => computeLayout(concepts, FULL),
    [concepts],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (renaming) setRenaming(false);
      else if (reviewing) setReviewing(false);
      else setSel(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [renaming, reviewing]);

  const selected = concepts.find((c) => c.id === sel) ?? null;
  const lesson = selected
    ? (lessons.find((l) => l.conceptId === selected.id) ?? null)
    : null;
  const sessionOf = selected
    ? sessions.find((s) => s.id === selected.sessionId)
    : undefined;

  if (concepts.length === 0) return null;

  function pick(id: string) {
    setSel((cur) => (cur === id ? null : id));
    setReviewing(false);
    setRenaming(false);
    setConfirming(false);
  }

  const edges: React.ReactNode[] = [];
  for (const to of placements.values()) {
    for (const requiredId of to.concept.requires) {
      const from = placements.get(requiredId);
      if (!from) continue;
      const y1 = from.y + 8;
      const y2 = to.y - 24;
      const bend = Math.max((y2 - y1) / 2, 16);
      const lit = sel !== null && (sel === to.concept.id || sel === requiredId);
      edges.push(
        <path
          key={`${requiredId}->${to.concept.id}`}
          className={`gedge${lit ? " lit" : ""}`}
          d={`M ${from.x} ${y1} C ${from.x} ${y1 + bend}, ${to.x} ${y2 - bend}, ${to.x} ${y2}`}
        />,
      );
    }
  }

  return (
    <div>
      <div className="graphwrap">
        <svg
          viewBox={`0 0 ${FULL.viewWidth} ${height}`}
          role="img"
          aria-label="Your concept graph"
          style={{ transition: "height 0.6s ease" }}
        >
          {edges}
          {[...placements.values()].map(({ concept, label: lbl, width, x, y }) => {
            const cls =
              concept.status === "active"
                ? "active"
                : concept.status === "locked"
                  ? "locked"
                  : "";
            const sub = concept.skipped
              ? concept.order === null
                ? "already known"
                : "skipped"
              : concept.origin === "remedial"
                ? "detour"
                : "";
            return (
              <g
                key={concept.id}
                className={`gnode gmove ${cls}${sel === concept.id ? " sel" : ""}`}
                transform={`translate(${x} ${y})`}
                tabIndex={0}
                role="button"
                aria-label={concept.label}
                onClick={() => pick(concept.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    pick(concept.id);
                  }
                }}
              >
                <rect
                  className="hit"
                  x={-width / 2 - 8}
                  y={-32}
                  width={width + 16}
                  height={sub ? 48 : 36}
                />
                <circle className="dot" cx={0} cy={-19} r={3.5} />
                <text className="lbl" y={0} textAnchor="middle">
                  {lbl}
                </text>
                {sub && (
                  <text className="sub" y={15} textAnchor="middle">
                    {sub}
                  </text>
                )}
                <path className="under" d={`M ${-width / 2} 5 H ${width / 2}`} />
              </g>
            );
          })}
        </svg>
      </div>

      <div className="legend sc">
        <span>
          <i style={{ background: "var(--laurel)" }}></i>Unlocked
        </span>
        <span>
          <i style={{ background: "var(--rubric)", borderRadius: "50%" }}></i>
          Being learned
        </span>
        <span>
          <i style={{ border: "1px solid var(--ink3)" }}></i>Not yet reached
        </span>
      </div>

      {selected ? (
        <div className="detail fade-in">
          {renaming ? (
            <div className="rename">
              <input
                autoFocus
                aria-label="New name"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (label.trim() && label.trim() !== selected.label) {
                      onRename?.(selected.id, label.trim());
                    }
                    setRenaming(false);
                  }
                  if (e.key === "Escape") setRenaming(false);
                }}
              />
              <button
                className="act primary sc"
                onClick={() => {
                  if (label.trim() && label.trim() !== selected.label) {
                    onRename?.(selected.id, label.trim());
                  }
                  setRenaming(false);
                }}
              >
                Save
              </button>
              <button className="act sc" onClick={() => setRenaming(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <h4>{selected.label}</h4>
          )}
          <p className="sm">{selected.summary}</p>
          <p className="sm" style={{ color: "var(--ink3)", fontStyle: "italic", marginTop: 6 }}>
            {selected.status === "unlocked"
              ? selected.skipped
                ? "Unlocked without a lesson — you already knew it."
                : `Unlocked${sessionOf ? ` in “${sessionOf.topic}”` : ""}${selected.origin === "remedial" ? ", as a detour" : ""}.`
              : selected.status === "active"
                ? "Being learned right now."
                : "Not reached yet."}
          </p>
          <div className="acts">
            {lesson && lesson.messages.length > 0 && (
              <button className="act sc" onClick={() => setReviewing((r) => !r)}>
                {reviewing ? "Hide the lesson" : "Read the lesson"}
              </button>
            )}
            {onRename && (
              <button
                className="act sc"
                onClick={() => {
                  setLabel(selected.label);
                  setRenaming(true);
                }}
              >
                Rename
              </button>
            )}
            {onDelete &&
              (selected.status === "active" ? (
                <button
                  className="act sc"
                  disabled
                  title="Being learned right now — finish or skip it in its session first."
                >
                  Remove from graph
                </button>
              ) : confirming ? (
                <>
                  <button
                    className="act rubric-act sc"
                    onClick={() => {
                      setConfirming(false);
                      setSel(null);
                      onDelete(selected.id);
                    }}
                  >
                    Confirm removal
                  </button>
                  <button className="act sc" onClick={() => setConfirming(false)}>
                    Keep it
                  </button>
                </>
              ) : (
                <button className="act sc" onClick={() => setConfirming(true)}>
                  Remove from graph
                </button>
              ))}
          </div>
          {reviewing && lesson && (
            <div className="review" style={{ marginTop: 18 }}>
              <LessonFlow
                messages={lesson.messages}
                checks={checks}
                animateAfter={Number.POSITIVE_INFINITY}
                busy={null}
              />
            </div>
          )}
        </div>
      ) : (
        <p className="mnote" style={{ fontSize: 14 }}>
          Select a concept to see where it came from.
        </p>
      )}
    </div>
  );
}
