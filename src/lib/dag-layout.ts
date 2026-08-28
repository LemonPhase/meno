// Deterministic layered layout for the `requires` DAG, shared by the Graph
// destination and the session minimap. Each Concept sits on a layer given
// by its `requires` depth; layers flow top-to-bottom.

import type { SessionConcept } from "./types";

export type NodePlacement = {
  concept: SessionConcept;
  x: number;
  y: number;
  width: number;
  label: string;
};

export type LayoutOptions = {
  viewWidth: number;
  marginY: number;
  layerGap: number;
  charWidth: number;
  padX: number;
  maxLabelChars: number;
  /** Extra y offset for odd nodes in crowded layers (0 disables). */
  stagger: number;
  /** Also cap each label to the width its layer slot can hold. */
  fitToSlot?: boolean;
  /** Tighten the layer gap so a deep graph still fits this height. */
  maxHeight?: number;
};

/** Below this a node's label and its sub-label start to collide. */
const MIN_LAYER_GAP = 42;

/**
 * Depth of each Concept in the `requires` DAG: 0 for Concepts with no
 * prerequisites in the set, otherwise 1 + the deepest prerequisite.
 * Memoized DFS with a visiting guard so a malformed cycle cannot hang.
 */
export function computeDepths(concepts: SessionConcept[]): Map<string, number> {
  const byId = new Map(concepts.map((c) => [c.id, c]));
  const depths = new Map<string, number>();
  const visiting = new Set<string>();

  function depthOf(id: string): number {
    const known = depths.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let depth = 0;
    const concept = byId.get(id);
    if (concept) {
      for (const requiredId of concept.requires) {
        if (byId.has(requiredId)) {
          depth = Math.max(depth, depthOf(requiredId) + 1);
        }
      }
    }
    visiting.delete(id);
    depths.set(id, depth);
    return depth;
  }

  for (const concept of concepts) depthOf(concept.id);
  return depths;
}

function truncateLabel(label: string, max: number): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

export function computeLayout(
  concepts: SessionConcept[],
  opts: LayoutOptions,
): { placements: Map<string, NodePlacement>; height: number } {
  const depths = computeDepths(concepts);
  const layers: SessionConcept[][] = [];
  for (const concept of concepts) {
    const depth = depths.get(concept.id) ?? 0;
    (layers[depth] ??= []).push(concept);
  }
  // Deterministic ordering within a layer: Path order first, then the
  // investigation's extraction order, then id as a stable tie-breaker.
  for (const layer of layers) {
    layer?.sort(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) -
          (b.order ?? Number.MAX_SAFE_INTEGER) ||
        a.createdAt - b.createdAt ||
        a.id.localeCompare(b.id),
    );
  }

  // A deep chain would otherwise run far past the panel it sits in.
  const layerCount = Math.max(layers.length, 1);
  const chrome = opts.marginY * 2 + 18;
  const layerGap =
    opts.maxHeight !== undefined && layerCount > 1
      ? Math.max(
          MIN_LAYER_GAP,
          Math.min(
            opts.layerGap,
            (opts.maxHeight - chrome) / (layerCount - 1),
          ),
        )
      : opts.layerGap;

  const placements = new Map<string, NodePlacement>();
  layers.forEach((layer, layerIndex) => {
    // In a crowded layer each node only owns a slice of the width; letting a
    // label run past it collides with its neighbour. Staggering puts
    // neighbours on different baselines, which buys the labels room back.
    const count = layer?.length ?? 1;
    const staggered = opts.stagger > 0 && count >= 3;
    // A layer of one or two owns enough width already; only crowded layers
    // need their labels reined in.
    const slotChars =
      opts.fitToSlot && count >= 3
      ? Math.floor(
          ((opts.viewWidth / (count + 1)) * (staggered ? 1.7 : 1) - 8) /
            opts.charWidth,
        )
      : opts.maxLabelChars;
    layer?.forEach((concept, i) => {
      const label = truncateLabel(
        concept.label,
        Math.max(6, Math.min(opts.maxLabelChars, slotChars)),
      );
      const stagger = staggered && i % 2 === 1 ? opts.stagger : 0;
      placements.set(concept.id, {
        concept,
        label,
        width: Math.max(56, label.length * opts.charWidth + opts.padX * 2),
        x: (opts.viewWidth * (i + 1)) / (layer.length + 1),
        y: opts.marginY + layerIndex * layerGap + stagger,
      });
    });
  });

  return { placements, height: chrome + (layerCount - 1) * layerGap };
}
