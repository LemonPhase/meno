"use client";

// The gate. Everything past it belongs to one signed-in reader, so the
// shell renders only once we know who that is — and the landing page is
// simply what a Meno with no reader looks like, at whatever address they
// arrived at. Signing in swaps it for the app in place: no redirect, no
// reload, and they stay on the page they asked for.

import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Landing from "@/components/auth/Landing";
import { fetchViewer, signOut as endSession } from "@/lib/firebase-client";
import type { Viewer } from "@/lib/types";

type Account = { viewer: Viewer; signOut: () => Promise<void> };

const AccountContext = createContext<Account | null>(null);

/** The signed-in reader, for the shell's account row and Settings. */
export function useAccount(): Account | null {
  return useContext(AccountContext);
}

/**
 * How stale an answer may be before returning to the tab is worth another
 * round trip. Long enough that clicking between windows costs nothing;
 * short enough that a session which ended while you were away is noticed
 * when you come back, rather than on your next failed action.
 */
const STALE_AFTER_MS = 30_000;

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [settled, setSettled] = useState(false);
  const checkedAt = useRef(0);
  const asking = useRef(false);

  useEffect(() => {
    let live = true;
    fetchViewer()
      .catch((error) => {
        // The landing page is the only honest first render — we don't know
        // who is reading — but the reason belongs in the console.
        console.error("[auth] could not read the session:", error);
        return null;
      })
      .then((v) => {
        if (!live) return;
        checkedAt.current = Date.now();
        setViewer(v);
        setSettled(true);
      });
    return () => {
      live = false;
    };
  }, []);

  // A cookie can expire, or be revoked from another tab, while this one
  // sits open — and nothing here would notice: every panel would quietly
  // render empty, which reads as lost work rather than as a lapsed session.
  // Coming back to the tab is the natural moment to ask again.
  useEffect(() => {
    function recheck() {
      if (document.visibilityState !== "visible") return;
      if (asking.current) return;
      if (Date.now() - checkedAt.current < STALE_AFTER_MS) return;
      asking.current = true;
      fetchViewer()
        .then((next) => {
          checkedAt.current = Date.now();
          // Keep the object when the reader hasn't changed, so a routine
          // recheck doesn't re-render every consumer for nothing.
          setViewer((current) =>
            current?.uid === next?.uid ? current : next,
          );
        })
        .catch((error) => {
          // A server fault is not an answer about who is reading. Signing
          // someone out over a hiccup would lose their place for no reason.
          console.error("[auth] could not revalidate the session:", error);
        })
        .finally(() => {
          asking.current = false;
        });
    }
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, []);

  // Signing in is itself a fresh, authoritative answer about who is
  // reading, so it restarts the staleness clock rather than leaving the
  // next focus to re-ask something we just learned.
  const onSignedIn = useCallback((next: Viewer) => {
    checkedAt.current = Date.now();
    setViewer(next);
  }, []);

  const signOut = useCallback(async () => {
    await endSession();
    setViewer(null);
  }, []);

  const account = useMemo(
    () => (viewer ? { viewer, signOut } : null),
    [viewer, signOut],
  );

  // Reading the cookie is one round trip. Showing the landing page during
  // it would flash a sign-in wall at someone already signed in, so hold
  // the paper blank instead — it is the shorter, quieter wrong state.
  if (!settled) return null;
  if (!viewer || !account) return <Landing onSignedIn={onSignedIn} />;

  // Keyed on the reader: if a recheck finds a *different* account signed in
  // — switched in another tab — the subtree remounts and refetches, rather
  // than showing one person's name over another's Sessions.
  return (
    <AccountContext.Provider value={account}>
      <Fragment key={viewer.uid}>{children}</Fragment>
    </AccountContext.Provider>
  );
}
