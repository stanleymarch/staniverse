import type { CanonicalMedia, CanonicalPublication, CanonicalRelation, CanonicalSourceLink, TelegramExport, TelegramMessage, TelegramRichNode, TelegramTextEntity } from "./types";
import { buildThreads } from "./threading";

const escapeMarkdown = (value: string) => value.replace(/([\\`*_[\]<>])/g, "\\$1");
const safeUrl = (url: string) => /^https?:\/\//i.test(url) ? url : "";

export function renderEntity(entity: TelegramTextEntity): string {
  const text = escapeMarkdown(entity.text);
  if (entity.type === "bold") return `**${text}**`;
  if (entity.type === "italic") return `_${text}_`;
  if (entity.type === "code") return `\`${entity.text.replace(/`/g,"\\`")}\``;
  if (entity.type === "pre") return `\n\`\`\`${entity.language ?? ""}\n${entity.text}\n\`\`\`\n`;
  if (["link", "text_link"].includes(entity.type) && entity.href && safeUrl(entity.href)) return `[${text}](${entity.href})`;
  return text;
}

export function renderText(message: TelegramMessage): string {
  if(message.rich_message) return renderRichBlocks(message.rich_message.blocks);
  if (message.text_entities?.length) return message.text_entities.map(renderEntity).join("").trim();
  if (typeof message.text === "string") return message.text.trim();
  if (Array.isArray(message.text)) return message.text.map((part) => typeof part === "string" ? part : renderEntity(part)).join("").trim();
  return "";
}

function cleanHref(value:string){return value.replaceAll("&amp;","&")}
export function renderRichText(node: TelegramRichNode|TelegramRichNode[]|string|undefined):string {
  if(!node)return "";if(typeof node==="string")return escapeMarkdown(node);
  if(Array.isArray(node))return node.map((part)=>renderRichText(part)).join("");
  const value=Array.isArray(node.text)?node.text.map((part)=>renderRichText(part)).join(""):typeof node.text==="object"?renderRichText(node.text):escapeMarkdown(node.text??"");
  if(node.type==="bold")return `**${value}**`;if(node.type==="italic")return `_${value}_`;if(node.type==="code")return `\`${value}\``;
  if(node.type==="text_link"&&node.href&&safeUrl(cleanHref(node.href)))return `[${value}](${cleanHref(node.href)})`;
  if(node.type==="mention")return value;return value;
}
export function renderRichBlocks(blocks:TelegramRichNode[]):string{return blocks.flatMap((block)=>{
  if(block.type==="heading")return [`${"#".repeat(Math.max(1,Math.min(6,block.level??2)))} ${renderRichText(block.text)}`];
  if(block.type==="paragraph")return [renderRichText(block.text)];
  return [];
}).filter(Boolean).join("\n\n")}

function richPhotos(node:unknown,result:string[]=[]):string[]{if(!node||typeof node!=="object")return result;const value=node as Record<string,unknown>;if(typeof value.photo==="string")result.push(value.photo);for(const child of Object.values(value)){if(Array.isArray(child))child.forEach((item)=>richPhotos(item,result));else if(child&&typeof child==="object")richPhotos(child,result)}return result}
function mediaFor(message: TelegramMessage, order: number): CanonicalMedia[] {
  const sourcePath = message.photo ?? message.video_file ?? message.audio_file ?? message.voice_message ?? message.file;
  const valid=(value:string|undefined):value is string=>Boolean(value&&!value.startsWith("("));
  const primary=valid(sourcePath)?[{ sourcePath, type:message.photo ? "image" as const : message.video_file || message.mime_type?.startsWith("video/") ? "video" as const : message.audio_file || message.voice_message || message.mime_type?.startsWith("audio/") ? "audio" as const : "document" as const, order, messageId: message.id }]:[];
  return [...primary,...richPhotos(message.rich_message).filter(valid).map((photo,index)=>({sourcePath:photo,type:"image" as const,order:order+index+primary.length,messageId:message.id}))];
}

const urlPattern = /https?:\/\/[^\s<>)\]]+/giu;
const hashtagPattern = /#[\p{L}\p{N}_-]+/gu;

function rawText(message: TelegramMessage): string {
  if(message.rich_message)return renderRichBlocks(message.rich_message.blocks);
  if (typeof message.text === "string") return message.text;
  if (Array.isArray(message.text)) return message.text.map((part) => typeof part === "string" ? part : part.text).join("");
  return message.text_entities?.map((part) => part.text).join("") ?? "";
}

function linksFor(message: TelegramMessage): CanonicalSourceLink[] {
  const entityLinks = message.text_entities?.flatMap((entity) => entity.href && safeUrl(entity.href) ? [{url:entity.href,messageId:message.id}] : []) ?? [];
  const textLinks = [...rawText(message).matchAll(urlPattern)].map((match) => ({url:match[0],messageId:message.id}));
  const richLinks:string[]=[];const collect=(node:unknown)=>{if(!node||typeof node!=="object")return;const value=node as Record<string,unknown>;if(typeof value.href==="string"&&safeUrl(cleanHref(value.href)))richLinks.push(cleanHref(value.href));for(const child of Object.values(value)){if(Array.isArray(child))child.forEach(collect);else if(child&&typeof child==="object")collect(child)}};collect(message.rich_message);
  return [...new Map([...entityLinks,...textLinks,...richLinks.map((url)=>({url,messageId:message.id}))].map((link) => [link.url,link])).values()];
}

export function normalizeExport(data: TelegramExport, handle = "staniverse"): CanonicalPublication[] {
  const threads = buildThreads(data.messages);
  const rootByMessage = new Map(threads.flatMap((thread) => thread.messages.map((message) => [message.id,thread.rootId] as const)));
  return threads.map((thread) => {
    const bodyParts = thread.messages.map(renderText).filter(Boolean);
    const media = thread.messages.flatMap(mediaFor);
    const root = thread.messages[0];
    const links = thread.messages.flatMap(linksFor);
    const tags = [...new Set(thread.messages.flatMap((message) => [...rawText(message).matchAll(hashtagPattern)].map((match) => match[0].slice(1).toLocaleLowerCase("ru"))))];
    const relationMap=new Map<string,CanonicalRelation>();for(const link of links){
      const match = link.url.match(/(?:https?:\/\/)?t\.me\/[\w-]+\/(\d+)/iu);
      const targetRoot = match ? rootByMessage.get(Number(match[1])) : undefined;
      const knownTarget=/https?:\/\/(?:www\.)?nearventure\.ru(?:\/|$)/iu.test(link.url)?"project:nearventure":undefined;
      if(knownTarget){relationMap.set(knownTarget,{targetId:knownTarget,type:"references",evidence:"known-public-url",confidence:1});continue}
      if (targetRoot === undefined || targetRoot === thread.rootId) continue;
      const targetId=`publication:telegram:${handle}:${targetRoot}`;relationMap.set(targetId,{targetId,type:"references",evidence:"telegram-link",confidence:1});
    }const relations=[...relationMap.values()];
    return {
      id: `publication:telegram:${handle}:${thread.rootId}`,
      kind: root.rich_message ? "telegram-article" : "telegram-post",
      sourceId: String(thread.rootId),
      sourceUrl: `https://t.me/${handle}/${thread.rootId}`,
      date: root.date,
      editedDate: thread.messages.map((message) => message.edited).filter(Boolean).at(-1),
      threadIds: thread.messages.map((message) => String(message.id)),
      body: bodyParts.join("\n\n"),
      tags,
      links,
      relations,
      media,
      rawMessageIds: thread.messages.map((message) => message.id),
    };
  });
}
