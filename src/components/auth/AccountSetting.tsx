"use client";

import { useAccount } from "@/components/auth/AuthGate";

/** The Settings row for the signed-in reader: who, and the way out. */
export default function AccountSetting() {
  const account = useAccount();
  if (!account) return null;
  const { viewer } = account;

  return (
    <>
      <span style={{ fontSize: 16 }}>
        {viewer.email ?? viewer.name ?? viewer.uid}
      </span>
      <p className="d">
        Your Graph belongs to this account — every Session and every unlocked
        Concept.
      </p>
      <div style={{ marginTop: 12 }}>
        <button className="act sc" onClick={account.signOut}>
          Sign out
        </button>
      </div>
    </>
  );
}
