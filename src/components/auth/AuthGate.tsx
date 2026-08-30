"use client";

// The gate. Everything past it belongs to one signed-in reader, so the
// shell renders only once we know who that is — and the landing page is
// simply what a Meno with no reader looks like, at whatever address they
// arrived at. Signing in swaps it for the app in place: no redirect, no
// reload, and they stay on the page they asked for.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import Landing from "@/components/auth/Landing";
import { fetchViewer, signOut as endSession } from "@/lib/firebase-client";
import type { Viewer } from "@/lib/types";

type Account = { viewer: Viewer; signOut: () => Promise<void> };

const AccountContext = createContext<Account | null>(null);

/** The signed-in reader, for the shell's account row and Settings. */
export function useAccount(): Account | null {
  return useContext(AccountContext);
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let live = true;
    fetchViewer()
      .catch(() => null)
      .then((v) => {
        if (!live) return;
        setViewer(v);
        setSettled(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    await endSession();
    setViewer(null);
  }, []);

  // Reading the cookie is one round trip. Showing the landing page during
  // it would flash a sign-in wall at someone already signed in, so hold
  // the paper blank instead — it is the shorter, quieter wrong state.
  if (!settled) return null;
  if (!viewer) return <Landing onSignedIn={setViewer} />;

  return (
    <AccountContext.Provider value={{ viewer, signOut }}>
      {children}
    </AccountContext.Provider>
  );
}
