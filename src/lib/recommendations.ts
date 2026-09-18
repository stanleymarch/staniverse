import type { GraphEdge, GraphNode } from "./graph";
import { getTopicDefinition } from "./taxonomy";
import { isCausalRelation, isInferredGraphEdge, relationLabel } from "./graph-visuals";

export interface Recommendation {
  id: string;
  title: string;
  href: string;
  kind: string;
  /** Why this material is offered: a reviewed relation, or the topic two share. */
  reason: string;
}

/** Relation types that name no real tie on their own: "связано" explains nothing. */
const GENERIC_RELATIONS = new Set(["related", "mentions"]);

/** Causal and reviewed relations outrank context that was only inferred. */
function edgeScore(edge: GraphEdge) {
  if (isCausalRelation(edge)) return 6;
  return isInferredGraphEdge(edge) ? 2 : 4;
}

/** Why this material is offered, in the reader's terms rather than the schema's. */
function reasonFor(edge: GraphEdge | undefined, topics: string[]) {
  if (edge && !GENERIC_RELATIONS.has(edge.type) && !isInferredGraphEdge(edge)) return `Связь: ${relationLabel(edge.type)}`;
  if (topics.length) return `Та же тема: ${getTopicDefinition(topics[0])?.label ?? topics[0]}`;
  return "Прямая связь в графе";
}

/**
 * What to read next: the neighbours of this material ranked by the strength of the
 * tie — causal and reviewed relations first, then shared topics — so the block
 * offers a continuation of the current text, not a random sample of the archive.
 */
export function buildRecommendations(currentId: string, nodes: GraphNode[], edges: GraphEdge[], limit = 4): Recommendation[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const current = nodeById.get(currentId);
  if (!current) return [];
  const scores = new Map<string, { score: number; edge?: GraphEdge; topics: string[] }>();
  const add = (id: string, score: number, edge?: GraphEdge, topics?: string[]) => {
    const entry = scores.get(id) ?? { score: 0, edge: undefined, topics: [] };
    entry.score += score;
    if (edge && (!entry.edge || edgeScore(edge) > edgeScore(entry.edge) || (edgeScore(edge) === edgeScore(entry.edge) && !GENERIC_RELATIONS.has(edge.type) && GENERIC_RELATIONS.has(entry.edge.type)))) entry.edge = edge;
    if (topics?.length) entry.topics = topics;
    scores.set(id, entry);
  };

  for (const edge of edges) {
    const other = edge.source === currentId ? edge.target : edge.target === currentId ? edge.source : undefined;
    if (!other || other.startsWith("topic:")) continue;
    add(other, edgeScore(edge), edge);
  }
  const currentTopics = new Set(current.topics);
  for (const node of nodes) {
    if (node.id === currentId || node.kind === "topic") continue;
    const shared = node.topics.filter((topic) => currentTopics.has(topic));
    if (shared.length) add(node.id, Math.min(shared.length, 3), undefined, shared);
  }

  return [...scores.entries()]
    .flatMap(([id, entry]) => {
      const node = nodeById.get(id);
      return node ? [{ node, ...entry }] : [];
    })
    .sort((a, b) => b.score - a.score || Number(b.node.featured) - Number(a.node.featured) || a.node.title.localeCompare(b.node.title, "ru"))
    .slice(0, limit)
    .map(({ node, edge, topics }) => ({
      id: node.id,
      title: node.title,
      href: node.href,
      kind: node.kind,
      reason: reasonFor(edge, topics),
    }));
}
