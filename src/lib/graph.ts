import type { AnyEntry } from "./content";
import { collectTopics } from "./topics";

function entryHref(entry: AnyEntry) {
  const base = entry.collection === "works" ? "works" : entry.collection === "projects" ? "projects" : entry.collection === "articles" ? "articles" : "garden";
  return `/${base}/${entry.id}/`;
}

export interface GraphNode {
  id: string;
  title: string;
  kind: string;
  href: string;
  tags: string[];
  featured: boolean;
}

export interface GraphEdgeProvenance {
  kind?: "manual" | "imported" | "deterministic" | "enrichment" | "inferred";
  source?: string;
  sourceId?: string;
  messageId?: number | string;
  url?: string;
  field?: string;
  method?: string;
  extractor?: string;
  version?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  evidence: string;
  confidence: number;
  provenance?: string | GraphEdgeProvenance;
  explanation?: string;
  reviewStatus?: "proposed" | "accepted" | "rejected" | "needs-review" | "pending" | "confirmed" | "inferred";
  /** Legacy alias retained for imported review exports. */
  status?: "proposed" | "accepted" | "rejected" | "needs-review" | "pending" | "confirmed" | "inferred";
}

export function buildGraph(entries: AnyEntry[]) {
  const ids = new Set(entries.map((entry) => entry.data.id));
  const missing = entries.flatMap((entry) => entry.data.relations.filter((relation) => !ids.has(relation.target)).map((relation) => `${entry.data.id} -> ${relation.target}`));
  if (missing.length) throw new Error(`Graph contains relations to missing targets:\n${missing.join("\n")}`);
  const entryNodes: GraphNode[] = entries.map((entry) => ({
    id: entry.data.id,
    title: entry.data.title,
    kind: entry.data.kind,
    href: entryHref(entry),
    tags: [...new Set([...entry.data.tags, ...(entry.data.topics ?? [])])],
    featured: entry.data.featured,
  }));
  const topics = collectTopics(entries, true);
  const topicNodes: GraphNode[] = topics.map((topic) => ({
    id: `topic:${topic.name}`,
    title: topic.name,
    kind: "topic",
    href: `/topics/${topic.slug}/`,
    tags: [],
    featured: topic.entries.length >= 20,
  }));
  const explicit: GraphEdge[] = entries.flatMap((entry) =>
    entry.data.relations.map((relation) => ({ source: entry.data.id, ...relation })),
  );
  const topicEdges: GraphEdge[] = topics.flatMap((topic) => topic.entries.map((entry) => {
    const isSource = new Set(entry.data.sourceTags ?? entry.data.tags).has(topic.id) || new Set(entry.data.sourceTags ?? entry.data.tags).has(topic.name);
    return {
      source: entry.data.id,
      target: `topic:${topic.name}`,
      type: "part-of",
      evidence: "topic",
      confidence: isSource ? 1 : .62,
      reviewStatus: isSource ? "confirmed" as const : "inferred" as const,
      provenance: { kind: isSource ? "imported" as const : "deterministic" as const, field: isSource ? "sourceTags" : "topics", method: isSource ? "telegram hashtag or curated tag" : "automatic topic rule" },
    };
  }));
  return { nodes: [...entryNodes, ...topicNodes], edges: [...explicit, ...topicEdges] };
}
