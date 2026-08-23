import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { CanonicalPublication } from "../telegram/types";
import type { EnrichmentJob } from "./types";

interface Archive { publications: CanonicalPublication[] }
const [input="pipeline/telegram/archive/canonical.json",output="pipeline/enrichment/jobs/telegram.jsonl"] = process.argv.slice(2);
const archive = JSON.parse(await readFile(resolve(input),"utf8")) as Archive;
async function editorialTargets(){
  const targets:Array<{id:string;title:string;kind:string}>=[];
  for(const folder of ["works","projects","articles"]){
    const root=resolve("src/content",folder);
    for(const file of await readdir(root)){if(!file.endsWith(".md"))continue;const source=await readFile(resolve(root,file),"utf8");const value=(key:string)=>source.match(new RegExp(`^${key}:\\s*(.+)$`,"m"))?.[1]?.trim();const rawId=value("id"),rawTitle=value("title"),kind=value("kind");if(!rawId||!rawTitle||!kind)continue;const parse=(raw:string)=>{try{return JSON.parse(raw)}catch{return raw}};targets.push({id:parse(rawId),title:parse(rawTitle),kind:parse(kind)})}
  }
  return targets;
}
const coreTargets=await editorialTargets();
const publicationTargets = archive.publications.map((publication) => ({id:publication.id,title:publication.body.replace(/\s+/g," ").slice(0,100)||`Telegram ${publication.sourceId}`,kind:publication.kind}));
const jobs: EnrichmentJob[] = archive.publications.filter((publication)=>publication.body.trim()).map((publication)=>({
  id:publication.id,
  textHash:createHash("sha256").update(publication.body).digest("hex"),
  promptVersion:"staniverse-topology-v1",
  language:"ru",
  sourceKind:publication.kind,
  sourceText:publication.body,
  existingTags:publication.tags,
  candidateTargets:[...coreTargets,...publicationTargets.filter((target)=>target.id!==publication.id).slice(-40)],
}));
await mkdir(dirname(resolve(output)),{recursive:true});
await writeFile(resolve(output),jobs.map((job)=>JSON.stringify(job)).join("\n")+"\n","utf8");
console.log(JSON.stringify({jobs:jobs.length,skippedMediaOnly:archive.publications.length-jobs.length,output:resolve(output)}));
