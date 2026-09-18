import type { GraphEdge, GraphNode } from "../lib/graph";
import { forceLayout } from "../lib/force-layout";
import { isCausalRelation, isInferredGraphEdge, relationLabel, selectVisualEdges } from "../lib/graph-visuals";

export interface LocalGraphNode extends GraphNode {
  depth: number;
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

/** How many neighbours each ring may add: dots stay readable where cards could not. */
const RING_BUDGET = [0, 12, 20, 26];

/**
 * Projects the full graph into a deterministic neighbourhood of up to three hops.
 * Topic hubs are capped, because traversing through one turns a neighbourhood
 * into the whole archive.
 */
export function buildLocalGraph(currentId: string, nodes: GraphNode[], edges: GraphEdge[], maxDepth = 3): LocalGraphData {
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
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
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
    const perDepthBudget = RING_BUDGET[depth] ?? 0;
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

  const localNodes: LocalGraphNode[] = [...depthById.entries()]
    .sort(([idA, a], [idB, b]) => a - b || (nodeById.get(idA)?.title ?? idA).localeCompare(nodeById.get(idB)?.title ?? idB, "ru"))
    .map(([id, depth]) => ({ ...nodeById.get(id)!, depth }));

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

/** Drawn geometry of the neighbourhood: where each dot, line and label sits. */
export interface LocalGraphView {
  nodes: Array<Pick<LocalGraphNode, "id" | "title" | "href" | "kind" | "depth"> & { x: number; y: number; r: number }>;
  links: Array<{ key: string; source: string; target: string; depth: number; causal: boolean; dotted: boolean; x1: number; y1: number; x2: number; y2: number }>;
  labels: Array<{ id: string; text: string; depth: number; x: number; y: number; anchor: "start" | "end" }>;
  maxDepth: number;
}

const VIEW_WIDTH = 720;
const VIEW_HEIGHT = 880;

/**
 * Places the neighbourhood as a force-directed graph. Positions come from the
 * full projection, so revealing a deeper ring adds material without moving what
 * the reader already located; parallel relations share one line between a pair.
 */
export function buildLocalGraphView(graph: LocalGraphData): LocalGraphView {
  const positions = forceLayout(graph.nodes.map((node) => node.id), graph.edges.map((edge) => [edge.source, edge.target] as const), { width: VIEW_WIDTH, height: VIEW_HEIGHT });
  const pairs = new Map<string, LocalGraphEdge>();
  for (const edge of graph.edges) {
    const key = [edge.source, edge.target].sort().join("|");
    const kept = pairs.get(key);
    if (!kept || (edge.causal && !kept.causal) || edge.confidence > kept.confidence) pairs.set(key, edge);
  }
  const degree = new Map<string, number>();
  for (const edge of pairs.values()) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  const nodes = graph.nodes.map((node) => {
    const point = positions.get(node.id)!;
    const radius = 5 + Math.sqrt(degree.get(node.id) ?? 0) * 2.2 + (node.depth === 0 ? 1.6 : 0);
    return { id: node.id, title: node.title, href: node.href, kind: node.kind, depth: node.depth, x: point.x, y: point.y, r: Math.round(radius * 10) / 10 };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const links = [...pairs.values()].flatMap((edge) => {
    const from = byId.get(edge.source);
    const to = byId.get(edge.target);
    return from && to ? [{ key: `${edge.source}|${edge.target}`, source: edge.source, target: edge.target, depth: edge.depth, causal: edge.causal, dotted: edge.dotted, x1: from.x, y1: from.y, x2: to.x, y2: to.y }] : [];
  });
  const labels = [...nodes]
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.title.localeCompare(b.title, "ru"))
    .slice(0, 8)
    .map((node) => {
      const anchor = node.x > VIEW_WIDTH * 0.7 ? "end" as const : "start" as const;
      const text = node.title.length > 30 ? `${node.title.slice(0, 28)}…` : node.title;
      /* A topic is not part of this material's neighbourhood, it is a way out of
         it: the arrow the rest of the site uses marks the difference. */
      return { id: node.id, text: node.kind === "topic" ? `${text} ↗` : text, depth: node.depth, x: node.x + (anchor === "end" ? -(node.r + 5) : node.r + 5), y: node.y + 3.5, anchor };
    });
  const maxDepth = graph.nodes.reduce((deepest, node) => Math.max(deepest, node.depth), 0);
  return { nodes, links, labels, maxDepth };
}

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
