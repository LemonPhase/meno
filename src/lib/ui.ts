// Small presentation helpers shared across the client components.

const ROMAN_TOKENS: [number, string][] = [
  [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"],
  [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"],
  [5, "v"], [4, "iv"], [1, "i"],
];

/** Lower-case roman numerals — the folio voice ("iii of vii"). */
export function roman(n: number): string {
  if (!Number.isFinite(n) || n < 1) return "·";
  let rest = Math.floor(n);
  let out = "";
  for (const [value, token] of ROMAN_TOKENS) {
    while (rest >= value) {
      out += token;
      rest -= value;
    }
  }
  return out;
}

/** Quiet relative time for the sidebar and logs. */
export function timeAgo(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const days = Math.floor(s / 86400);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Ask the shell to refresh the sidebar's session list. */
export function announceSessionsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("meno:sessions"));
  }
}

/** A small, per-browser UI preference (a disclosure left open, and such). */
export function readPref(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === "1";
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Private window: the preference just won't persist.
  }
}
