"use client";

// The right rail during Learning and Complete: the session's minimap (its
// Concepts as a small `requires` DAG, watching detours splice in live),
// the Path as the margin apparatus, and quiet session stats below.

import { useState } from "react";
import { computeLayout } from "@/lib/dag-layout";
import type { Check, Concept, Session } from "@/lib/types";
import { readPref, roman, writePref } from "@/lib/ui";

const MAP_PREF = "meno-rail-map";

const MINI = {
  viewWidth: 268,
  marginY: 36,
  layerGap: 68,
  charWidth: 6.6,
  padX: 8,
  maxLabelChars: 22,
  stagger: 15,
  fitToSlot: true,
  maxHeight: 430,
};

function Minimap({ concepts }: { concepts: Concept[] }) {
  const [sel, setSel] = useState<string | null>(null);
  const { placements, height } = computeLayout(concepts, MINI);
  const byId = new Map(concepts.map((c) => [c.id, c]));

  const edges: React.ReactNode[] = [];
  for (const to of placements.values()) {
    for (const requiredId of to.concept.requires) {
      const from = placements.get(requiredId);
      if (!from) continue;
      const y1 = from.y + 6;
      const y2 = to.y - 16;
      const bend = Math.max((y2 - y1) / 2, 12);
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

  const selected = sel ? byId.get(sel) : null;

  return (
    <>
      <div className="minimap">
        <svg
          viewBox={`0 0 ${MINI.viewWidth} ${height}`}
          role="img"
          aria-label="This session's concepts and their prerequisites"
        >
          {edges}
          {[...placements.values()].map(({ concept, label, x, y }) => {
            const cls =
              concept.status === "active"
                ? "active"
                : concept.status === "locked"
                  ? "locked"
                  : "";
            // Terser than the full graph's wording: at rail width a long
            // sub-label reaches into its neighbour's slot.
            const sub = concept.skipped
              ? concept.order === null
                ? "known"
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
                onClick={() =>
                  setSel(sel === concept.id ? null : concept.id)
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSel(sel === concept.id ? null : concept.id);
                  }
                }}
              >
                <rect className="hit" x={-46} y={-24} width={92} height={sub ? 40 : 30} />
                <circle className="dot" cx={0} cy={-13} r={3} />
                <text className="lbl" y={0} textAnchor="middle" style={{ fontSize: 12.5 }}>
                  {label}
                </text>
                {sub && (
                  <text className="sub" y={13} textAnchor="middle" style={{ fontSize: 10 }}>
                    {sub}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      {selected && (
        <p className="mnote" style={{ marginTop: -12, marginBottom: 22 }}>
          <b style={{ fontStyle: "normal", color: "var(--ink2)", fontWeight: 500 }}>
            {selected.label}.
          </b>{" "}
          {selected.summary}
        </p>
      )}
    </>
  );
}

export default function PathRail({
  session,
  concepts,
  checks,
  mode,
  open,
  onClose,
  insertedAfter,
}: {
  session: Session;
  concepts: Concept[];
  checks: Check[];
  mode: "learning" | "complete";
  open: boolean;
  onClose: () => void;
  /** Concepts created after this timestamp slide in (a detour splicing). */
  insertedAfter: number;
}) {
  const path = concepts
    .filter((c) => c.order !== null || c.status === "active")
    .sort((a, b) => (a.order ?? -1) - (b.order ?? -1));
  // Concepts the diagnostic found the user already had never joined the
  // Path — but they are the ground it starts from, so the rail shows one
  // continuous list with them standing first, already green.
  const known = concepts.filter(
    (c) => c.status === "unlocked" && c.order === null,
  );
  const rows = [
    ...known.map((c) => ({ concept: c, before: true })),
    ...path.map((c) => ({ concept: c, before: false })),
  ];
  const active = concepts.find((c) => c.id === session.activeConceptId);
  const folio = active ? path.findIndex((c) => c.id === active.id) + 1 : 0;

  // Concepts created after the page loaded slide in (.ins) — the visible
  // moment a detour splices into the Path.
  const fresh = new Set(
    path.filter((c) => c.createdAt > insertedAfter).map((c) => c.id),
  );

  const attempts = active
    ? checks.filter(
        (c) =>
          c.phase === "mastery" &&
          c.conceptIds.includes(active.id) &&
          c.answer !== null,
      ).length
    : 0;

  const unlocked = concepts.filter((c) => c.status === "unlocked");

  const [mapOpen, setMapOpen] = useState(() => readPref(MAP_PREF, false));
  function toggleMap() {
    const next = !mapOpen;
    setMapOpen(next);
    writePref(MAP_PREF, next);
  }

  return (
    <aside className={`rail${open ? " open" : ""}`}>
      {open && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <button className="act sc" onClick={onClose}>
            Close
          </button>
        </div>
      )}
      <button className="rail-head" onClick={toggleMap} aria-expanded={mapOpen}>
        <span className="mh sc">The path</span>
        <span className="sp" />
        <span className="chev sc">{mapOpen ? "hide map" : "show map"}</span>
      </button>
      {/* Kept mounted so opening and closing animate alike; inert while
          closed so its nodes stay out of the tab order. */}
      <div className={`map-slot${mapOpen ? " open" : ""}`} inert={!mapOpen}>
        <div className="map-inner">
          <Minimap concepts={concepts} />
        </div>
      </div>
      <ol className="app-list">
        {rows.map(({ concept: c, before }) => {
          const cls =
            c.status === "unlocked" ? "done" : c.status === "active" ? "now" : "";
          const note = before
            ? "already yours"
            : c.skipped
              ? "skipped · you knew it"
              : c.origin === "remedial"
                ? c.status === "unlocked"
                  ? "detour · unlocked"
                  : "added along the way"
                : c.status === "unlocked"
                  ? "unlocked"
                  : "";
          return (
            <li key={c.id} className={`${cls}${fresh.has(c.id) ? " ins" : ""}`}>
              <span className="mk"></span>
              <span>
                <span className="lb">{c.label}</span>
                {note && <span className="note">{note}</span>}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mgroup">
        {mode === "learning" ? (
          <>
            <div className="mrow">
              <span>Folio</span>
              <b>
                {roman(folio)} of {roman(path.length)}
              </b>
            </div>
            <div className="mrow">
              <span>Check attempts</span>
              <b>{attempts}</b>
            </div>
          </>
        ) : (
          <>
            <div className="mrow">
              <span>Unlocked</span>
              <b>{unlocked.length}</b>
            </div>
            <div className="mrow">
              <span>Taught</span>
              <b>{unlocked.filter((c) => !c.skipped).length}</b>
            </div>
            <div className="mrow">
              <span>Already known</span>
              <b>{unlocked.filter((c) => c.skipped).length}</b>
            </div>
            <div className="mrow">
              <span>Detours</span>
              <b>{unlocked.filter((c) => c.origin === "remedial").length}</b>
            </div>
          </>
        )}
        <p className="mnote" style={{ marginTop: 12 }}>
          Everything unlocked here stays in your graph after the session ends.
        </p>
      </div>
    </aside>
  );
}
