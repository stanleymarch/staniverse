import type { CanonicalPublication } from "../telegram/types";
import { isFresh } from "./catalog";
import type { EnrichmentResult, ReviewDecision } from "./types";

const reviewKey=(id:string,kind:"topic"|"entity"|"relation",value:string)=>`${id}::${kind}::${value}`;

const provenanceKind = (relation: CanonicalPublication["relations"][number]) =>
  typeof relation.provenance === "string" ? relation.provenance : relation.provenance?.kind;

const provenanceSource = (relation: CanonicalPublication["relations"][number]) =>
  typeof relation.provenance === "object" ? relation.provenance?.source : undefined;

function materializedRelation(publication: CanonicalPublication, relation: CanonicalPublication["relations"][number]) {
  const hasMaterializedMetadata = relation.provenance !== undefined || relation.reviewStatus !== undefined || relation.status !== undefined;
  return {
    target: relation.targetId,
    type: relation.type,
    evidence: relation.evidence,
    confidence: relation.confidence,
    ...(relation.explanation !== undefined ? { explanation: relation.explanation } : {}),
    ...(hasMaterializedMetadata
      ? {
          ...(relation.reviewStatus !== undefined ? { reviewStatus: relation.reviewStatus } : {}),
          ...(relation.status !== undefined ? { status: relation.status } : {}),
          ...(relation.provenance !== undefined ? { provenance: relation.provenance } : {}),
        }
      : {
          reviewStatus: "accepted" as const,
          provenance: {
            kind: "imported" as const,
            source: "telegram-export",
            sourceId: publication.sourceId,
            url: publication.sourceUrl,
            method: relation.evidence,
          },
        }),
  };
}

export function mergeEnrichment(publication: CanonicalPublication, result?: EnrichmentResult, reviews:ReviewDecision[] = []) {
  const preservedRelations = (replaceLocalDerived = false) => publication.relations
    .filter((relation) => !replaceLocalDerived || provenanceKind(relation) !== "deterministic" || provenanceSource(relation) !== "local-rules")
    .map((relation) => materializedRelation(publication, relation));
  if (!result || !isFresh(result, publication.body)) return { tags: publication.tags, sourceTags: publication.tags, topics: [] as string[], entities: [] as string[], relations: preservedRelations() };
  const accepted=new Set(reviews.filter((decision)=>decision.status==="accepted").map((decision)=>decision.key));
  const rejected=new Set(reviews.filter((decision)=>decision.status==="rejected").map((decision)=>decision.key));
  const automatic=result.provider==="local-rules";
  // Topics/entities are navigation aids, not claims: they land unless explicitly
  // rejected, whatever the provider. Relations are semantic claims and stay
  // proposal-gated for every non-deterministic provider.
  const topics=result.topics.filter((topic)=>!rejected.has(reviewKey(result.id,"topic",topic)));
  const entities=result.entities.filter((entity)=>!rejected.has(reviewKey(result.id,"entity",entity)));
  const explicit = preservedRelations(automatic);
  const inferred = result.relations
    .filter((relation) => relation.confidence >= 0.9 && (automatic ? !rejected.has(reviewKey(result.id,"relation",`${relation.targetId}|${relation.type}`)) : accepted.has(reviewKey(result.id,"relation",`${relation.targetId}|${relation.type}`)) && !rejected.has(reviewKey(result.id,"relation",`${relation.targetId}|${relation.type}`))))
    .map((relation) => ({ target: relation.targetId, type: relation.type, evidence: "entity" as const, confidence: relation.confidence,explanation:relation.explanation,reviewStatus:automatic?"inferred" as const:"accepted" as const,provenance:{kind:automatic?"deterministic" as const:"enrichment" as const,source:result.provider,sourceId:result.id,method:relation.explanation,extractor:result.promptVersion,version:result.model} }));
  return {
    tags: publication.tags,
    sourceTags: publication.tags,
    topics: [...new Set(topics)],
    entities: [...new Set(entities)],
    relations: [...new Map([...inferred, ...explicit].map((relation) => [`${relation.target}|${relation.type}`, relation])).values()],
  };
}
