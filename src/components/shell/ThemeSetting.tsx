"use client";

// Reading theme: Paper and Night, or follow the system. A pick stamps
// data-ui on the root and persists in localStorage (a pre-paint script in
// the root layout applies it before hydration, so the root attribute is
// the source of truth here).

import { useSyncExternalStore } from "react";

const KEY = "meno-reading-theme";
const EVENT = "meno:theme";
type Mode = "system" | "light" | "dark";

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  return () => window.removeEventListener(EVENT, callback);
}
function getSnapshot(): Mode {
  const t = document.documentElement.getAttribute("data-ui");
  return t === "light" || t === "dark" ? t : "system";
}
function getServerSnapshot(): Mode {
  return "system";
}

export default function ThemeSetting() {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function apply(next: Mode) {
    const root = document.documentElement;
    try {
      if (next === "system") {
        root.removeAttribute("data-ui");
        localStorage.removeItem(KEY);
      } else {
        root.setAttribute("data-ui", next);
        localStorage.setItem(KEY, next);
      }
    } catch {
      // Private window: the pick just won't persist.
    }
    window.dispatchEvent(new Event(EVENT));
  }

  return (
    <div className="segbox" role="group" aria-label="Reading theme">
      {(
        [
          ["system", "System"],
          ["light", "Paper"],
          ["dark", "Night"],
        ] as [Mode, string][]
      ).map(([value, label]) => (
        <button
          key={value}
          className="seg sc"
          aria-pressed={mode === value}
          onClick={() => apply(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
