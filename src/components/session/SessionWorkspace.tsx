"use client";

// The live Session workspace at "/": one state machine across the five
// phases. The Path gets its center-stage approval moment in Previewing,
// then settles into the right rail once Learning begins.

import Link from "next/link";
import { useEffect, useState } from "react";
import LessonFlow, { EventLine } from "@/components/session/LessonFlow";
import Markdown from "@/components/session/Markdown";
import PathRail from "@/components/session/PathRail";
import TopicEntry from "@/components/session/TopicEntry";
import type { Check, Lesson, Session, SessionConcept } from "@/lib/types";
import { announceSessionsChanged, roman } from "@/lib/ui";

type State = {
  session: Session | null;
  concepts: SessionConcept[];
  checks: Check[];
  lessons: Lesson[];
};

const EMPTY: State = { session: null, concepts: [], checks: [], lessons: [] };

const sessionUrl = (id?: string) =>
  id ? `/api/session?session=${encodeURIComponent(id)}` : "/api/session";

const THINKING: Record<string, string> = {
  chat: "Meno is thinking",
  answer: "Reading your answer",
  check: "Writing a check",
  advance: "Preparing the first lesson",
  breakdown: "Finding what is missing",
};

function pathOf(concepts: SessionConcept[]): SessionConcept[] {
  return concepts
    .filter((c) => c.order !== null || c.status === "active")
    .sort((a, b) => (a.order ?? -1) - (b.order ?? -1));
}

export default function SessionWorkspace({
  sessionId,
}: {
  /** Which Session to work in; omitted, the one the app opens on. */
  sessionId?: string;
}) {
  const [state, setState] = useState<State>(EMPTY);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [resumeNote, setResumeNote] = useState(false);

  // Everything present at first load renders settled; only what arrives
  // during this visit animates in. The watermark is the newest server
  // timestamp seen in the initial state.
  const [watermark, setWatermark] = useState(Number.POSITIVE_INFINITY);

  useEffect(() => {
    fetch(sessionUrl(sessionId))
      .then((r) => r.json())
      .then((s: State) => {
        setState(s);
        setReady(true);
        const stamps = [
          0,
          ...s.lessons.flatMap((l) => l.messages.map((m) => m.createdAt)),
          ...s.concepts.map((c) => c.createdAt),
        ];
        setWatermark(Math.max(...stamps));
        if (
          s.session?.phase === "learning" &&
          (s.lessons.find((l) => l.conceptId === s.session!.activeConceptId)
            ?.messages.length ?? 0) > 1
        ) {
          setResumeNote(true);
        }
      })
      .catch(() => setReady(true));
  }, [sessionId]);

  // No interval polling: every change to a Session — including the agent's
  // own Adjustments — happens inside a request this client made, and that
  // response already carries the new state. The only way to go stale is
  // another tab or device, so we refetch when this one is looked at again.
  const phase = state.session?.phase;
  useEffect(() => {
    // Listening only while idle also means a refresh in flight is
    // cancelled the moment the user acts, so it can't clobber the result.
    if (!phase || phase === "complete" || busy) return;
    let cancelled = false;
    async function refresh() {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(sessionUrl(sessionId));
        if (!res.ok) return;
        const next = await res.json();
        if (!cancelled) setState(next);
      } catch {
        // Ignore a transient failure; the next focus tries again.
      }
    }
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [phase, busy, sessionId]);

  // A new Active Concept starts at the top of the sheet.
  const activeId = state.session?.activeConceptId;
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [activeId, phase]);

  // Sessions run concurrently, so every call says which one it is about.
  const target = sessionId ?? state.session?.id;

  async function call(
    label: string,
    url: string,
    body?: unknown,
    method = "POST",
  ): Promise<void> {
    setBusy(label);
    setError(null);
    const payload =
      method === "POST" ? { sessionId: target, ...(body ?? {}) } : body;
    // A DELETE carries no body, so the target rides in the query string —
    // otherwise the route answers with whichever Session is newest.
    const href = target ? `${url}?session=${encodeURIComponent(target)}` : url;
    try {
      const res = await fetch(href, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      if (!res.ok) {
        // An error body isn't always JSON (a crashed route returns HTML),
        // so fall back to the status rather than throwing over the throw.
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.error ?? `${res.status} ${res.statusText}`);
      }
      setState(await res.json());
      announceSessionsChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "something went wrong");
    } finally {
      setBusy(null);
    }
  }

  const { session } = state;

  if (!ready) return <div className="work" />;

  if (!session) {
    return (
      <>
        <TopicEntry
          onDone={(s) => setState(s as State)}
          onError={setError}
        />
        <Toast error={error} onDismiss={() => setError(null)} />
      </>
    );
  }

  if (session.phase === "investigating") {
    // A Session interrupted mid-investigation; the record exists but its
    // Concepts may not. Offer a fresh start rather than a dead screen.
    return (
      <div className="work">
        <section className="column">
          <div className="flow" style={{ paddingTop: "8vh" }}>
            <span className="kicker sc">Interrupted</span>
            <h1 className="h-display">{session.topic}</h1>
            <p className="lede">
              This session was interrupted while investigating and can&apos;t
              be resumed. Start it again — the investigation is quick.
            </p>
            <div style={{ marginTop: 24 }}>
              <Link href="/new" className="act primary sc">
                Start a new session
              </Link>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const withRail =
    session.phase === "learning" || session.phase === "complete";
  const path = pathOf(state.concepts);
  const active = state.concepts.find((c) => c.id === session.activeConceptId);
  const folio = active ? path.findIndex((c) => c.id === active.id) + 1 : 0;

  return (
    <>
      <div className={`work${withRail ? " with-rail" : ""}`}>
        <section
          className={`column${session.phase === "learning" ? " learning" : ""}`}
        >
          {session.phase === "diagnosing" && (
            <Diagnosing state={state} busy={busy} call={call} />
          )}
          {session.phase === "previewing" && (
            <Previewing state={state} busy={busy} call={call} />
          )}
          {session.phase === "learning" && active && (
            <Learning
              state={state}
              active={active}
              path={path}
              folio={folio}
              busy={busy}
              call={call}
              animateAfter={watermark}
              resumeNote={resumeNote}
              onDismissResume={() => setResumeNote(false)}
            />
          )}
          {session.phase === "complete" && <Complete state={state} />}
        </section>

        {withRail && (
          <PathRail
            session={session}
            concepts={state.concepts}
            checks={state.checks}
            mode={session.phase === "complete" ? "complete" : "learning"}
            open={railOpen}
            onClose={() => setRailOpen(false)}
            insertedAfter={watermark}
          />
        )}
      </div>

      {withRail && !railOpen && (
        <button
          className={`rail-fab sc${session.phase === "learning" ? " above-composer" : ""}`}
          onClick={() => setRailOpen(true)}
        >
          Path · {roman(Math.max(folio, 1))} of {roman(Math.max(path.length, 1))}
        </button>
      )}

      <Toast error={error} onDismiss={() => setError(null)} />
    </>
  );
}

function Toast({
  error,
  onDismiss,
}: {
  error: string | null;
  onDismiss: () => void;
}) {
  if (!error) return null;
  return (
    <div className="toast err on" role="alert">
      <span>{error}</span>
      <button className="act sc" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

/* ============================ diagnosing ============================ */

function Diagnosing({
  state,
  busy,
  call,
}: {
  state: State;
  busy: string | null;
  call: (label: string, url: string, body?: unknown) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const diagnostics = state.checks.filter((c) => c.phase === "diagnostic");

  return (
    <div className="flow fade-in">
      <span className="kicker sc">{state.session!.topic}</span>
      <h1 className="h-display">First — where are you starting from?</h1>
      <p className="lede">
        {diagnostics.length} questions. Answer roughly; these are not a test —
        &ldquo;no idea&rdquo; is a genuinely useful answer, it changes what you
        get taught.
      </p>
      <div style={{ marginTop: 24 }}>
        {diagnostics.map((d, i) => (
          <div className="qblock" key={d.id}>
            <span className="qnum sc">{roman(i + 1)}</span>
            <div className="qbody">
              <p className="q">{d.question}</p>
              <div className="answer">
                <textarea
                  rows={1}
                  value={answers[d.id] ?? ""}
                  placeholder="Your answer…"
                  onChange={(e) => {
                    setAnswers((a) => ({ ...a, [d.id]: e.target.value }));
                    e.target.style.height = "auto";
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`;
                  }}
                />
              </div>
              <div className="qmeta">
                <button
                  className="act sc"
                  onClick={() =>
                    setAnswers((a) => ({ ...a, [d.id]: "No idea." }))
                  }
                >
                  No idea
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 24 }}>
        <button
          className="act primary sc"
          disabled={!!busy}
          onClick={() =>
            call("diagnose", "/api/session/diagnostic", {
              answers: diagnostics.map((d) => ({
                checkId: d.id,
                answer: answers[d.id] ?? "",
              })),
            })
          }
        >
          {busy === "diagnose" ? "Reading your answers…" : "Submit answers"}
        </button>
      </div>
    </div>
  );
}

/* ============================ previewing ============================ */

function Previewing({
  state,
  busy,
  call,
}: {
  state: State;
  busy: string | null;
  call: (
    label: string,
    url: string,
    body?: unknown,
    method?: string,
  ) => Promise<void>;
}) {
  const [removing, setRemoving] = useState<string | null>(null);
  const known = state.concepts.filter((c) => c.status === "unlocked");
  const path = state.concepts
    .filter((c) => c.order !== null)
    .sort((a, b) => a.order! - b.order!);

  function drop(id: string) {
    setRemoving(id);
    setTimeout(() => {
      call("delete", `/api/concepts/${id}`, undefined, "DELETE").finally(() =>
        setRemoving(null),
      );
    }, 300);
  }

  return (
    <div className="flow fade-in">
      <span className="kicker sc">{state.session!.topic}</span>
      <h1 className="h-display">Here is the whole path.</h1>
      {known.length > 0 && (
        <p className="lede">
          From your answers, you already have{" "}
          <span className="known-row">
            {known.map((c) => c.label).join(", ")}
          </span>{" "}
          — that goes straight into your graph.
        </p>
      )}
      <div style={{ marginTop: 26 }}>
        <span className="kicker sc">{path.length} concepts, in order</span>
        <ol className="pathlist">
          {path.map((c, i) => (
            <li key={c.id} className={removing === c.id ? "removing" : ""}>
              <span className="n sc">{roman(i + 1)}</span>
              <span>
                <span className="lb">{c.label}</span>
                <span className="sm">{c.summary}</span>
              </span>
              <button
                className="rm"
                title="Remove from path"
                aria-label={`Remove ${c.label} from path`}
                disabled={!!busy}
                onClick={() => drop(c.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ol>
      </div>
      <p className="entry-note">
        Take something off the path if you already have it. Meno records the
        change and will not put it back.
      </p>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 26 }}>
        <button
          className="act primary sc"
          disabled={!!busy}
          onClick={() => call("advance", "/api/session/advance")}
        >
          {busy === "advance"
            ? "Preparing the first lesson…"
            : "Begin the first concept"}
        </button>
      </div>
    </div>
  );
}

/* ============================ learning ============================ */

function Learning({
  state,
  active,
  path,
  folio,
  busy,
  call,
  animateAfter,
  resumeNote,
  onDismissResume,
}: {
  state: State;
  active: SessionConcept;
  path: SessionConcept[];
  folio: number;
  busy: string | null;
  call: (label: string, url: string, body?: unknown) => Promise<void>;
  animateAfter: number;
  resumeNote: boolean;
  onDismissResume: () => void;
}) {
  const [input, setInput] = useState("");
  const lesson = state.lessons.find((l) => l.conceptId === active.id);
  const pendingCheck = state.checks.find(
    (c) =>
      c.phase === "mastery" &&
      c.conceptIds.includes(active.id) &&
      c.verdict === null,
  );

  const byId = new Map(state.concepts.map((c) => [c.id, c]));
  const reqs = active.requires
    .map((r) => byId.get(r)?.label)
    .filter(Boolean) as string[];

  // What just happened before this folio: the previous Path Concept's
  // unlock (or skip) renders as a quiet event marker above the lesson.
  const prev = folio >= 2 ? path[folio - 2] : null;
  const before =
    prev && prev.status === "unlocked" ? (
      <EventLine
        text={
          prev.skipped
            ? `${prev.label} marked known · skipped`
            : `${prev.label} unlocked`
        }
        kind="mark"
      />
    ) : undefined;

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    if (pendingCheck) {
      await call("answer", "/api/session/check/answer", { answer: text });
    } else {
      await call("chat", "/api/session/lesson", { message: text });
    }
    requestAnimationFrame(() =>
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }),
    );
  }

  if (!lesson) return null;

  return (
    <>
      <div className="flow">
        {resumeNote && (
          <div className="notice fade-in">
            <span>
              Picked up where you left off — folio {roman(folio)}. Nothing was
              lost.
            </span>
            <span className="sp" />
            <button className="act sc" onClick={onDismissResume}>
              Dismiss
            </button>
          </div>
        )}
        <span className="kicker sc">
          Concept {roman(folio)}
          {reqs.length > 0 && ` · requires ${reqs.join(" & ")}`}
          {active.origin === "remedial" && " · detour"}
        </span>
        <h2 className="h-concept">{active.label}</h2>
        <LessonFlow
          messages={lesson.messages}
          checks={state.checks}
          animateAfter={animateAfter}
          busy={busy ? (THINKING[busy] ?? null) : null}
          before={before}
        />
      </div>

      <div className={`composer${pendingCheck ? " check" : ""}`}>
        <div className="field">
          <textarea
            rows={1}
            value={input}
            placeholder={
              pendingCheck
                ? "Your answer to the check…"
                : `Ask anything about ${active.label.toLowerCase()}…`
            }
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="acts">
            <button
              className={`act sc ${pendingCheck ? "rubric-act" : "primary"}`}
              disabled={!!busy || !input.trim()}
              onClick={send}
            >
              {pendingCheck ? "Answer" : "Send"}
            </button>
          </div>
        </div>
        {/* The guidance line is the control: these two act on the Concept,
            not on what you typed, so they sit outside the field. */}
        <div className="hint">
          <span>
            {pendingCheck ? (
              "Answer in your own words — you can attempt this as many times as you like."
            ) : (
              <>
                Too easy?{" "}
                <button
                  className="hint-act"
                  disabled={!!busy}
                  title="Skip the teaching, not the verification: ask for the mastery check whenever you feel ready — pass it and the concept unlocks. You can attempt it as many times as you like."
                  onClick={() => call("check", "/api/session/check")}
                >
                  Test me
                </button>{" "}
                · Too hard?{" "}
                <button
                  className="hint-act"
                  disabled={!!busy}
                  title="Meno finds the prerequisite you are missing and teaches that first, as a short detour before this concept. The concept itself stays as it is."
                  onClick={() => call("breakdown", "/api/session/breakdown")}
                >
                  Break it down
                </button>
              </>
            )}
          </span>
          <span>
            <kbd>↵</kbd> send · <kbd>⇧↵</kbd> new line
          </span>
        </div>
      </div>
    </>
  );
}

/* ============================ complete ============================ */

function Complete({ state }: { state: State }) {
  const unlocked = state.concepts
    .filter((c) => c.status === "unlocked")
    .sort(
      (a, b) =>
        (a.order === null ? -1 : a.order) - (b.order === null ? -1 : b.order),
    );
  return (
    <div className="flow fade-in">
      <span className="kicker sc">{state.session!.topic} · complete</span>
      <h1 className="h-display">That is the path.</h1>
      <div className="recap" style={{ marginTop: 22 }}>
        <Markdown text={state.session!.recap!} />
      </div>
      <span className="kicker sc">What you unlocked</span>
      <ol className="tally">
        {unlocked.map((c) => (
          <li key={c.id}>
            <span className="mk"></span>
            <span>{c.label}</span>
            <span className="how">
              {c.skipped
                ? c.order === null
                  ? "known before we started"
                  : "skipped — you had it already"
                : c.origin === "remedial"
                  ? "detour, taught and checked"
                  : "taught and checked"}
            </span>
          </li>
        ))}
      </ol>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 20, marginTop: 26 }}>
        <Link href="/new" className="act sc">
          Start another session
        </Link>
        <Link href="/graph" className="act primary sc">
          See your graph
        </Link>
      </div>
    </div>
  );
}
