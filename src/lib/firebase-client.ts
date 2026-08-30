"use client";

import { getApps, initializeApp } from "firebase/app";
import { GoogleAuthProvider, getAuth, signInWithPopup } from "firebase/auth";
import type { Viewer } from "./types";

/**
 * Sign-in, browser side. Firebase Auth is used for exactly one thing here:
 * getting a Firebase ID token. It is traded for an httpOnly session cookie at
 * /api/auth/session straight away and never held onto — which is why every
 * other fetch in the app is an ordinary same-origin call that knows nothing
 * about auth.
 */

/**
 * Only the two fields Firebase Auth reads. `projectId`, `appId`,
 * `storageBucket` and `messagingSenderId` are not part of the Auth `Config`
 * type at all — they configure Firestore, Storage and Analytics, and the
 * browser talks to none of them (ADR-0005). `authDomain` hosts the OAuth
 * handler the popup lands on, at https://<authDomain>/__/auth/handler.
 *
 * Both are public identifiers rather than credentials — Firebase documents
 * them as safe to expose — but they are inlined at build time, so a build
 * without them ships a page that cannot sign anybody in.
 */
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
};

/**
 * The browser half of MENO_AUTH=scripted: no Firebase project, no popup —
 * the "token" is the uid the server takes at face value. Interface work,
 * and the seeded demoUser Graph (`npm run seed`), without configuring
 * Firebase Auth first. Both halves must be set for it to work.
 */
export const scriptedAuth = process.env.NEXT_PUBLIC_MENO_AUTH === "scripted";
const SCRIPTED_UID = "demoUser";

/** Initialized on first use: scripted mode never needs a Firebase project. */
function auth() {
  return getAuth(getApps()[0] ?? initializeApp(firebaseConfig));
}

/** Popups the user dismissed are a decision, not a failure. */
export function isCancelledSignIn(error: unknown): boolean {
  const code = (error as { code?: string })?.code ?? "";
  return (
    code === "auth/popup-closed-by-user" ||
    code === "auth/cancelled-popup-request" ||
    code === "auth/user-cancelled"
  );
}

async function googleIdToken(): Promise<string> {
  if (scriptedAuth) return SCRIPTED_UID;
  const credential = await signInWithPopup(auth(), new GoogleAuthProvider());
  return credential.user.getIdToken();
}

/**
 * Trade any Firebase ID token for the session cookie. Every provider lands
 * here; the server cannot tell them apart, and does not need to.
 */
async function exchangeForSession(idToken: string): Promise<Viewer> {
  const res = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "sign-in failed");
  return body.viewer as Viewer;
}

/** The Google popup, then the session cookie. Resolves to the Viewer. */
export async function signInWithGoogle(): Promise<Viewer> {
  return exchangeForSession(await googleIdToken());
}

export async function signOut(): Promise<void> {
  // The cookie is what the server trusts, so dropping it is the sign-out.
  // Clearing Firebase's own client state after is tidiness, not security.
  try {
    await fetch("/api/auth/session", { method: "DELETE" });
  } catch {
    // Offline. The cookie outlives this until it expires, but the button
    // still has to do something: end the session locally rather than
    // appear dead and reject into nowhere.
  }
  if (!scriptedAuth) {
    await auth()
      .signOut()
      .catch(() => {});
  }
}

export async function fetchViewer(): Promise<Viewer | null> {
  const res = await fetch("/api/auth/session");
  // Signed out is a 200 with a null viewer, so a failure here is the server
  // faulting, not an answer. Say so rather than reporting "signed out" and
  // sending anyone debugging it to the sign-in they never broke.
  if (!res.ok) {
    throw new Error(`could not read the session (${res.status})`);
  }
  return (await res.json()).viewer as Viewer | null;
}
