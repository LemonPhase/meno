"use client";

// The live Session workspace at "/": one state machine across the five
// phases. The Path gets its center-stage approval moment in Previewing,
// then settles into the right rail once Learning begins.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import LessonFlow from "@/components/session/LessonFlow";
import Markdown from "@/components/session/Markdown";
import PathRail from "@/components/session/PathRail";
import TopicEntry from "@/components/session/TopicEntry";
import { passedCheck, revealedCheck } from "@/lib/checks";
import type {
  Check,
  Lesson,
  LessonMessage,
  Session,
  SessionConcept,
} from "@/lib/types";
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
  chat: "The tutor is thinking",
  answer: "Reading your answer",
  check: "Writing a check",
  advance: "Preparing the first lesson",
  next: "Preparing what comes next",
  breakdown: "Finding what is missing",
};

function pathOf(concepts: SessionConcept[]): SessionConcept[] {
  return concepts
    .filter((c) => c.order !== null || c.status === "active")
    .sort((a, b) => (a.order ?? -1) - (b.order ?? -1));
}

/**
 * The Concepts this Session has already taught, in Path order — what
 * "Previous concept" can go back to. A skipped Concept was never taught, so
 * it has no Lesson and is not a place to stand.
 */
function taughtBefore(
  path: SessionConcept[],
  folio: number,
  lessons: Lesson[],
): SessionConcept[] {
  return path
    .slice(0, Math.max(folio - 1, 0))
    .filter(
      (c) =>
        (lessons.find((l) => l.conceptId === c.id)?.messages.length ?? 0) > 0,
    );
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

  // Which earlier Lesson is being re-read, and the Concept that was Active
  // when the learner stepped back to it. Kept here rather than inside the
  // Lesson: re-reading changes the composer's height, and the rail's
  // floating toggle — a sibling of the whole workspace — has to clear it.
  const [review, setReview] = useState<{
    from: string;
    conceptId: string;
  } | null>(null);

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

  /** Take the server's word for where this Session is. */
  async function refetch(): Promise<void> {
    try {
      const res = await fetch(sessionUrl(target));
      if (res.ok) setState(await res.json());
    } catch {
      // Leave what we have; the next focus tries again.
    }
  }

  /** Reports whether the request landed — a failed one must not be taken
   *  for a sent message and clear what the reader typed. */
  async function call(
    label: string,
    url: string,
    body?: unknown,
    method = "POST",
  ): Promise<boolean> {
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
        // An error body isn't always JSON (a crashed route returns HTML), and
        // "500 Internal Server Error" tells a reader nothing about what to do
        // — so a failure with nothing to say says the one thing that matters:
        // their work is where they left it.
        const detail = await res.json().catch(() => null);
        const fallback =
          res.status >= 500
            ? "Something went wrong at our end. Nothing was lost — try that again."
            : `${res.status} ${res.statusText}`;
        // Every 409 here means the same thing: this client is behind. Another
        // tab moved the Session on, answered the Check, or passed the Concept
        // whose lever we just pulled. Take the correction, so the control
        // that failed goes away instead of failing again on the next press.
        if (res.status === 409) await refetch();
        throw new Error(detail?.error ?? fallback);
      }
      setState(await res.json());
      announceSessionsChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "something went wrong");
      return false;
    } finally {
      setBusy(null);
    }
  }

  /**
   * Show a message the moment it is sent, before the server has seen it.
   * The response replaces the whole state a beat later and this one gives
   * way to the stored article of the same text; until then the reader is
   * looking at what they wrote, which is the only honest thing to show
   * them. Returns the undo for a request that never lands.
   */
  function echo(conceptId: string, message: LessonMessage): () => void {
    const put = (messages: (m: LessonMessage[]) => LessonMessage[]) =>
      setState((s) => ({
        ...s,
        lessons: s.lessons.map((l) =>
          l.conceptId === conceptId ? { ...l, messages: messages(l.messages) } : l,
        ),
      }));
    put((messages) => [...messages, message]);
    // By identity, not by text: an earlier attempt at the same Check could
    // have said exactly the same thing.
    return () => put((messages) => messages.filter((m) => m !== message));
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
  const behind = taughtBefore(path, folio, state.lessons);
  // A review is only the one the learner opened from where the Session
  // actually stands: moving on drops it rather than leaving them reading a
  // page of a Session that has gone somewhere else.
  const reviewing =
    review && active && review.from === active.id
      ? (behind.find((c) => c.id === review.conceptId) ?? null)
      : null;

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
              behind={behind}
              reviewing={reviewing}
              echo={echo}
              onReview={(conceptId) =>
                setReview(conceptId ? { from: active.id, conceptId } : null)
              }
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
            lessons={state.lessons}
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

      <Toast
        error={error}
        aboveComposer={session.phase === "learning"}
        onDismiss={() => setError(null)}
      />
    </>
  );
}

function Toast({
  error,
  aboveComposer = false,
  onDismiss,
}: {
  error: string | null;
  /** Sit above the composer rather than over its levers. */
  aboveComposer?: boolean;
  onDismiss: () => void;
}) {
  if (!error) return null;
  return (
    <div
      className={`toast err on${aboveComposer ? " above-composer" : ""}`}
      role="alert"
    >
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
  call: (label: string, url: string, body?: unknown) => Promise<boolean>;
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
  ) => Promise<boolean>;
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
          You already have{" "}
          <span className="known-row">
            {known.map((c) => c.label).join(", ")}
          </span>{" "}
          — they stay in your graph, and off this path.
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
  behind,
  reviewing,
  onReview,
  echo,
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
  /** The Concepts already taught here, in Path order — see taughtBefore. */
  behind: SessionConcept[];
  /** The earlier Concept being re-read, or null for the live Lesson. */
  reviewing: SessionConcept | null;
  /** Open an earlier Concept's Lesson, or null to come back. */
  onReview: (conceptId: string | null) => void;
  /** Show a sent message at once; returns the undo if it never lands. */
  echo: (conceptId: string, message: LessonMessage) => () => void;
  busy: string | null;
  call: (label: string, url: string, body?: unknown) => Promise<boolean>;
  animateAfter: number;
  resumeNote: boolean;
  onDismissResume: () => void;
}) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lesson = state.lessons.find((l) => l.conceptId === active.id);
  // Only a *revealed* Check — one already shown as a check-question message
  // — puts the composer in answer mode. A Check may also sit primed and
  // unrevealed (written with the exposition so "Test me" is instant); that
  // one is not yet anything the learner has been asked.
  const pendingCheck = lesson
    ? revealedCheck(state.checks, lesson.messages, active.id)
    : undefined;
  // Passing offers the way out; it does not take it. From here the learner
  // can go on asking as long as they like, and the offer stays up.
  const passed = passedCheck(state.checks, active.id);
  const onward = path.some((c) => c.status === "locked")
    ? "Next concept"
    : "Finish the path";

  // Going back is a move of the eye, not of the Session: an earlier Lesson
  // is re-read exactly as it was written; nothing re-activates or re-locks,
  // and the Graph is left standing. So there is no request to make — the
  // state is the workspace's, which drops it the moment the Session moves,
  // whether that is the way on or a detour taking the learner under the
  // Concept they were on.
  const lessonFor = (id: string) =>
    state.lessons.find((l) => l.conceptId === id);
  const reviewIdx = reviewing
    ? behind.findIndex((c) => c.id === reviewing.id)
    : -1;

  // Stepping either way arrives at the top of the concept, as arriving does,
  // and puts focus on its heading — the view swapped underneath whatever
  // button was pressed. Only on a real step, though: the workspace already
  // lands the page on arrival, and nothing should take focus from a reader
  // who has just opened it. Comparing against the last id seen, rather than
  // counting runs, is what keeps that true under StrictMode's double mount.
  const seen = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const id = reviewing?.id ?? null;
    if (seen.current !== undefined && seen.current !== id) {
      window.scrollTo({ top: 0 });
      headingRef.current?.focus();
    }
    seen.current = id;
  }, [reviewing?.id]);

  const byId = new Map(state.concepts.map((c) => [c.id, c]));
  const reqs = active.requires
    .map((r) => byId.get(r)?.label)
    .filter(Boolean) as string[];

  // The rail's floating toggle and the error toast both have to clear the
  // composer, and its height is not a constant: the guidance line wraps
  // differently per state, the lever labels take two lines when narrow, and
  // while re-reading there is no field at all. So it is measured and
  // published, and the CSS reads it — a hand-tuned offset was wrong in
  // exactly the states nobody had a screenshot of.
  const measureComposer = useCallback((el: HTMLDivElement | null) => {
    const root = document.documentElement;
    if (!el) {
      root.style.removeProperty("--composer-h");
      return;
    }
    const publish = () =>
      root.style.setProperty("--composer-h", `${el.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--composer-h");
    };
  }, []);

  // The field auto-grows imperatively, so its height lives in the DOM and
  // not in React — and re-reading unmounts it. Sizing it on mount is what
  // brings a part-written question back the height it had.
  const sizeField = useCallback((el: HTMLTextAreaElement | null) => {
    inputRef.current = el;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, []);

  function toBottom() {
    requestAnimationFrame(() =>
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }),
    );
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const answering = pendingCheck;

    // The message goes up and the field empties at once — the reader has
    // sent it, and a page that still shows it sitting in the composer for
    // however long the model takes reads as one that has not noticed.
    setInput("");
    // The composer auto-grows imperatively; shrink it back to one line.
    if (inputRef.current) inputRef.current.style.height = "auto";
    const undo = echo(active.id, {
      kind: answering ? "check-answer" : "user",
      text,
      ...(answering ? { checkId: answering.id } : {}),
      createdAt: Date.now(),
    });
    toBottom();

    const sent = answering
      ? await call("answer", "/api/session/check/answer", { answer: text })
      : await call("chat", "/api/session/lesson", { message: text });

    // It was never sent, so it must not stand as though it were: the
    // message comes back off the page and the text back into the field —
    // an answer to a Check is something the reader worked at. Unless they
    // have started writing something else in the meantime, which is theirs.
    if (!sent) {
      undo();
      setInput((current) => {
        if (current !== "") return current;
        requestAnimationFrame(() => {
          const field = inputRef.current;
          if (!field) return;
          field.style.height = "auto";
          field.style.height = `${Math.min(field.scrollHeight, 180)}px`;
        });
        return text;
      });
      return;
    }
    toBottom();
  }

  if (!lesson) return null;

  if (reviewing) {
    const earlier = lessonFor(reviewing.id)!;
    const reviewFolio = path.findIndex((c) => c.id === reviewing.id) + 1;
    return (
      <>
        <div className="flow">
          <div className="concept-head">
            <span className="kicker sc">
              Concept {roman(reviewFolio)} · unlocked
              {reviewing.origin === "remedial" && " · detour"} · re-reading
            </span>
            <h2 className="h-concept" ref={headingRef} tabIndex={-1}>
              {reviewing.label}
            </h2>
            <p className="concept-summary">{reviewing.summary}</p>
          </div>
          <div className="notice fade-in">
            <span>
              This one is already yours; you are only re-reading it. The
              session is still standing on {active.label}, and stays there.
            </span>
          </div>
          <LessonFlow
            messages={earlier.messages}
            checks={state.checks}
            /* Nothing here is new, however recently it was written. */
            animateAfter={Number.POSITIVE_INFINITY}
            busy={null}
          />
        </div>

        {/* The same three slots as the lesson's, so the way forward stays
            the rightmost button: from here, forward is back to work. */}
        <div className="composer reading" ref={measureComposer}>
          <div className="levers">
            <button
              className="lever back sc sc-11"
              disabled={reviewIdx <= 0}
              // A title on a disabled button never shows, so it says nothing
              // there: what it would explain — that this is the first thing
              // the session taught — is what being greyed out already means.
              title={
                reviewIdx > 0
                  ? `Re-read ${behind[reviewIdx - 1].label}.`
                  : undefined
              }
              onClick={() => onReview(behind[reviewIdx - 1].id)}
            >
              ← Earlier concept
            </button>
            <span className="sp" />
            <button
              className="lever back strong sc sc-11"
              title={`Back to ${active.label}, where the session left off.`}
              onClick={() => onReview(null)}
            >
              Back to the lesson →
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flow">
        <div className="concept-head">
          <span className="kicker sc">
            Concept {roman(folio)}
            {reqs.length > 0 && ` · requires ${reqs.join(" & ")}`}
            {active.origin === "remedial" && " · detour"}
          </span>
          <h2 className="h-concept" ref={headingRef} tabIndex={-1}>
            {active.label}
          </h2>
          <p className="concept-summary">{active.summary}</p>
        </div>
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
        <LessonFlow
          messages={lesson.messages}
          checks={state.checks}
          animateAfter={animateAfter}
          busy={busy ? (THINKING[busy] ?? null) : null}
        />
      </div>

      <div
        className={`composer${pendingCheck ? " check" : ""}`}
        ref={measureComposer}
      >
        <div className="field">
          <textarea
            ref={sizeField}
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
        {/* The three moves, in the order they mean: back to what is done,
            down into what is missing, on to what comes next. They act on the
            Concept rather than on what you typed, so they sit outside the
            field — and they keep their slots when spent, so the way forward
            is always the same button in the same place. */}
        <div className="levers">
          <button
            className="lever back sc sc-11"
            disabled={!!busy || behind.length === 0}
            title={
              behind.length > 0
                ? `Re-read ${behind[behind.length - 1].label}. Nothing moves — you come straight back here.`
                : undefined
            }
            onClick={() => onReview(behind[behind.length - 1].id)}
          >
            ← Previous concept
          </button>
          <span className="sp" />
          {/* Both levers are spent once the Check is passed: there is nothing
              left to be tested on, and a Concept the learner has just
              demonstrated is not one to insert a prerequisite before. */}
          {/* Offered right up to the pass, a Check on screen included: being
              asked the question is often exactly when the learner finds out
              they are missing something underneath. The route allows it
              (breakdown/route.ts refuses only a passed Concept). */}
          <button
            className="lever sc sc-11"
            disabled={!!busy || !!passed}
            title="Too hard? The tutor finds the prerequisite you are missing and teaches that first, as a short detour before this concept. The concept itself stays as it is."
            onClick={() => call("breakdown", "/api/session/breakdown")}
          >
            Break it down
          </button>
          {passed ? (
            <button
              className="lever on passed sc sc-11"
              disabled={!!busy}
              title="You have passed this concept's check, so it is yours whenever you leave. Stay and ask as much as you want — this stays here."
              onClick={() => call("next", "/api/session/advance")}
            >
              {onward} →
            </button>
          ) : (
            <button
              className="lever on sc sc-11"
              disabled={!!busy || !!pendingCheck}
              title="Skip the teaching, not the verification: ask for the mastery check whenever you feel ready. Pass it and you can move on whenever you like; there is one question per concept, and you can attempt it as many times as you need."
              onClick={() => call("check", "/api/session/check")}
            >
              Test me →
            </button>
          )}
        </div>
        <div className="hint">
          <span>
            {pendingCheck
              ? "Answer in your own words — you can attempt this as many times as you like."
              : passed
                ? "Passed · this concept is yours whenever you leave. Stay and ask as much as you want."
                : "Too easy? Test me. Too hard? Break it down."}
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
