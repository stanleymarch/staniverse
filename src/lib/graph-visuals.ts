import type { GraphEdge, GraphEdgeProvenance } from "./graph";

/** Relations whose direction describes a causal or derivational path. */
export const CAUSAL_RELATION_TYPES = new Set([
  "develops",
  "inspired",
  "grew-from",
  "continues",
  "derived-from",
  "uses-result",
  "documents",
]);

const RELATION_LABELS: Record<string, string> = {
  develops: "развивает",
  inspired: "вдохновлено",
  "grew-from": "выросло из",
  continues: "продолжает",
  "derived-from": "выведено из",
  "uses-result": "использует результат",
  documents: "документирует",
  mentions: "упоминает",
  references: "ссылается на",
  "part-of": "часть",
  related: "связано",
  uses: "использует",
  supports: "поддерживает",
  contradicts: "противоречит",
  "reply-to": "ответ на",
};

export function isCausalRelation(edge: Pick<GraphEdge, "type">) {
  return CAUSAL_RELATION_TYPES.has(edge.type);
}

export function relationLabel(type: string) {
  return RELATION_LABELS[type] ?? type;
}

/** Reads a provenance field while supporting the compact string form. */
export function provenanceField(provenance: GraphEdge["provenance"], field: keyof GraphEdgeProvenance) {
  if (typeof provenance === "string") return field === "kind" ? provenance : undefined;
  return provenance?.[field];
}

/** Topic/semantic edges are contextual and should be rendered after evidence edges. */
export function isInferredGraphEdge(edge: Pick<GraphEdge, "type" | "evidence">) {
  const evidence = edge.evidence.toLowerCase();
  const type = edge.type.toLowerCase();
  return evidence.includes("topic") || evidence.includes("semantic") || type.includes("topic") || type.includes("semantic");
}

/**
 * Select a bounded set for the spatial renderer without starving explicit edges.
 * Causal edges come first, followed by other evidence-backed edges, then context.
 */
export function selectVisualEdges(edges: GraphEdge[], budget = 180, minConfidence = 0.55) {
  const eligible = edges.filter((edge) => edge.confidence >= minConfidence);
  const causal = eligible.filter(isCausalRelation).sort((a, b) => b.confidence - a.confidence);
  const explicit = eligible
    .filter((edge) => !isCausalRelation(edge) && !isInferredGraphEdge(edge))
    .sort((a, b) => b.confidence - a.confidence);
  const inferred = eligible.filter((edge) => !isCausalRelation(edge) && isInferredGraphEdge(edge)).sort((a, b) => b.confidence - a.confidence);
  return [...causal, ...explicit, ...inferred].slice(0, Math.max(0, budget));
}
