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

/** An edge paired with the title of the node it connects to, for stable ordering. */
interface EdgeOrder {
  edge: GraphEdge;
  title: string;
}

/** A one-hop neighbour: where the edge leads, the edge itself, and its title. */
interface Neighbour extends EdgeOrder {
  id: string;
}

/**
 * Significance order shared by the spatial projection and the direction lists:
 * causal, then explicit evidence, then topic/semantic context, with confidence
 * and title as tie-breakers so both views lead with the same relation.
 */
function compareEdgeOrder(a: EdgeOrder, b: EdgeOrder) {
  const rankA = isCausalRelation(a.edge) ? 0 : isInferredGraphEdge(a.edge) ? 2 : 1;
  const rankB = isCausalRelation(b.edge) ? 0 : isInferredGraphEdge(b.edge) ? 2 : 1;
  return rankA - rankB || b.edge.confidence - a.edge.confidence || a.title.localeCompare(b.title, "ru");
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
  const adjacent = new Map<string, Neighbour[]>();
  const link = (from: string, node: GraphNode, edge: GraphEdge) => {
    const entry: Neighbour = { id: node.id, edge, title: node.title };
    const bucket = adjacent.get(from);
    if (bucket) bucket.push(entry);
    else adjacent.set(from, [entry]);
  };

  for (const edge of edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    link(source.id, target, edge);
    link(target.id, source, edge);
  }

  for (const neighbours of adjacent.values()) neighbours.sort(compareEdgeOrder);

  const depthById = new Map<string, number>();
  if (nodeById.has(currentId)) depthById.set(currentId, 0);
  let frontier = [currentId];
  let topicCount = 0;
  for (let depth = 1; depth <= maxDepth && frontier.length > 0 && depthById.size < maxNodes; depth += 1) {
    const candidates = new Map<string, Neighbour>();
    for (const id of frontier) {
      // A topic is useful local context, but traversing through a topic hub
      // turns a neighbourhood into almost the complete archive.
      if (nodeById.get(id)?.kind === "topic") continue;
      for (const candidate of adjacent.get(id) ?? []) {
        if (depthById.has(candidate.id)) continue;
        const previous = candidates.get(candidate.id);
        if (!previous || compareEdgeOrder(candidate, previous) < 0) candidates.set(candidate.id, candidate);
      }
    }
    const perDepthBudget = Math.min(5, maxNodes - depthById.size);
    const selected = [...candidates.values()]
      .sort(compareEdgeOrder)
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

export type RelationDirectionId = "outgoing" | "incoming";

/** One end of a directed edge, resolved to the node a reader can open. */
export interface LocalRelation {
  /** Identity of the directed edge inside its direction list. */
  key: string;
  edge: GraphEdge;
  node: GraphNode;
  href: string;
  title: string;
  label: string;
  evidence: string;
  confidence: number;
  causal: boolean;
  /** Topic, semantic, or otherwise inferred context rather than direct proof. */
  inferred: boolean;
  /** Review state carried by the edge, when the data provides one. */
  status?: string;
}

export interface LocalDirection {
  id: RelationDirectionId;
  heading: string;
  /** How to read the arrow inside this direction. */
  hint: string;
  /** Replaces the list when the direction has no relations. */
  emptyText: string;
  relations: LocalRelation[];
}

const DIRECTIONS: Array<Pick<LocalDirection, "id" | "heading" | "hint" | "emptyText">> = [
  { id: "outgoing", heading: "Исходящие", hint: "к соседям", emptyText: "Исходящих связей пока нет: материал ни на что не ссылается." },
  { id: "incoming", heading: "Входящие", hint: "от соседей", emptyText: "Входящих связей пока нет: на этот материал ещё не ссылаются." },
];

/**
 * Splits every directed edge that touches one material into outgoing and
 * incoming relations. Unlike the spatial projection this is neither depth- nor
 * budget-bounded, and a neighbour keeps the href the graph already resolved.
 */
export function buildDirectedRelations(currentId: string, nodes: GraphNode[], edges: GraphEdge[]): LocalDirection[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, LocalRelation>();
  const incoming = new Map<string, LocalRelation>();

  for (const edge of edges) {
    // A self-edge has no direction to show, so it belongs in neither list.
    if (edge.source === edge.target) continue;
    const outgoingEnd = edge.source === currentId ? nodeById.get(edge.target) : undefined;
    const incomingEnd = edge.target === currentId ? nodeById.get(edge.source) : undefined;
    const node = outgoingEnd ?? incomingEnd;
    if (!node) continue;
    const key = `${edge.source}→${edge.target}|${edge.type}|${edge.evidence}`;
    (outgoingEnd ? outgoing : incoming).set(key, {
      key,
      edge,
      node,
      href: node.href,
      title: node.title,
      label: relationLabel(edge.type),
      evidence: edge.evidence,
      confidence: edge.confidence,
      causal: isCausalRelation(edge),
      inferred: isInferredGraphEdge(edge),
      status: edge.reviewStatus ?? edge.status,
    });
  }

  return DIRECTIONS.map((direction) => ({
    ...direction,
    relations: [...(direction.id === "outgoing" ? outgoing : incoming).values()].sort(compareEdgeOrder),
  }));
}
