"use client";

// Topic entry plus the investigating interstitial. Owns the POST that
// starts a Session (investigate + diagnostic in one server call).

import { useEffect, useState } from "react";
import { announceSessionsChanged } from "@/lib/ui";

const CHIPS = [
  "Attention in transformers",
  "Why is the sky blue?",
  "Lagrange multipliers",
];

const STEPS = [
  "Reading around the topic",
  "Pulling out the atomic concepts",
  "Ordering them by prerequisite",
  "Writing your diagnostic",
];

export default function TopicEntry({
  onDone,
  onError,
}: {
  /** Called with the fresh state once the Session reaches Diagnosing. */
  onDone: (state: unknown) => void;
  onError: (message: string) => void;
}) {
  const [topic, setTopic] = useState("");
  const [investigating, setInvestigating] = useState<string | null>(null);

  async function start(t: string) {
    const trimmed = t.trim();
    if (!trimmed || investigating) return;
    setInvestigating(trimmed);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: trimmed }),
      });
      if (!res.ok) {
        // An error body isn't always JSON (a crashed route returns HTML),
        // so fall back to the status rather than throwing over the throw.
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.error ?? `${res.status} ${res.statusText}`);
      }
      announceSessionsChanged();
      onDone(await res.json());
    } catch (e) {
      setInvestigating(null);
      onError(e instanceof Error ? e.message : "something went wrong");
    }
  }

  if (investigating) return <Investigating topic={investigating} />;

  return (
    <div className="work">
      <section className="column">
        <div className="flow entry fade-in">
          <h1 className="h-display">What do you want to understand?</h1>
          <p className="lede">
            A topic, a single concept you are stuck on, or something pasted
            in — an abstract, a paragraph, a definition that did not land.
          </p>
          <div className="field-lg">
            <textarea
              rows={1}
              autoFocus
              value={topic}
              placeholder="e.g. Attention in transformers"
              onChange={(e) => {
                setTopic(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  start(topic);
                }
              }}
            />
            <button
              className="act primary sc"
              onClick={() => start(topic)}
              disabled={!topic.trim()}
            >
              Begin
            </button>
          </div>
          <div className="chips">
            {CHIPS.map((c) => (
              <button key={c} className="chip" onClick={() => start(c)}>
                {c}
              </button>
            ))}
          </div>
          <p className="entry-note">
            Meno reads around your topic, finds where you actually start, and
            shows you the whole path before teaching any of it.
          </p>
        </div>
      </section>
    </div>
  );
}

export function Investigating({ topic }: { topic: string }) {
  // The server does the whole investigation in one call, so the step
  // highlight is pacing, not progress — no fake checkmarks.
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setStep((s) => Math.min(s + 1, STEPS.length - 1)),
      6000,
    );
    return () => clearInterval(id);
  }, []);

  return (
    <div className="work">
      <section className="column">
        <div className="flow fade-in" style={{ paddingTop: "8vh" }}>
          <span className="kicker sc">Investigating</span>
          <h1 className="h-display">{topic}</h1>
          <p className="lede">
            Reading, then working backwards to what it rests on.
          </p>
          <ol className="steps" style={{ marginTop: 24 }}>
            {STEPS.map((s, i) => (
              <li key={s} className={i === step ? "on" : ""}>
                <span className="tick">{i === step ? "·" : ""}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          <div className="thinking" style={{ marginTop: 18 }}>
            <i></i>
            <i></i>
            <i></i>
            <span className="sc">This can take a minute</span>
          </div>
        </div>
      </section>
    </div>
  );
}
