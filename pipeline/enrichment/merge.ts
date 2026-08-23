import type { CanonicalPublication } from "../telegram/types";
import { isFresh } from "./catalog";
import type { EnrichmentResult } from "./types";

export function mergeEnrichment(publication: CanonicalPublication, result?: EnrichmentResult) {
  if (!result || !isFresh(result, publication.body)) return { tags: publication.tags, entities: [] as string[], relations: publication.relations.map((relation) => ({ target: relation.targetId, type: "mentions" as const, evidence: "hyperlink" as const, confidence: relation.confidence })) };
  const tags = [...new Set([...publication.tags, ...result.topics])];
  const explicit = publication.relations.map((relation) => ({ target: relation.targetId, type: "mentions" as const, evidence: "hyperlink" as const, confidence: relation.confidence }));
  const inferred = result.relations
    .filter((relation) => relation.confidence >= 0.9 && (!result.needsReview || result.provider === "local-rules"))
    .map((relation) => ({ target: relation.targetId, type: relation.type, evidence: "entity" as const, confidence: relation.confidence }));
  return {
    tags,
    entities: [...new Set(result.entities)],
    relations: [...new Map([...explicit, ...inferred].map((relation) => [`${relation.target}|${relation.type}`, relation])).values()],
  };
}
