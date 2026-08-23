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

function positionFor(depth: number, index: number, count: number) {
  if (depth === 0) return { x: 50, y: 50 };

  const angle = (Math.PI * 2 * index) / Math.max(count, 1) - Math.PI / 2;
  const radiusX = depth === 1 ? 35 : depth === 2 ? 43 : 47;
  const radiusY = depth === 1 ? 33 : depth === 2 ? 42 : 46;
  return {
    x: 50 + Math.cos(angle) * radiusX,
    y: 50 + Math.sin(angle) * radiusY,
  };
}

/**
 * Projects the full graph into a small, deterministic neighbourhood. The
 * component can reveal one, two, or three hops without running a renderer.
 */
export function buildLocalGraph(currentId: string, nodes: GraphNode[], edges: GraphEdge[], maxDepth = 3, maxNodes = 32): LocalGraphData {
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
    const perDepthBudget = Math.min(10, maxNodes - depthById.size);
    const selected = [...candidates.values()]
      .sort((a, b) => edgeRank(a.edge) - edgeRank(b.edge) || b.edge.confidence - a.edge.confidence || (nodeById.get(a.id)?.title ?? a.id).localeCompare(nodeById.get(b.id)?.title ?? b.id, "ru"))
      .filter(({ id }) => {
        if (nodeById.get(id)?.kind !== "topic") return true;
        if (topicCount >= 6) return false;
        topicCount += 1;
        return true;
      })
      .slice(0, perDepthBudget);
    frontier = selected.map(({ id }) => id);
    frontier.forEach((id) => depthById.set(id, depth));
  }

  const byDepth = new Map<number, string[]>();
  for (const [id, depth] of depthById) {
    const list = byDepth.get(depth) ?? [];
    list.push(id);
    byDepth.set(depth, list);
  }
  for (const list of byDepth.values()) list.sort((a, b) => (nodeById.get(a)?.title ?? a).localeCompare(nodeById.get(b)?.title ?? b, "ru"));

  const localNodes = [...depthById.entries()]
    .sort(([, a], [, b]) => a - b)
    .map(([id, depth]) => {
      const node = nodeById.get(id)!;
      const siblings = byDepth.get(depth) ?? [id];
      const position = positionFor(depth, siblings.indexOf(id), siblings.length);
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
