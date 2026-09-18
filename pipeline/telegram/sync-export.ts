import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mergeMessages } from "./incremental";
import { normalizeExport } from "./normalize";
import type { TelegramExport } from "./types";

const [inputPath,archivePath="pipeline/telegram/archive/source",handle="staniverse"]=process.argv.slice(2);
if(!inputPath)throw new Error("Usage: tsx pipeline/telegram/sync-export.ts <export-folder|result.json> [archive-folder] [channel-handle]");
const incomingJson=resolve(inputPath.toLowerCase().endsWith(".json")?inputPath:resolve(inputPath,"result.json"));
const incomingRoot=dirname(incomingJson);const archiveRoot=resolve(archivePath);const rawPath=resolve(archiveRoot,"result.json");
const incoming=JSON.parse(await readFile(incomingJson,"utf8")) as TelegramExport;
let previous:TelegramExport={messages:[]};try{previous=JSON.parse(await readFile(rawPath,"utf8")) as TelegramExport}catch{}
if(previous.id&&incoming.id&&previous.id!==incoming.id)throw new Error(`Channel mismatch: ${previous.id} != ${incoming.id}`);
const stats=mergeMessages(previous.messages,incoming.messages);const merged={...previous,...incoming,messages:stats.messages};
await mkdir(archiveRoot,{recursive:true});await writeFile(rawPath,JSON.stringify(merged,null,2),"utf8");

const mediaPaths=new Set<string>();let unavailableMediaReferences=0;const collect=(node:unknown)=>{if(!node||typeof node!=="object")return;const value=node as Record<string,unknown>;for(const key of ["photo","file","video_file","audio_file","voice_message","thumbnail"]){if(typeof value[key]==="string"){const path=value[key] as string;if(path.startsWith("("))unavailableMediaReferences++;else mediaPaths.add(path)}}for(const child of Object.values(value)){if(Array.isArray(child))child.forEach(collect);else if(child&&typeof child==="object")collect(child)}};incoming.messages.forEach(collect);
let copied=0;const missingPaths:string[]=[];for(const relative of mediaPaths){try{const target=resolve(archiveRoot,relative);await mkdir(dirname(target),{recursive:true});await copyFile(resolve(incomingRoot,relative),target);copied++}catch{missingPaths.push(relative)}}
// normalizeExport rebuilds media from the raw export, which drops the public paths
// publish-media carved into the previous canonical. Regenerating them would mean
// re-running the whole ffmpeg pipeline, so carry them across by message + file.
const publications=normalizeExport(merged,handle);let carriedMediaPaths=0;const canonicalPath=resolve("pipeline/telegram/archive/canonical.json");try{const previousCanonical=JSON.parse(await readFile(canonicalPath,"utf8"))as{publications?:{media?:{messageId:number;sourcePath:string;publicPath?:string}[]}[]};const knownMedia=new Map<string,string>();for(const publication of previousCanonical.publications??[])for(const media of publication.media??[])if(media.publicPath)knownMedia.set(`${media.messageId}|${media.sourcePath}`,media.publicPath);for(const publication of publications)for(const media of publication.media??[]){const carried=knownMedia.get(`${media.messageId}|${media.sourcePath}`);if(carried){media.publicPath=carried;carriedMediaPaths++}}}catch{}
await mkdir(dirname(canonicalPath),{recursive:true});await writeFile(canonicalPath,JSON.stringify({version:2,channel:handle,sourceChannelId:merged.id,publications},null,2),"utf8");
const state={version:1,channelId:merged.id,channel:handle,lastMessageId:Math.max(0,...stats.messages.map((message)=>message.id)),messageCount:stats.messages.length,publicationCount:publications.length,syncedAt:new Date().toISOString()};await writeFile(resolve(archiveRoot,"state.json"),JSON.stringify(state,null,2),"utf8");
console.log(JSON.stringify({added:stats.added,updated:stats.updated,unchanged:stats.unchanged,totalMessages:stats.messages.length,publications:publications.length,telegramArticles:publications.filter((item)=>item.kind==="telegram-article").length,mediaReferenced:mediaPaths.size,unavailableMediaReferences,mediaCopied:copied,mediaMissing:missingPaths.length,missingPaths,carriedMediaPaths,archiveRoot}));
