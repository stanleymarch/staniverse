import type { AnyEntry } from "./content";
import { collectTopics } from "./topics";
import { getTopicDefinition, normalizeTopics } from "./taxonomy";

function entryHref(entry: AnyEntry) {
  const base = entry.collection === "works" ? "works" : entry.collection === "projects" ? "projects" : entry.collection === "articles" ? "articles" : entry.collection === "experiments" ? "experiments" : "garden";
  return `/${base}/${entry.id}/`;
}
function summaryExcerpt(value: string, limit = 240) {
  return value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}…` : value;
}

export interface GraphNode {
  id: string;
  title: string;
  summary: string;
  kind: string;
  href: string;
  /** Absolute run address for experiments that live outside the site. */
  launch?: string;
  /** Canonical taxonomy labels, never raw source hashtags. */
  topics: string[];
  /** Verbatim author or editorial tags kept as provenance. */
  sourceTags: string[];
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
  const hiddenStatuses = new Set(["rejected", "proposed", "pending", "needs-review"]);
  const visibleRelations = (entry: AnyEntry) => entry.data.relations.filter((relation) => {
    const status = relation.status === "rejected" || relation.reviewStatus === "rejected"
      ? "rejected"
      : relation.reviewStatus ?? relation.status;
    return !status || !hiddenStatuses.has(status);
  });
  const missing = entries.flatMap((entry) => visibleRelations(entry).filter((relation) => !ids.has(relation.target)).map((relation) => `${entry.data.id} -> ${relation.target}`));
  if (missing.length) throw new Error(`Graph contains relations to missing targets:\n${missing.join("\n")}`);
  const entryNodes: GraphNode[] = entries.map((entry) => {
    const sourceTags = entry.data.sourceTags ?? entry.data.tags;
    const topicValues = entry.collection === "publications"
      ? entry.data.topics ?? []
      : [...entry.data.tags, ...(entry.data.topics ?? [])];
    return {
      id: entry.data.id,
      title: entry.data.title,
      summary: summaryExcerpt(entry.data.summary),
      kind: entry.data.kind,
      href: entryHref(entry),
      /* A demo that is not live is never launched from the graph: the node keeps
         its write-up and loses the run address. */
      launch: entry.collection === "experiments" && entry.data.status === "live" ? entry.data.href : undefined,
      topics: normalizeTopics(topicValues).filter((topic) => Boolean(getTopicDefinition(topic))),
      sourceTags: [...new Set(sourceTags)],
      featured: entry.data.featured,
    };
  });
  const topics = collectTopics(entries, true);
  const topicNodes: GraphNode[] = topics.map((topic) => ({
    id: `topic:${topic.id}`,
    title: topic.name,
    summary: `${topic.entries.length} материалов по теме «${topic.name}».`,
    kind: "topic",
    href: `/topics/${topic.slug}/`,
    topics: [],
    sourceTags: [],
    featured: topic.entries.length >= 20,
  }));
  const explicit: GraphEdge[] = entries.flatMap((entry) =>
    visibleRelations(entry).map((relation) => ({ source: entry.data.id, ...relation })),
  );
  const topicEdges: GraphEdge[] = topics.flatMap((topic) => topic.entries.map((entry) => {
    const sourceTags = entry.collection === "publications"
      ? []
      : normalizeTopics(entry.data.sourceTags ?? entry.data.tags);
    const isSource = sourceTags.includes(topic.id);
    return {
      source: entry.data.id,
      target: `topic:${topic.id}`,
      type: "part-of",
      evidence: "topic",
      confidence: isSource ? 1 : .62,
      reviewStatus: isSource ? "confirmed" as const : "inferred" as const,
      provenance: { kind: isSource ? "imported" as const : "deterministic" as const, field: isSource ? "sourceTags" : "topics", method: isSource ? "curated tag" : "automatic topic rule" },
    };
  }));
  return { nodes: [...entryNodes, ...topicNodes], edges: [...explicit, ...topicEdges] };
}
