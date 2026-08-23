import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ReviewBundle } from "./types";

const [status,key,note="",file="pipeline/enrichment/review/decisions.json"]=process.argv.slice(2);
if(!["accepted","rejected"].includes(status)||!key)throw new Error("Usage: tsx pipeline/enrichment/review.ts <accepted|rejected> <result::kind::value> [note] [file]");
let bundle:ReviewBundle={version:1,decisions:[]};try{bundle=JSON.parse(await readFile(resolve(file),"utf8"))}catch{}
bundle.decisions=bundle.decisions.filter((decision)=>decision.key!==key);
bundle.decisions.push({key,status:status as "accepted"|"rejected",reviewedAt:new Date().toISOString(),...(note?{note}:{})});
await mkdir(dirname(resolve(file)),{recursive:true});
await writeFile(resolve(file),JSON.stringify(bundle,null,2)+"\n","utf8");
console.log(JSON.stringify({key,status,file:resolve(file)}));
