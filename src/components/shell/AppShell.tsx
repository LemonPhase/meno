"use client";

// The two-zone shell (see the design session): one left sidebar in the
// apparatus voice — Sessions as the body, destinations pinned below —
// with the reading surface to its right. Collapsible on desktop, an
// overlay drawer under 880px.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import NavIcon from "@/components/shell/NavIcon";
import type { SessionSummary } from "@/lib/types";
import { roman, timeAgo } from "@/lib/ui";

const DESTINATIONS = [
  { href: "/graph", label: "Your graph", icon: "graph" },
  { href: "/progress", label: "Progress", icon: "progress" },
  { href: "/settings", label: "Settings", icon: "settings" },
] as const;

function sessionMeta(s: SessionSummary): string {
  if (s.phase === "complete") {
    return `${s.unlockedCount} unlocked · ${timeAgo(s.createdAt)}`;
  }
  if (s.phase === "learning" && s.pathLength > 0) {
    return `folio ${roman(s.pathDone + 1)} of ${roman(s.pathLength)}`;
  }
  const label: Record<string, string> = {
    investigating: "investigating",
    diagnosing: "diagnosing",
    previewing: "path previewed",
    learning: "learning",
  };
  return label[s.phase] ?? s.phase;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [closed, setClosed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const refresh = useCallback(() => {
    fetch("/api/sessions")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setSessions(data.sessions);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener("meno:sessions", refresh);
    return () => window.removeEventListener("meno:sessions", refresh);
  }, [refresh]);

  const inProgress = sessions.filter((s) => s.phase !== "complete");
  const completed = sessions.filter((s) => s.phase === "complete");

  // Every Session has its own address; "/" is whichever one the app opens
  // on — the most recent still in progress, else the most recent of all.
  const landing = (inProgress[0] ?? sessions[0])?.id ?? null;
  const hrefFor = (s: SessionSummary) => `/sessions/${s.id}`;
  const isActive = (s: SessionSummary) =>
    pathname === `/sessions/${s.id}` ||
    (pathname === "/" && s.id === landing);

  const shellClass = `shell${closed ? " closed" : ""}${mobileOpen ? " open-mobile" : ""}`;

  return (
    <div className={shellClass}>
      <button
        className="side-toggle sc"
        onClick={() => {
          setClosed(false);
          setMobileOpen(true);
        }}
        aria-label="Open sidebar"
      >
        ☰ Meno
      </button>
      {mobileOpen && (
        <div className="scrim" onClick={() => setMobileOpen(false)} />
      )}

      <aside
        className="side"
        onClick={(e) => {
          // Following any link closes the mobile drawer.
          if ((e.target as HTMLElement).closest("a")) setMobileOpen(false);
        }}
      >
        <div className="side-top">
          <Link href="/" className="brand">
            <b>Meno</b>
          </Link>
          <span className="sp" />
          <button
            className="collapse-btn"
            onClick={() => {
              setClosed(true);
              setMobileOpen(false);
            }}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            ‹
          </button>
        </div>

        <Link href="/new" className="newlink">
          <span className="plus">+</span>
          <span className="sc sc-11">New session</span>
        </Link>

        {inProgress.length > 0 && (
          <div className="sgroup">
            <span className="mh sc">In progress</span>
            <nav>
              {inProgress.map((s) => (
                <Link
                  key={s.id}
                  href={hrefFor(s)}
                  className={`srow${isActive(s) ? " on" : ""}`}
                >
                  <span className="t">{s.topic}</span>
                  <span className="m">{sessionMeta(s)}</span>
                </Link>
              ))}
            </nav>
          </div>
        )}

        {completed.length > 0 && (
          <div className="sgroup">
            <span className="mh sc">Completed</span>
            <nav>
              {completed.map((s) => (
                <Link
                  key={s.id}
                  href={hrefFor(s)}
                  className={`srow done${isActive(s) ? " on" : ""}`}
                >
                  <span className="t">{s.topic}</span>
                  <span className="m">{sessionMeta(s)}</span>
                </Link>
              ))}
            </nav>
          </div>
        )}

        {loaded && sessions.length === 0 && (
          <p className="side-empty">
            No sessions yet. Everything you learn will be listed here, and
            every concept you unlock stays in your graph.
          </p>
        )}

        <div className="sp-grow" />

        <nav className="snav">
          {DESTINATIONS.map((d) => (
            <Link
              key={d.href}
              href={d.href}
              className={pathname === d.href ? "on" : ""}
            >
              <span className="glyph">
                <NavIcon name={d.icon} />
              </span>
              <span>{d.label}</span>
            </Link>
          ))}
        </nav>
      </aside>

      <main className="stage">{children}</main>
    </div>
  );
}
