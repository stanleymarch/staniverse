import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { EnrichmentBundle, EnrichmentJob, EnrichmentResult } from "./types";

const [input="pipeline/enrichment/jobs/telegram.jsonl",output="pipeline/enrichment/review/openai.json",model=process.env.OPENAI_ENRICHMENT_MODEL??"gpt-5.4-mini",limitValue="0"]=process.argv.slice(2);
const apiKey=process.env.OPENAI_API_KEY;
if(!apiKey)throw new Error("OPENAI_API_KEY is required. This command is opt-in and may incur API costs.");
const jobs=(await readFile(resolve(input),"utf8")).split(/\r?\n/).filter(Boolean).map((line)=>JSON.parse(line) as EnrichmentJob);
const limit=Number(limitValue);const selected=limit>0?jobs.slice(0,limit):jobs;
const results:EnrichmentResult[]=[];
const schema={type:"object",additionalProperties:false,required:["summary","topics","entities","relations","needsReview"],properties:{summary:{type:"string"},topics:{type:"array",items:{type:"string"},maxItems:6},entities:{type:"array",items:{type:"string"},maxItems:12},relations:{type:"array",maxItems:8,items:{type:"object",additionalProperties:false,required:["targetId","type","explanation","confidence"],properties:{targetId:{type:"string"},type:{type:"string",enum:["mentions","documents","develops","inspired","uses","part-of","related"]},explanation:{type:"string"},confidence:{type:"number",minimum:0,maximum:1}}}},needsReview:{type:"boolean"}}};
for(const [index,job] of selected.entries()){
  const candidates=new Set(job.candidateTargets.map((target)=>target.id));
  const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model,store:false,instructions:"Размечай авторский русскоязычный архив. Не переписывай исходный текст. Выделяй 1–6 устойчивых тем, именованные сущности и только доказуемые связи с переданными кандидатами. Причинные связи inspired/develops ставь лишь при явном свидетельстве в тексте; иначе related и needsReview=true. Summary должен быть одной нейтральной фразой без добавления фактов.",input:JSON.stringify({sourceKind:job.sourceKind,sourceText:job.sourceText,existingTags:job.existingTags,candidateTargets:job.candidateTargets}),text:{format:{type:"json_schema",name:"staniverse_enrichment",strict:true,schema}}})});
  if(!response.ok)throw new Error(`OpenAI ${response.status}: ${await response.text()}`);
  const payload=await response.json() as {output_text?:string;output?:Array<{content?:Array<{type?:string;text?:string}>}>};
  const outputText=payload.output_text??payload.output?.flatMap((item)=>item.content??[]).find((item)=>item.type==="output_text")?.text;
  if(!outputText)throw new Error(`No output_text for ${job.id}`);
  const parsed=JSON.parse(outputText) as Omit<EnrichmentResult,"id"|"textHash"|"promptVersion"|"provider"|"model"|"createdAt">;
  parsed.relations=parsed.relations.filter((relation)=>candidates.has(relation.targetId));
  results.push({...parsed,id:job.id,textHash:job.textHash,promptVersion:job.promptVersion,provider:"openai-responses",model,createdAt:new Date().toISOString()});
  console.log(`[${index+1}/${selected.length}] ${job.id}`);
}
const bundle:EnrichmentBundle={version:1,generatedAt:new Date().toISOString(),results};await mkdir(dirname(resolve(output)),{recursive:true});await writeFile(resolve(output),JSON.stringify(bundle,null,2),"utf8");console.log(JSON.stringify({results:results.length,model,output:resolve(output)}));
