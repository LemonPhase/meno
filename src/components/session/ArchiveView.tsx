"use client";

// A Session's read-only record: the folio you already read. Recap, tally,
// and every Lesson in Path order — expandable transcripts, no composer.

import { useEffect, useState } from "react";
import Link from "next/link";
import LessonFlow from "@/components/session/LessonFlow";
import Markdown from "@/components/session/Markdown";
import PathRail from "@/components/session/PathRail";
import type { Check, Lesson, Session, SessionConcept } from "@/lib/types";
import { roman, timeAgo } from "@/lib/ui";

type Record_ = {
  session: Session;
  concepts: SessionConcept[];
  checks: Check[];
  lessons: Lesson[];
};

export default function ArchiveView({
  id,
  record: given,
}: {
  id: string;
  /** Already fetched by the route; skips a second round trip. */
  record?: Record_;
}) {
  const [fetched, setFetched] = useState<Record_ | null>(null);
  const [missing, setMissing] = useState(false);
  const record = given ?? fetched;
  const [openId, setOpenId] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false);

  useEffect(() => {
    if (given) return;
    fetch(`/api/sessions/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("gone"))))
      .then(setFetched)
      .catch(() => setMissing(true));
  }, [id, given]);

  if (missing) {
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
  if (!record) return <div className="work" />;

  const { session, concepts, lessons } = record;
  const path = concepts
    .filter((c) => c.order !== null || c.status === "active")
    .sort((a, b) => (a.order ?? -1) - (b.order ?? -1));
  const unlocked = concepts
    .filter((c) => c.status === "unlocked")
    .sort(
      (a, b) =>
        (a.order === null ? -1 : a.order) - (b.order === null ? -1 : b.order),
    );
  const lessonFor = (cid: string) =>
    lessons.find((l) => l.conceptId === cid) ?? null;

  return (
    <>
      <div className="work with-rail">
        <section className="column">
          <div className="flow fade-in">
            <span className="kicker sc">
              Session record · {timeAgo(session.createdAt)}
            </span>
            <h1 className="h-display">{session.topic}</h1>

            {session.recap && (
              <div className="recap" style={{ marginTop: 22 }}>
                <Markdown text={session.recap} />
              </div>
            )}

            {unlocked.length > 0 && (
              <>
                <span className="kicker sc">What was unlocked</span>
                <ol className="tally" style={{ marginBottom: 30 }}>
                  {unlocked.map((c) => (
                    <li key={c.id}>
                      <span className="mk"></span>
                      <span>{c.label}</span>
                      <span className="how">
                        {c.skipped
                          ? c.order === null
                            ? "known before it started"
                            : "skipped — already had it"
                          : c.origin === "remedial"
                            ? "detour, taught and checked"
                            : "taught and checked"}
                      </span>
                    </li>
                  ))}
                </ol>
              </>
            )}

            <span className="kicker sc">The lessons, in order</span>
            <ol className="folio-list">
              {path.map((c, i) => {
                const lesson = lessonFor(c.id);
                const open = openId === c.id;
                return (
                  <li key={c.id}>
                    <button
                      className="folio-head"
                      disabled={!lesson}
                      onClick={() => setOpenId(open ? null : c.id)}
                      aria-expanded={open}
                    >
                      <span className="n sc">{roman(i + 1)}</span>
                      <span className="lb">{c.label}</span>
                      <span className="how">
                        {lesson
                          ? open
                            ? "hide the lesson"
                            : "read the lesson"
                          : "never reached"}
                      </span>
                    </button>
                    {open && lesson && (
                      <div className="review" style={{ marginTop: 14 }}>
                        <LessonFlow
                          messages={lesson.messages}
                          checks={record.checks}
                          animateAfter={Number.POSITIVE_INFINITY}
                          busy={null}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>

            <div
              style={{ display: "flex", justifyContent: "flex-end", gap: 20, marginTop: 30 }}
            >
              <Link href="/graph" className="act primary sc">
                See your graph
              </Link>
            </div>
          </div>
        </section>

        <PathRail
          session={session}
          concepts={concepts}
          checks={record.checks}
          lessons={lessons}
          mode="complete"
          open={railOpen}
          onClose={() => setRailOpen(false)}
          insertedAfter={Number.POSITIVE_INFINITY}
        />
      </div>
      {!railOpen && (
        <button className="rail-fab sc" onClick={() => setRailOpen(true)}>
          This session
        </button>
      )}
    </>
  );
}
