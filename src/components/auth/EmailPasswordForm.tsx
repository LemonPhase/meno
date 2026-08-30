"use client";

import { useState, type FormEvent } from "react";
import { signInWithEmailPassword } from "@/lib/firebase-client";
import { signInError } from "@/lib/sign-in-errors";
import type { Viewer } from "@/lib/types";

/**
 * The quieter door: email and password, no popup. Sign-in only — Firebase
 * has no passwordless account creation here, so the first time is the
 * Google button's job, or an account made in the console.
 */
export default function EmailPasswordForm({
  onSignedIn,
}: {
  onSignedIn: (viewer: Viewer) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await signInWithEmailPassword(email.trim(), password));
    } catch (err) {
      setError(signInError(err));
      setBusy(false);
    }
  }

  return (
    <form className="email-signin" onSubmit={go}>
      <label className="field">
        <span className="sc">Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="you@domain.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Email"
        />
      </label>
      <label className="field">
        <span className="sc">Password</span>
        <input
          type="password"
          required
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-label="Password"
        />
      </label>
      <button className="gbtn" type="submit" disabled={busy}>
        {busy ? "Signing in…" : "Continue with email"}
      </button>
      {error && (
        <p className="signin-err" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
