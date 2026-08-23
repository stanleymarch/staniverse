import type { CanonicalPublication } from "../telegram/types";
import { isFresh } from "./catalog";
import type { EnrichmentResult, ReviewDecision } from "./types";

const reviewKey=(id:string,kind:"topic"|"entity"|"relation",value:string)=>`${id}::${kind}::${value}`;

export function mergeEnrichment(publication: CanonicalPublication, result?: EnrichmentResult, reviews:ReviewDecision[] = []) {
  const explicitRelations=()=>publication.relations.map((relation) => ({ target: relation.targetId, type: "mentions" as const, evidence: "hyperlink" as const, confidence: relation.confidence,reviewStatus:"accepted" as const,provenance:{kind:"imported" as const,source:"telegram-export",sourceId:publication.sourceId,url:publication.sourceUrl,method:relation.evidence} }));
  if (!result || !isFresh(result, publication.body)) return { tags: publication.tags, entities: [] as string[], relations: explicitRelations() };
  const accepted=new Set(reviews.filter((decision)=>decision.status==="accepted").map((decision)=>decision.key));
  const trusted=result.provider==="local-rules";
  const topics=result.topics.filter((topic)=>trusted||accepted.has(reviewKey(result.id,"topic",topic)));
  const entities=result.entities.filter((entity)=>trusted||accepted.has(reviewKey(result.id,"entity",entity)));
  const tags = [...new Set([...publication.tags, ...topics])];
  const explicit = explicitRelations();
  const inferred = result.relations
    .filter((relation) => relation.confidence >= 0.9 && (trusted||accepted.has(reviewKey(result.id,"relation",`${relation.targetId}|${relation.type}`))))
    .map((relation) => ({ target: relation.targetId, type: relation.type, evidence: "entity" as const, confidence: relation.confidence,explanation:relation.explanation,reviewStatus:"accepted" as const,provenance:{kind:trusted?"deterministic" as const:"enrichment" as const,source:result.provider,sourceId:result.id,method:relation.explanation,extractor:result.promptVersion,version:result.model} }));
  return {
    tags,
    entities: [...new Set(entities)],
    relations: [...new Map([...explicit, ...inferred].map((relation) => [`${relation.target}|${relation.type}`, relation])).values()],
  };
}
