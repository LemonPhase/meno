"use client";

// The title page. Meno's apparatus, turned outward: the same three inks,
// the same hairlines and roman numerals the app uses, arranged as the
// front matter of a book rather than as a pitch. The plate is a real
// graph in miniature — laurel for learned, rubric for where you are —
// because the graph is the thing being offered.

import GoogleButton from "@/components/auth/GoogleButton";
import type { Viewer } from "@/lib/types";

type Node = {
  label: string;
  x: number;
  y: number;
  state?: "active" | "locked";
  sub?: string;
};

// Hand-placed rather than run through dag-layout: this is an illustration
// of a Path, not a rendering of one, and it should never move.
const NODES: Record<string, Node> = {
  vectors: { label: "Vectors", x: 88, y: 52 },
  probability: { label: "Probability", x: 258, y: 52, sub: "already known" },
  dot: { label: "Dot product", x: 88, y: 140 },
  softmax: { label: "Softmax", x: 258, y: 140 },
  attention: { label: "Attention", x: 173, y: 226, state: "active" },
  transformers: { label: "Transformers", x: 173, y: 300, state: "locked" },
};

const EDGES: [string, string][] = [
  ["vectors", "dot"],
  ["probability", "softmax"],
  ["dot", "attention"],
  ["softmax", "attention"],
  ["attention", "transformers"],
];

/** The same curve GraphView draws, so the plate and the real graph agree. */
function edgePath(from: Node, to: Node): string {
  const y1 = from.y + 8;
  const y2 = to.y - 24;
  const bend = Math.max((y2 - y1) / 2, 16);
  return `M ${from.x} ${y1} C ${from.x} ${y1 + bend}, ${to.x} ${y2 - bend}, ${to.x} ${y2}`;
}

function Plate() {
  return (
    <figure className="plate">
      <div className="graphwrap">
        <svg
          viewBox="0 0 346 330"
          role="img"
          aria-label="A knowledge graph in miniature: vectors and probability
            lead to the dot product and softmax, which lead to attention,
            which leads on to transformers."
        >
          {EDGES.map(([from, to]) => (
            <path
              key={`${from}-${to}`}
              className="gedge"
              d={edgePath(NODES[from], NODES[to])}
            />
          ))}
          {Object.entries(NODES).map(([key, node]) => (
            <g
              key={key}
              className={`gnode${node.state ? ` ${node.state}` : ""}`}
              transform={`translate(${node.x} ${node.y})`}
            >
              <circle className="dot" cx={0} cy={-19} r={3.5} />
              <text className="lbl" y={0} textAnchor="middle">
                {node.label}
              </text>
              {node.sub && (
                <text className="sub" y={15} textAnchor="middle">
                  {node.sub}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
      <figcaption>
        One graph, after an afternoon on attention. Laurel is learned; the
        rubric mark is where you are; what you already knew is attached
        rather than taught again.
      </figcaption>
    </figure>
  );
}

const MOVEMENTS = [
  {
    n: "i",
    title: "Investigate",
    body: "Meno researches your topic and pulls out the atomic concepts underneath it, prerequisites first.",
  },
  {
    n: "ii",
    title: "Diagnose",
    body: "It asks you about those prerequisites, to find where your understanding actually stops.",
  },
  {
    n: "iii",
    title: "Preview the path",
    body: "It plans the route from there to the topic, and shows you the whole of it before setting out.",
  },
  {
    n: "iv",
    title: "Unlock",
    body: "Each concept is taught, then tested. Passing adds it to your graph — for good, and for every later session.",
  },
];

export default function Landing({
  onSignedIn,
}: {
  onSignedIn: (viewer: Viewer) => void;
}) {
  return (
    <div className="landing fade-in">
      <div className="landing-in">
        <section className="title-spread">
          <div className="masthead">
            <span className="kicker sc">A learning apparatus</span>
            <h1 className="brand-display">Meno</h1>
            <p className="lede">
              Give it a topic. Meno finds what the topic rests on, asks what
              you already know, and teaches the rest one concept at a time —
              building a graph of your understanding as it goes.
            </p>

            <blockquote className="epigraph">
              <p>
                A man cannot search either for what he knows or for what he
                does not know. He cannot search for what he knows — since he
                knows it, there is no need to search — nor for what he does
                not know, for he does not know what to look for.
              </p>
              <span className="attr sc">Plato · Meno, 80e</span>
            </blockquote>

            <div className="cta">
              <GoogleButton onSignedIn={onSignedIn} />
              <p className="fine">
                One account, one graph. Signing in for the first time starts
                yours; everything you unlock stays in it.
              </p>
            </div>
          </div>

          <Plate />
        </section>

        <section className="method">
          <span className="kicker sc">The method</span>
          <ol className="movements">
            {MOVEMENTS.map((m) => (
              <li key={m.n}>
                <span className="n sc">{m.n}</span>
                <h2>{m.title}</h2>
                <p>{m.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="closing">
          <p>
            Sessions behave like conversations: several can be open at once,
            each resumable where you left off, and they all feed the one
            graph. A topic resting on something you have already learned
            attaches to the concept you have, rather than teaching it twice.
          </p>
          <p className="colophon">
            Named for Plato&rsquo;s dialogue on the paradox of inquiry — how
            you search for knowledge you do not yet have.
          </p>
        </section>
      </div>
    </div>
  );
}
