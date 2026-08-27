"use client";

import { useEffect, useState } from "react";
import type { Check, Concept, Session } from "@/lib/types";

type State = { session: Session | null; concepts: Concept[]; checks: Check[] };

const EMPTY: State = { session: null, concepts: [], checks: [] };

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

          {session.phase === "previewing" && <PathPreview state={state} />}
        </section>
      )}
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
