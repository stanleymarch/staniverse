import type { GraphEdge, GraphNode } from "../lib/graph";
import { isCausalRelation, isInferredGraphEdge, relationLabel, selectVisualEdges } from "../lib/graph-visuals";

export interface LocalGraphNode extends GraphNode {
  depth: number;
  x: number;
  y: number;
}

export interface LocalGraphEdge extends GraphEdge {
  depth: number;
  dotted: boolean;
  causal: boolean;
  label: string;
  sourceNode?: GraphNode;
  targetNode?: GraphNode;
}

export interface LocalGraphData {
  current?: GraphNode;
  nodes: LocalGraphNode[];
  edges: LocalGraphEdge[];
}

/** Topic and semantic edges are useful context, but are not direct proof. */
export function isDottedLocalEdge(edge: GraphEdge) {
  return isInferredGraphEdge(edge);
}

function positionFor(index: number) {
  // These are labelled cards, not mathematical points. A deterministic field
  // gives each node a real hit target without collisions at narrow widths.
  const columns = [18, 50, 82];
  const row = Math.floor(index / columns.length);
  return { x: columns[index % columns.length], y: 10 + row * 20 };
}

/**
 * Projects the full graph into a small, deterministic neighbourhood. The
 * component can reveal one, two, or three hops without running a renderer.
 */
export function buildLocalGraph(currentId: string, nodes: GraphNode[], edges: GraphEdge[], maxDepth = 3, maxNodes = 14): LocalGraphData {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const adjacent = new Map<string, Array<{ id: string; edge: GraphEdge }>>();

  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    adjacent.get(edge.source)?.push({ id: edge.target, edge }) ?? adjacent.set(edge.source, [{ id: edge.target, edge }]);
    adjacent.get(edge.target)?.push({ id: edge.source, edge }) ?? adjacent.set(edge.target, [{ id: edge.source, edge }]);
  }

  const edgeRank = (edge: GraphEdge) => isCausalRelation(edge) ? 0 : isInferredGraphEdge(edge) ? 2 : 1;
  for (const neighbours of adjacent.values()) {
    neighbours.sort((a, b) => edgeRank(a.edge) - edgeRank(b.edge) || b.edge.confidence - a.edge.confidence || (nodeById.get(a.id)?.title ?? a.id).localeCompare(nodeById.get(b.id)?.title ?? b.id, "ru"));
  }

  const depthById = new Map<string, number>();
  if (nodeById.has(currentId)) depthById.set(currentId, 0);
  let frontier = [currentId];
  let topicCount = 0;
  for (let depth = 1; depth <= maxDepth && frontier.length > 0 && depthById.size < maxNodes; depth += 1) {
    const candidates = new Map<string, { id: string; edge: GraphEdge }>();
    for (const id of frontier) {
      // A topic is useful local context, but traversing through a topic hub
      // turns a neighbourhood into almost the complete archive.
      if (nodeById.get(id)?.kind === "topic") continue;
      for (const candidate of adjacent.get(id) ?? []) {
        if (depthById.has(candidate.id)) continue;
        const previous = candidates.get(candidate.id);
        if (!previous || edgeRank(candidate.edge) < edgeRank(previous.edge) || candidate.edge.confidence > previous.edge.confidence) candidates.set(candidate.id, candidate);
      }
    }
    const perDepthBudget = Math.min(5, maxNodes - depthById.size);
    const selected = [...candidates.values()]
      .sort((a, b) => edgeRank(a.edge) - edgeRank(b.edge) || b.edge.confidence - a.edge.confidence || (nodeById.get(a.id)?.title ?? a.id).localeCompare(nodeById.get(b.id)?.title ?? b.id, "ru"))
      .filter(({ id }) => {
        if (nodeById.get(id)?.kind !== "topic") return true;
        if (topicCount >= 3) return false;
        topicCount += 1;
        return true;
      })
      .slice(0, perDepthBudget);
    frontier = selected.map(({ id }) => id);
    frontier.forEach((id) => depthById.set(id, depth));
  }

  const orderedNodes = [...depthById.entries()].sort(([idA, a], [idB, b]) => a - b || (nodeById.get(idA)?.title ?? idA).localeCompare(nodeById.get(idB)?.title ?? idB, "ru"));
  const localNodes = orderedNodes
    .map(([id, depth], index) => {
      const node = nodeById.get(id)!;
      const position = positionFor(index);
      return { ...node, depth, ...position };
    });

  const localIds = new Set(depthById.keys());
  const localEdges = selectVisualEdges(edges.filter((edge) => localIds.has(edge.source) && localIds.has(edge.target)), 120, 0)
    .map((edge) => ({
      ...edge,
      depth: Math.max(depthById.get(edge.source) ?? maxDepth, depthById.get(edge.target) ?? maxDepth),
      dotted: isDottedLocalEdge(edge),
      causal: isCausalRelation(edge),
      label: relationLabel(edge.type),
      sourceNode: nodeById.get(edge.source),
      targetNode: nodeById.get(edge.target),
    }));

  return { current: nodeById.get(currentId), nodes: localNodes, edges: localEdges };
}
