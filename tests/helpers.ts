import { promptText, scriptModelResponse } from "@/ai/scripted";
import { SESSION_COOKIE } from "@/lib/auth";
import { POST as postSessionRoute } from "@/app/api/session/route";
import { POST as postDiagnosticRoute } from "@/app/api/session/diagnostic/route";
import { POST as postAdvanceRoute } from "@/app/api/session/advance/route";
import { POST as postCheckRoute } from "@/app/api/session/check/route";
import { POST as postAnswerRoute } from "@/app/api/session/check/answer/route";
import { revealedCheck } from "@/lib/checks";
import type { Check, Lesson, Session, SessionConcept } from "@/lib/types";

export type StateBody = {
  session: Session;
  concepts: SessionConcept[];
  checks: Check[];
  lessons: Lesson[];
};

/**
 * The revealed mastery Check awaiting an answer for the Active Concept —
 * distinct from one merely primed (generated ahead, not yet shown; see
 * @/lib/checks). Tests that just need *a* Check pending should get there
 * with `postCheck()`, which is free once something is primed.
 */
export function pendingCheck(s: StateBody): Check | undefined {
  const conceptId = s.session.activeConceptId;
  if (!conceptId) return undefined;
  const lesson = s.lessons.find((l) => l.conceptId === conceptId);
  return lesson
    ? revealedCheck(s.checks, lesson.messages, conceptId)
    : undefined;
}

/**
 * The signed-in reader. MENO_AUTH=scripted (vitest.config.ts) takes the
 * session cookie at face value as the uid, so a test signs in simply by
 * naming one — and a second name is a second Graph, which is how the
 * scoping tests get two users without a Firebase Auth project.
 */
export const USER = "test-reader";
export const OTHER = "test-stranger";

const signedIn = (uid: string) => ({ Cookie: `${SESSION_COOKIE}=${uid}` });

export function jsonRequest(
  url: string,
  body: unknown,
  uid: string = USER,
): Request {
  return new Request(`http://test${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...signedIn(uid) },
    body: JSON.stringify(body),
  });
}

/** A bodiless request carrying `uid`'s session cookie. */
export function authed(
  url: string,
  init: RequestInit & { uid?: string } = {},
): Request {
  const { uid = USER, headers, ...rest } = init;
  return new Request(`http://test${url}`, {
    ...rest,
    headers: { ...headers, ...signedIn(uid) },
  });
}

export const RESEARCH_NOTES =
  "Notes: attention builds on dot products and softmax.";

export const EXTRACTION = JSON.stringify({
  concepts: [
    {
      key: "dot-product",
      label: "Dot product",
      summary: "Multiplying two vectors into a scalar.",
      requires: [],
    },
    {
      key: "softmax",
      label: "Softmax",
      summary: "Turning scores into a probability distribution.",
      requires: ["dot-product"],
    },
    {
      key: "attention",
      label: "Attention",
      summary: "Weighting values by query-key similarity.",
      requires: ["dot-product", "softmax", "not-a-real-key", "attention"],
    },
  ],
});

/**
 * Responder for the diagnostic-questions call: reads the Concept ids out of
 * the prompt (they're session-namespaced, so unknowable beforehand) and
 * asks one question per concept.
 */
export function diagnosticQuestionsResponder(request: {
  messages: Parameters<typeof promptText>[0]["messages"];
}): string {
  const ids = [...promptText(request as never).matchAll(/- id: (\S+) \|/g)].map(
    (m) => m[1],
  );
  return JSON.stringify({
    questions: ids.map((id) => ({
      conceptKeys: [id],
      question: `Explain: ${id}`,
    })),
  });
}

/** Script the three model calls behind POST /api/session and run it. */
export async function startInvestigatedSession(
  topic = "attention mechanisms",
): Promise<StateBody> {
  scriptModelResponse(RESEARCH_NOTES, EXTRACTION, diagnosticQuestionsResponder);
  const res = await postSessionRoute(jsonRequest("/api/session", { topic }));
  if (res.status !== 200) {
    throw new Error(`startInvestigatedSession failed: ${res.status}`);
  }
  return res.json();
}

/** The question text `reachLearning()` primes for the first Concept. */
export const FIRST_CHECK_QUESTION = "Check 1?";

/**
 * Drive a fresh Session all the way into Learning: investigate, grade the
 * diagnostic (nothing known), and advance past the preview. Consumes six
 * scripted responses; the first exposition is "Exposition 1", and a mastery
 * Check (FIRST_CHECK_QUESTION) is primed alongside it — see @/lib/checks —
 * so callers that only need a Check pending can reveal it with a bare
 * `postCheck()`, no further scripting required.
 */
export async function reachLearning(): Promise<StateBody> {
  const started = await startInvestigatedSession();
  scriptModelResponse(JSON.stringify({ knownConceptIds: [] }));
  const diag = await postDiagnosticRoute(
    jsonRequest("/api/session/diagnostic", {
      answers: started.checks.map((c) => ({ checkId: c.id, answer: "hm" })),
    }),
  );
  if (diag.status !== 200) throw new Error(`diagnostic failed: ${diag.status}`);
  scriptModelResponse(
    "Exposition 1",
    JSON.stringify({ question: FIRST_CHECK_QUESTION }),
  );
  const adv = await postAdvanceRoute(authed("/api/session/advance"));
  if (adv.status !== 200) throw new Error(`advance failed: ${adv.status}`);
  return adv.json();
}

/**
 * Extraction for a second Topic that overlaps the first: the responder
 * reads the ids the prompt lists as already in the Graph and attaches
 * "Softmax" to the existing one, adding one genuinely new Concept.
 */
export function attachingExtractionResponder(request: {
  messages: Parameters<typeof promptText>[0]["messages"];
}): string {
  const text = promptText(request as never);
  const softmaxId = text.match(/- id: (\S+) \| Softmax:/)?.[1];
  return JSON.stringify({
    concepts: [
      {
        key: "softmax",
        label: "Softmax",
        summary: "Turning scores into a probability distribution.",
        requires: [],
        ...(softmaxId ? { attachTo: softmaxId } : {}),
      },
      {
        key: "cross-entropy",
        label: "Cross entropy",
        summary: "Scoring a predicted distribution against the truth.",
        requires: ["softmax"],
      },
    ],
  });
}

/** Start a second Session whose investigation attaches to the Graph. */
export async function startOverlappingSession(
  topic = "cross entropy loss",
): Promise<StateBody> {
  scriptModelResponse(
    RESEARCH_NOTES,
    attachingExtractionResponder,
    diagnosticQuestionsResponder,
  );
  const res = await postSessionRoute(jsonRequest("/api/session", { topic }));
  if (res.status !== 200) {
    throw new Error(`startOverlappingSession failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Pass the Active Concept's mastery Check and then make the move a pass only
 * *offers* — two requests, because leaving is the learner's to choose. `next`
 * is what the Session generates on the way out: the following Concept's
 * exposition and its one Check, the Recap that closes a finished Path, or
 * `{ resume: true }` for a Concept this Session already taught and was
 * pulled off by a detour — that one is returned to as it was left, so
 * nothing is generated and nothing is scripted.
 */
export async function passAndMoveOn(
  next:
    | { exposition: string; question: string }
    | { recap: string }
    | { resume: true },
  opts: { grade?: Record<string, unknown>; sessionId?: string } = {},
): Promise<StateBody> {
  const { grade = {}, sessionId } = opts;
  const scoped = (path: string) =>
    authed(sessionId ? `${path}?session=${sessionId}` : path, {
      method: "POST",
    });

  // Whatever is Active already has its Check primed, so revealing is free.
  await postCheckRoute(scoped("/api/session/check"));
  scriptModelResponse(
    JSON.stringify({ verdict: "pass", feedback: "Yes.", ...grade }),
  );
  const graded = await postAnswerRoute(
    jsonRequest("/api/session/check/answer", {
      answer: "right",
      ...(sessionId ? { sessionId } : {}),
    }),
  );
  if (graded.status !== 200) throw new Error(`answer failed: ${graded.status}`);

  scriptModelResponse(
    ...("resume" in next
      ? []
      : "recap" in next
        ? [next.recap]
        : [next.exposition, JSON.stringify({ question: next.question })]),
  );
  const moved = await postAdvanceRoute(scoped("/api/session/advance"));
  if (moved.status !== 200) throw new Error(`advance failed: ${moved.status}`);
  return moved.json();
}
