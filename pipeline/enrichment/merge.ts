import type { CanonicalPublication } from "../telegram/types";
import { isFresh } from "./catalog";
import type { EnrichmentResult, ReviewDecision } from "./types";

const reviewKey=(id:string,kind:"topic"|"entity"|"relation",value:string)=>`${id}::${kind}::${value}`;

export function mergeEnrichment(publication: CanonicalPublication, result?: EnrichmentResult, reviews:ReviewDecision[] = []) {
  if (!result || !isFresh(result, publication.body)) return { tags: publication.tags, entities: [] as string[], relations: publication.relations.map((relation) => ({ target: relation.targetId, type: "mentions" as const, evidence: "hyperlink" as const, confidence: relation.confidence })) };
  const accepted=new Set(reviews.filter((decision)=>decision.status==="accepted").map((decision)=>decision.key));
  const trusted=result.provider==="local-rules";
  const topics=result.topics.filter((topic)=>trusted||accepted.has(reviewKey(result.id,"topic",topic)));
  const entities=result.entities.filter((entity)=>trusted||accepted.has(reviewKey(result.id,"entity",entity)));
  const tags = [...new Set([...publication.tags, ...topics])];
  const explicit = publication.relations.map((relation) => ({ target: relation.targetId, type: "mentions" as const, evidence: "hyperlink" as const, confidence: relation.confidence }));
  const inferred = result.relations
    .filter((relation) => relation.confidence >= 0.9 && (trusted||accepted.has(reviewKey(result.id,"relation",`${relation.targetId}|${relation.type}`))))
    .map((relation) => ({ target: relation.targetId, type: relation.type, evidence: "entity" as const, confidence: relation.confidence }));
  return {
    tags,
    entities: [...new Set(entities)],
    relations: [...new Map([...explicit, ...inferred].map((relation) => [`${relation.target}|${relation.type}`, relation])).values()],
  };
}
