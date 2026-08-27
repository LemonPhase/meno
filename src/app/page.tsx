"use client";

import { useEffect, useState } from "react";
import type { Concept, Session } from "@/lib/types";

type State = { session: Session | null; concepts: Concept[] };

export default function Home() {
  const [state, setState] = useState<State>({ session: null, concepts: [] });
  const [topic, setTopic] = useState("");
  const [investigating, setInvestigating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/session")
      .then((r) => r.json())
      .then(setState)
      .catch(() => {});
  }, []);

  async function start() {
    if (!topic.trim() || investigating) return;
    setInvestigating(true);
    setError(null);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      setState(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "something went wrong");
    } finally {
      setInvestigating(false);
    }
  }

  const { session, concepts } = state;
  const labelFor = (id: string) =>
    concepts.find((c) => c.id === id)?.label ?? id;

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

      <div className="flex w-full max-w-xl flex-col gap-3">
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="A topic, a concept, or pasted text (e.g. a paper abstract)…"
          rows={4}
          className="w-full resize-y rounded-lg border border-zinc-300 bg-white p-3 text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <button
          onClick={start}
          disabled={investigating || !topic.trim()}
          className="self-end rounded-lg bg-zinc-900 px-5 py-2 font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {investigating ? "Investigating…" : "Start learning"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      {investigating && (
        <p className="animate-pulse text-zinc-500">
          Investigating your topic and mapping its concepts…
        </p>
      )}

      {session && !investigating && (
        <section className="w-full max-w-xl">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
              {session.topic}
            </h2>
            <span className="rounded-full bg-zinc-200 px-3 py-1 text-sm capitalize text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {session.phase}
            </span>
          </div>
          <ul className="flex flex-col gap-3">
            {concepts.map((c) => (
              <li
                key={c.id}
                className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="font-medium text-zinc-900 dark:text-zinc-100">
                  {c.label}
                </div>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {c.summary}
                </p>
                {c.requires.length > 0 && (
                  <p className="mt-2 text-xs text-zinc-500">
                    requires: {c.requires.map(labelFor).join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
