// Hairline marks for the pinned destinations, drawn in the same ink and
// rule as the rest of the sheet: a small prerequisite graph, a rising
// tally, and two settings rules.

const COMMON = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export default function NavIcon({ name }: { name: "graph" | "progress" | "settings" }) {
  if (name === "graph") {
    return (
      <svg {...COMMON}>
        <path d="M4.6 4.4 8 8.4M11.4 4.4 8 8.4M8 8.4v3" />
        <circle cx="4.1" cy="3.6" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="11.9" cy="3.6" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="8" cy="9.1" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="8" cy="13.2" r="1.4" />
      </svg>
    );
  }
  if (name === "progress") {
    return (
      <svg {...COMMON}>
        <path d="M2.2 13.4h11.6" />
        <path d="M4.6 13.4V9.6M8 13.4V6.2M11.4 13.4V3.2" />
      </svg>
    );
  }
  return (
    <svg {...COMMON}>
      <path d="M2.4 5.2h11.2M2.4 10.8h11.2" />
      <circle cx="6" cy="5.2" r="1.7" fill="var(--paper)" />
      <circle cx="10.4" cy="10.8" r="1.7" fill="var(--paper)" />
    </svg>
  );
}
