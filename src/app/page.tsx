"use client";

import { useEffect, useState } from "react";
import GraphView from "@/components/GraphView";
import type { Check, Concept, Lesson, Session } from "@/lib/types";

type State = {
  session: Session | null;
  concepts: Concept[];
  checks: Check[];
  lessons: Lesson[];
};

const EMPTY: State = { session: null, concepts: [], checks: [], lessons: [] };

export default function Home() {
  const [state, setState] = useState<State>(EMPTY);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/session")
      .then((r) => r.json())
      .then(setState)
      .catch(() => {});
  }, []);

  // While Learning, poll for agent-driven changes (remedial splices, status
  // flips) so the graph stays live without user action. Paused whenever a
  // call is busy, and an in-flight poll is discarded if one starts, so
  // polling never clobbers a user action's fresher state.
  const phase = state.session?.phase;
  useEffect(() => {
    if (phase !== "learning" || busy) return;
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/session");
        if (!res.ok) return;
        const next = await res.json();
        if (!cancelled) setState(next);
      } catch {
        // Ignore transient polling failures.
      }
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [phase, busy]);

  async function call(
    label: string,
    url: string,
    body?: unknown,
  ): Promise<void> {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      setState(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "something went wrong");
    } finally {
      setBusy(null);
    }
  }

  const { session } = state;

  return (
    <div className="flex flex-1 flex-col items-center gap-8 bg-zinc-50 px-6 py-16 dark:bg-black">
      <header className="text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Meno
        </h1>
        <p className="mt-2 text-lg text-zinc-600 dark:text-zinc-400">
          Tell it what you want to understand.
        </p>
      </header>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {(!session || busy === "investigate") && (
        <TopicForm
          investigating={busy === "investigate"}
          onStart={(topic) => call("investigate", "/api/session", { topic })}
        />
      )}

      {session && busy !== "investigate" && (
        <section className="w-full max-w-xl">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
              {session.topic}
            </h2>
            <span className="rounded-full bg-zinc-200 px-3 py-1 text-sm capitalize text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {session.phase}
            </span>
          </div>

          {session.phase === "diagnosing" && (
            <Diagnostic
              checks={state.checks}
              submitting={busy === "diagnose"}
              onSubmit={(answers) =>
                call("diagnose", "/api/session/diagnostic", { answers })
              }
            />
          )}

          {session.phase === "previewing" && (
            <div className="flex flex-col gap-4">
              <PathPreview state={state} />
              <button
                onClick={() => call("advance", "/api/session/advance")}
                disabled={busy === "advance"}
                className="self-end rounded-lg bg-zinc-900 px-5 py-2 font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {busy === "advance" ? "Preparing your first lesson…" : "Begin"}
              </button>
            </div>
          )}

          {session.phase === "learning" && (
            <Learning state={state} busy={busy} call={call} />
          )}

          {session.phase === "complete" && <Complete state={state} />}

          {(session.phase === "learning" || session.phase === "complete") && (
            <div className="mt-8">
              <h3 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
                Concept graph
              </h3>
              <GraphView concepts={state.concepts} lessons={state.lessons} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Learning({
  state,
  busy,
  call,
}: {
  state: State;
  busy: string | null;
  call: (label: string, url: string, body?: unknown) => Promise<void>;
}) {
  const [input, setInput] = useState("");
  const { session, concepts, checks, lessons } = state;
  const active = concepts.find((c) => c.id === session!.activeConceptId);
  const lesson = lessons.find((l) => l.conceptId === active?.id);
  const pendingCheck = checks.find(
    (c) =>
      c.phase === "mastery" &&
      active !== undefined &&
      c.conceptIds.includes(active.id) &&
      c.verdict === null,
  );
  const path = concepts
    .filter((c) => c.order !== null || c.status === "active")
    .sort((a, b) => (a.order ?? -1) - (b.order ?? -1));

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    if (pendingCheck) {
      await call("answer", "/api/session/check/answer", { answer: text });
    } else {
      await call("chat", "/api/session/lesson", { message: text });
    }
  }

  if (!active || !lesson) return null;

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-wrap gap-2">
        {path.map((c) => (
          <li
            key={c.id}
            className={`rounded-full px-3 py-1 text-sm ${
              c.status === "unlocked"
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
                : c.status === "active"
                  ? "bg-blue-100 font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                  : "bg-zinc-200 text-zinc-500 dark:bg-zinc-800"
            }`}
          >
            {c.label}
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
          {active.label}
        </h3>
        {lesson.messages.map((m, i) => (
          <div
            key={i}
            className={`whitespace-pre-wrap rounded-lg p-3 text-sm ${
              m.kind === "user" || m.kind === "check-answer"
                ? "self-end bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : m.kind === "check-question"
                  ? "border border-amber-300 bg-amber-50 text-zinc-900 dark:border-amber-700 dark:bg-amber-950 dark:text-zinc-100"
                  : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
            }`}
          >
            {m.kind === "check-question" && (
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
                Mastery check
              </span>
            )}
            {m.text}
          </div>
        ))}
        {busy && (
          <p className="animate-pulse text-sm text-zinc-500">Thinking…</p>
        )}
      </div>

      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder={
            pendingCheck ? "Your answer to the check…" : "Ask anything…"
          }
          className="flex-1 resize-y rounded-lg border border-zinc-300 bg-white p-3 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <div className="flex flex-col gap-2">
          <button
            onClick={send}
            disabled={!!busy || !input.trim()}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {pendingCheck ? "Answer" : "Send"}
          </button>
          {!pendingCheck && (
            <button
              onClick={() => call("check", "/api/session/check")}
              disabled={!!busy}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
            >
              Test me
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Complete({ state }: { state: State }) {
  const unlocked = state.concepts.filter((c) => c.status === "unlocked");
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950">
        <h3 className="mb-2 font-medium text-emerald-900 dark:text-emerald-100">
          Path complete 🎉
        </h3>
        <p className="whitespace-pre-wrap text-sm text-emerald-900 dark:text-emerald-100">
          {state.session?.recap}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {unlocked.map((c) => (
          <span
            key={c.id}
            className="rounded-full bg-emerald-100 px-3 py-1 text-sm text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
          >
            {c.label}
            {c.skipped ? " (skipped)" : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function TopicForm({
  investigating,
  onStart,
}: {
  investigating: boolean;
  onStart: (topic: string) => void;
}) {
  const [topic, setTopic] = useState("");
  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <textarea
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        placeholder="A topic, a concept, or pasted text (e.g. a paper abstract)…"
        rows={4}
        className="w-full resize-y rounded-lg border border-zinc-300 bg-white p-3 text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />
      <button
        onClick={() => topic.trim() && onStart(topic)}
        disabled={investigating || !topic.trim()}
        className="self-end rounded-lg bg-zinc-900 px-5 py-2 font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {investigating ? "Investigating…" : "Start learning"}
      </button>
      {investigating && (
        <p className="animate-pulse text-zinc-500">
          Investigating your topic and mapping its concepts…
        </p>
      )}
    </div>
  );
}

function Diagnostic({
  checks,
  submitting,
  onSubmit,
}: {
  checks: Check[];
  submitting: boolean;
  onSubmit: (answers: { checkId: string; answer: string }[]) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const diagnostics = checks.filter((c) => c.phase === "diagnostic");

  return (
    <div className="flex flex-col gap-4">
      <p className="text-zinc-600 dark:text-zinc-400">
        First, a few questions to find out where you&apos;re starting from.
        It&apos;s fine to say &quot;no idea&quot;.
      </p>
      {diagnostics.map((check, i) => (
        <div
          key={check.id}
          className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            {i + 1}. {check.question}
          </p>
          <textarea
            value={answers[check.id] ?? ""}
            onChange={(e) =>
              setAnswers((a) => ({ ...a, [check.id]: e.target.value }))
            }
            rows={2}
            placeholder="Your answer…"
            className="mt-2 w-full resize-y rounded border border-zinc-300 bg-zinc-50 p-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          />
        </div>
      ))}
      <button
        onClick={() =>
          onSubmit(
            diagnostics.map((c) => ({
              checkId: c.id,
              answer: answers[c.id] ?? "",
            })),
          )
        }
        disabled={submitting}
        className="self-end rounded-lg bg-zinc-900 px-5 py-2 font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {submitting ? "Grading…" : "Submit answers"}
      </button>
    </div>
  );
}

function PathPreview({ state }: { state: State }) {
  const known = state.concepts.filter((c) => c.status === "unlocked");
  const path = state.concepts
    .filter((c) => c.order !== null)
    .sort((a, b) => a.order! - b.order!);

  return (
    <div className="flex flex-col gap-6">
      {known.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
            You already know
          </h3>
          <div className="flex flex-wrap gap-2">
            {known.map((c) => (
              <span
                key={c.id}
                className="rounded-full bg-emerald-100 px-3 py-1 text-sm text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
              >
                {c.label}
              </span>
            ))}
          </div>
        </div>
      )}
      <div>
        <h3 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Your path
        </h3>
        <ol className="flex flex-col gap-2">
          {path.map((c, i) => (
            <li
              key={c.id}
              className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-sm font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {i + 1}
              </span>
              <div>
                <div className="font-medium text-zinc-900 dark:text-zinc-100">
                  {c.label}
                </div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {c.summary}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
