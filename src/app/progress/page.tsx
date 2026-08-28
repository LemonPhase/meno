"use client";

// Progress — honest totals from data the Graph already stores. No streaks,
// no gamification; charts can come when there is enough data to deserve them.

import Link from "next/link";
import { useEffect, useState } from "react";
import type {
  Check,
  Edit,
  Session,
  SessionConcept,
  SessionSummary,
} from "@/lib/types";
import { roman, timeAgo } from "@/lib/ui";

type Overview = {
  concepts: SessionConcept[];
  sessions: Session[];
  checks: Check[];
  edits: Edit[];
};

export default function ProgressPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [summaries, setSummaries] = useState<SessionSummary[]>([]);

  useEffect(() => {
    fetch("/api/graph")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((d) => setSummaries(d.sessions))
      .catch(() => {});
  }, []);

  if (!data) return <div className="page" />;

  const unlocked = data.concepts.filter((c) => c.status === "unlocked");
  const taught = unlocked.filter((c) => !c.skipped);
  const detours = data.concepts.filter((c) => c.origin === "remedial");
  const mastery = data.checks.filter(
    (c) => c.phase === "mastery" && c.answer !== null,
  );
  const passed = mastery.filter((c) => c.verdict === "pass");
  const completed = data.sessions.filter((s) => s.phase === "complete");

  if (data.concepts.length === 0 && data.sessions.length === 0) {
    return (
      <div className="page fade-in">
        <span className="kicker sc">Nothing here yet</span>
        <h1 className="h-display">No progress to count.</h1>
        <p className="lede">
          Run a session and this page starts keeping the ledger: what you
          unlocked, what was taught, what you already had.
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
    <div className="page fade-in">
      <span className="kicker sc">The ledger</span>
      <h1 className="h-display">Progress</h1>
      <p className="lede">
        What your graph holds, and how it got there. Every number below is a
        concept you can point at.
      </p>

      <div className="statgrid">
        <div className="stat stat-laurel">
          <span className="n">{unlocked.length}</span>
          <span className="l sc">Concepts unlocked</span>
        </div>
        <div className="stat">
          <span className="n">{taught.length}</span>
          <span className="l sc">Taught &amp; checked</span>
        </div>
        <div className="stat">
          <span className="n">{unlocked.length - taught.length}</span>
          <span className="l sc">Already known</span>
        </div>
        <div className="stat stat-rubric">
          <span className="n">
            {passed.length}
            <span className="of"> / {mastery.length}</span>
          </span>
          <span className="l sc">Checks passed</span>
        </div>
      </div>

      <div className="mrow">
        <span>Sessions</span>
        <b>
          {completed.length} completed · {data.sessions.length - completed.length}{" "}
          in progress
        </b>
      </div>
      <div className="mrow">
        <span>Detours taken</span>
        <b>{detours.length}</b>
      </div>
      <div className="mrow">
        <span>Edits to your graph</span>
        {/* The overview returns the 50 most recent, so past that the
            honest thing to show is "50+", not a number that stops. */}
        <b>{data.edits.length >= 50 ? "50+" : data.edits.length}</b>
      </div>

      <div style={{ marginTop: 40 }}>
        <span className="kicker sc">Session by session</span>
        <ol className="folio-list">
          {summaries.map((s, i) => (
            <li key={s.id}>
              <div className="folio-head" style={{ cursor: "default" }}>
                <span className="n sc">{roman(summaries.length - i)}</span>
                <span className="lb">{s.topic}</span>
                <span className="how">
                  {s.phase === "complete"
                    ? `${s.unlockedCount} unlocked · ${timeAgo(s.createdAt)}`
                    : `in progress · ${timeAgo(s.createdAt)}`}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {data.edits.length > 0 && (
        <div className="mgroup" style={{ maxWidth: 480 }}>
          <span className="mh sc">Recent edits</span>
          <ol className="editlog">
            {data.edits.slice(0, 8).map((e) => (
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
        </div>
      )}
    </div>
  );
}
