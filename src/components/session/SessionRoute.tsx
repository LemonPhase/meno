"use client";

// One Session by id. In progress it opens as the live workspace — Sessions
// run concurrently, so any of them can be picked up where it left off;
// completed, it opens as its read-only record.

import { useEffect, useState } from "react";
import ArchiveView from "@/components/session/ArchiveView";
import SessionWorkspace from "@/components/session/SessionWorkspace";
import type { Check, Lesson, Session, SessionConcept } from "@/lib/types";

export type SessionRecord = {
  session: Session;
  concepts: SessionConcept[];
  checks: Check[];
  lessons: Lesson[];
};

export default function SessionRoute({ id }: { id: string }) {
  // Carrying the id in the state is what makes a navigation between two
  // Sessions show the new one's loading state rather than the old one's.
  const [loaded, setLoaded] = useState<{
    id: string;
    record: SessionRecord | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sessions/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((record: SessionRecord | null) => {
        if (!cancelled) setLoaded({ id, record });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ id, record: null });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const current = loaded?.id === id ? loaded : null;

  if (current && current.record === null) {
    return (
      <div className="work">
        <section className="column">
          <div className="flow" style={{ paddingTop: "8vh" }}>
            <h1 className="h-display">No such session.</h1>
            <p className="lede">
              It may have been from another graph, or the link is stale.
            </p>
          </div>
        </section>
      </div>
    );
  }
  if (!current?.record) return <div className="work" />;
  if (current.record.session.phase === "complete") {
    return <ArchiveView id={id} record={current.record} />;
  }
  return <SessionWorkspace sessionId={id} />;
}
