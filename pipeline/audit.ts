import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CanonicalPublication } from "./telegram/types";

interface Archive { publications: CanonicalPublication[] }
const input = process.argv[2] ?? "pipeline/telegram/archive/canonical.json";
const sourceRoot = process.argv[3] ? resolve(process.argv[3]) : undefined;
const archive = JSON.parse(await readFile(resolve(input),"utf8")) as Archive;
const publications = archive.publications;
const ids = new Set(publications.map((publication)=>publication.id));
const rawIds = publications.flatMap((publication)=>publication.rawMessageIds);
const duplicateMessages = rawIds.filter((id,index)=>rawIds.indexOf(id)!==index);
const brokenRelations = publications.flatMap((publication)=>publication.relations.filter((relation)=>relation.targetId.startsWith("publication:")&&!ids.has(relation.targetId)).map((relation)=>`${publication.id} -> ${relation.targetId}`));
const media = publications.flatMap((publication)=>publication.media);
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
  duplicateMessages:duplicateMessages.length,
  brokenRelations:brokenRelations.length,
  missingMedia:sourceRoot?missingMedia:"not-checked",
};
console.log(JSON.stringify(report,null,2));
if(duplicateMessages.length||brokenRelations.length) process.exitCode=1;
