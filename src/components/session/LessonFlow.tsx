"use client";

// Renders one Lesson's messages in the reading voice: exposition as prose,
// conversation as attributed speech, Checks as rubric blocks. Newly arrived
// messages fade in word by word; everything older renders settled.

import Markdown from "@/components/session/Markdown";
import type { Check, LessonMessage } from "@/lib/types";

function Msg({
  message,
  animate,
  checkById,
}: {
  message: LessonMessage;
  animate: boolean;
  checkById: Map<string, Check>;
}) {
  const anim = animate ? " fade-in" : "";

  switch (message.kind) {
    case "exposition":
      return (
        <div className={anim.trim()}>
          <Markdown text={message.text} animate={animate} />
        </div>
      );
    // What the user typed is rendered as they typed it, never as markup.
    case "user":
    case "check-answer":
      return (
        <div className={`speech me${anim}`}>
          <span className="who">You</span>
          <div className="txt plain">{message.text}</div>
        </div>
      );
    case "reply":
      return (
        <div className={`speech${anim}`}>
          <span className="who">Tutor</span>
          <div className="txt">
            <Markdown text={message.text} animate={animate} />
          </div>
        </div>
      );
    case "check-question": {
      const settled =
        message.checkId !== undefined &&
        checkById.get(message.checkId)?.verdict !== null;
      return (
        <div className={`rubric${anim}${settled ? " settled" : ""}`}>
          <span className="lbl sc">Check · mastery</span>
          <Markdown text={message.text} animate={animate} />
        </div>
      );
    }
    case "event":
      return <EventLine text={message.text} kind={eventKind(message.text)} animate={animate} />;
    case "check-feedback": {
      const verdict = message.checkId
        ? checkById.get(message.checkId)?.verdict
        : null;
      return (
        <div className={`speech${anim}`}>
          <span className="who">Tutor</span>
          <div className="txt">
            <span className={`verdict ${verdict === "pass" ? "pass" : "again"}`}>
              {verdict === "pass" ? "Check passed" : "Not yet"}
            </span>
            <Markdown text={message.text} animate={animate} />
          </div>
        </div>
      );
    }
    default:
      return null;
  }
}

/** Detours read in the rubric voice; anything unlocked reads as attained. */
function eventKind(text: string): "plain" | "mark" | "detour" {
  if (/detour/i.test(text)) return "detour";
  if (/unlocked|skipped|known/i.test(text)) return "mark";
  return "plain";
}

export function EventLine({
  text,
  kind = "plain",
  animate = false,
}: {
  text: string;
  kind?: "plain" | "mark" | "detour";
  animate?: boolean;
}) {
  return (
    <div
      className={`event sc${kind === "mark" ? " mark" : ""}${kind === "detour" ? " detour" : ""}${animate ? " fade-in" : ""}`}
    >
      <span>{text}</span>
    </div>
  );
}

export default function LessonFlow({
  messages,
  checks,
  animateAfter,
  busy,
  before,
  after,
}: {
  messages: LessonMessage[];
  checks: Check[];
  /** Messages created after this timestamp animate in; older render settled. */
  animateAfter: number;
  /** A label for the thinking indicator, or null. */
  busy: string | null;
  before?: React.ReactNode;
  after?: React.ReactNode;
}) {
  const checkById = new Map(checks.map((c) => [c.id, c]));
  return (
    <div className="prose">
      {before}
      {messages.map((m, i) => (
        <Msg
          key={`${i}-${m.createdAt}`}
          message={m}
          animate={m.createdAt > animateAfter}
          checkById={checkById}
        />
      ))}
      {after}
      {busy && (
        <div className="thinking">
          <i></i>
          <i></i>
          <i></i>
          <span className="sc">{busy}</span>
        </div>
      )}
    </div>
  );
}
