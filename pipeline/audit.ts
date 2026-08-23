import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CanonicalPublication } from "./telegram/types";
import type { EnrichmentBundle } from "./enrichment/types";
import { isFresh } from "./enrichment/catalog";

interface Archive { publications: CanonicalPublication[] }
const input = process.argv[2] ?? "pipeline/telegram/archive/canonical.json";
const sourceRoot = process.argv[3] ? resolve(process.argv[3]) : undefined;
const enrichmentPath = process.argv[4] ?? "pipeline/enrichment/generated/telegram.json";
const archive = JSON.parse(await readFile(resolve(input),"utf8")) as Archive;
const publications = archive.publications;
const ids = new Set(publications.map((publication)=>publication.id));
const rawIds = publications.flatMap((publication)=>publication.rawMessageIds);
const duplicateMessages = rawIds.filter((id,index)=>rawIds.indexOf(id)!==index);
const brokenRelations = publications.flatMap((publication)=>publication.relations.filter((relation)=>relation.targetId.startsWith("publication:")&&!ids.has(relation.targetId)).map((relation)=>`${publication.id} -> ${relation.targetId}`));
const media = publications.flatMap((publication)=>publication.media);
let enrichment:EnrichmentBundle|undefined;try{enrichment=JSON.parse(await readFile(resolve(enrichmentPath),"utf8")) as EnrichmentBundle}catch{}
const enrichmentById=new Map(enrichment?.results.map((result)=>[result.id,result])??[]);
const staleEnrichment=publications.filter((publication)=>{const result=enrichmentById.get(publication.id);return result&&!isFresh(result,publication.body)}).length;
let missingMedia = 0;
if(sourceRoot) for(const item of media){ try { await access(resolve(sourceRoot,item.sourcePath)); } catch { missingMedia++; } }
const report = {
  publications:publications.length,
  sourceMessages:new Set(rawIds).size,
  threadedPublications:publications.filter((publication)=>publication.threadIds.length>1).length,
  maxThreadLength:Math.max(...publications.map((publication)=>publication.threadIds.length)),
  mediaOnly:publications.filter((publication)=>!publication.body).length,
  mediaReferences:media.length,
  explicitRelations:publications.reduce((sum,publication)=>sum+publication.relations.length,0),
  tags:publications.reduce((sum,publication)=>sum+publication.tags.length,0),
  enrichedPublications:publications.filter((publication)=>enrichmentById.get(publication.id)?.topics.length).length,
  generatedTopics:new Set(enrichment?.results.flatMap((result)=>result.topics)??[]).size,
  generatedEntities:new Set(enrichment?.results.flatMap((result)=>result.entities)??[]).size,
  generatedRelations:enrichment?.results.reduce((sum,result)=>sum+result.relations.length,0)??0,
  staleEnrichment,
  duplicateMessages:duplicateMessages.length,
  brokenRelations:brokenRelations.length,
  missingMedia:sourceRoot?missingMedia:"not-checked",
};
console.log(JSON.stringify(report,null,2));
if(duplicateMessages.length||brokenRelations.length||staleEnrichment) process.exitCode=1;
