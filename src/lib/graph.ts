import type { AnyEntry } from "./content";

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

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  evidence: string;
  confidence: number;
}

export function buildGraph(entries: AnyEntry[]) {
  const ids = new Set(entries.map((entry) => entry.data.id));
  const missing = entries.flatMap((entry) => entry.data.relations.filter((relation) => !ids.has(relation.target)).map((relation) => `${entry.data.id} -> ${relation.target}`));
  if (missing.length) throw new Error(`Graph contains relations to missing targets:\n${missing.join("\n")}`);
  const nodes: GraphNode[] = entries.map((entry) => ({
    id: entry.data.id,
    title: entry.data.title,
    kind: entry.data.kind,
    href: entryHref(entry),
    tags: entry.data.tags,
    featured: entry.data.featured,
  }));
  const explicit: GraphEdge[] = entries.flatMap((entry) =>
    entry.data.relations.map((relation) => ({ source: entry.data.id, ...relation })),
  );
  const seen = new Set(explicit.map((edge) => `${edge.source}|${edge.target}`));
  const inferred: GraphEdge[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      const overlap = a.data.tags.filter((tag) => b.data.tags.includes(tag));
      if (!overlap.length) continue;
      const key = `${a.data.id}|${b.data.id}`;
      const reverse = `${b.data.id}|${a.data.id}`;
      if (seen.has(key) || seen.has(reverse)) continue;
      inferred.push({
        source: a.data.id,
        target: b.data.id,
        type: "related",
        evidence: "topic",
        confidence: Math.min(0.9, 0.45 + overlap.length * 0.12),
      });
    }
  }
  return { nodes, edges: [...explicit, ...inferred] };
}
