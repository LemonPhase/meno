import SessionWorkspace from "@/components/session/SessionWorkspace";

// The landing view is the most recently touched Session (Q3 of the design
// session), falling back to topic entry when the Graph has none.
export default function Home() {
  return <SessionWorkspace />;
}
