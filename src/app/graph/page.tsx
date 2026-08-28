"use client";

// "Your graph" — the whole Graph across every Session: the record of what
// you know, and what Meno knows about you.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import GraphView from "@/components/GraphView";
import type { Check, Edit, Lesson, Session, SessionConcept } from "@/lib/types";
import { announceSessionsChanged, timeAgo } from "@/lib/ui";

type Overview = {
  concepts: SessionConcept[];
  sessions: Session[];
  checks: Check[];
  edits: Edit[];
  lessons: Lesson[];
};

export default function GraphPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/graph")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setError("could not load your graph"));
  }, []);
  useEffect(refresh, [refresh]);

  async function edit(url: string, method: string, body?: unknown) {
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!res.ok) {
        // An error body isn't always JSON (a crashed route returns HTML),
        // so fall back to the status rather than throwing over the throw.
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.error ?? `${res.status} ${res.statusText}`);
      }
      refresh();
      announceSessionsChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "something went wrong");
    }
  }

  if (!data) return <div className="page" />;

  if (data.concepts.length === 0) {
    return (
      <div className="page fade-in">
        <span className="kicker sc">Nothing here yet</span>
        <h1 className="h-display">Your graph is empty.</h1>
        <p className="lede">
          Concepts land here as you unlock them. Finish one session and this
          page stops being blank — and it stays filled in for every session
          after.
        </p>
        <div style={{ marginTop: 24 }}>
          <Link href="/new" className="act primary sc">
            Start a session
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page wide fade-in">
      <div className="intro">
        <span className="kicker sc">Everything you have unlocked</span>
        <h1 className="h-display">Your graph</h1>
        <p className="lede">
          One graph, many sessions. Click a concept to read back the lesson it
          came from, rename it, or take it out.
        </p>
      </div>
      <div style={{ marginTop: 24 }}>
        <GraphView
          concepts={data.concepts}
          lessons={data.lessons}
          checks={data.checks}
          sessions={data.sessions}
          onRename={(id, label) =>
            edit(`/api/concepts/${id}`, "PATCH", { label })
          }
          onDelete={(id) => edit(`/api/concepts/${id}`, "DELETE")}
        />
      </div>

      <div className="mgroup" style={{ maxWidth: 480 }}>
        <span className="mh sc">Your edits</span>
        {data.edits.length > 0 ? (
          <ol className="editlog">
            {data.edits.map((e) => (
              <li key={e.id}>
                {e.kind === "rename" ? (
                  <>
                    <b>{e.before}</b> renamed to <b>{e.after}</b>
                  </>
                ) : (
                  <>
                    <b>{e.before}</b> removed
                  </>
                )}
                <br />
                {timeAgo(e.createdAt)}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mnote">
            Nothing yet. Renaming or removing a concept is recorded here, and
            Meno reads it before it changes your graph again.
          </p>
        )}
      </div>

      {error && (
        <div className="toast err on" role="alert">
          <span>{error}</span>
          <button className="act sc" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
