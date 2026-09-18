import { messageMedia } from "./media";
import { buildPublications, continuationSource, telegramPostIdForHandle } from "./threading";
import type { CanonicalPublication, CanonicalRelation, CanonicalSourceLink, TelegramExport, TelegramMessage, TelegramRichNode, TelegramTextEntity } from "./types";

const escapeMarkdown = (value: string) => value.replace(/([\\`*_[\]<>])/g, "\\$1");
const safeUrl = (url: string) => /^https?:\/\//i.test(url) ? url : "";

/**
 * Markdown emphasis cannot span a blank line, and Telegram entities routinely cover
 * the line breaks around a phrase, so a naive `**${text}**` puts the closing marker
 * into the next paragraph and renders as literal asterisks. Whitespace stays outside
 * the markers, a blank line splits the span into separate wrapped segments, and an
 * empty emphasis is left unwrapped.
 */
const wrapEmphasis = (marker: string, value: string) =>
  value.split(/\n{2,}/).map((segment) => {
    const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(segment);
    const core = match?.[2] ?? "";
    return core ? `${match![1]}${marker}${core}${marker}${match![3]}` : segment;
  }).join("\n\n");

export function renderEntity(entity: TelegramTextEntity): string {
  const text = escapeMarkdown(entity.text);
  if (entity.type === "bold") return wrapEmphasis("**", text);
  if (entity.type === "italic") return wrapEmphasis("_", text);
  if (entity.type === "code") return `\`${entity.text.replace(/`/g, "\\`")}\``;
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
  if(node.type==="bold")return wrapEmphasis("**",value);if(node.type==="italic")return wrapEmphasis("_",value);if(node.type==="code")return `\`${value}\``;
  if(node.type==="text_link"&&node.href&&safeUrl(cleanHref(node.href)))return `[${value}](${cleanHref(node.href)})`;
  if(node.type==="mention")return value;return value;
}
const mediaMarker = (sourcePath: string) => `<!--telegram-media:${encodeURIComponent(sourcePath)}-->`;

export function renderRichBlocks(blocks:TelegramRichNode[]):string{return blocks.flatMap((block)=>{
  if(block.type==="heading")return [`${"#".repeat(Math.max(1,Math.min(6,block.level??2)))} ${renderRichText(block.text)}`];
  if(block.type==="paragraph")return [renderRichText(block.text)];
  if(block.type==="photo"&&block.photo){
    const caption=renderRichText(block.caption);
    return [mediaMarker(block.photo),caption].filter(Boolean);
  }
  if(["slideshow","collage"].includes(block.type??"")&&block.items){
    return block.items.flatMap((item)=>{
      if(item.photo)return [mediaMarker(item.photo),renderRichText(item.caption)].filter(Boolean);
      return renderRichBlocks([item]);
    });
  }
  return [];
}).filter(Boolean).join("\n\n")}

const urlPattern = /https?:\/\/[^\s<>)\]]+/giu;
const hashtagPattern = /#[\p{L}\p{N}_-]+/gu;
const nearventureUrl = /https?:\/\/(?:www\.)?nearventure\.ru(?:\/|$)/iu;

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

/** Evidence strength for one source-target pair, so a link that the author also marks as
 * a continuation is recorded as a continuation instead of two competing edges. */
const relationStrength: Record<string, number> = { references: 0, "reply-to": 1, continues: 2 };

/**
 * Relations a publication earns from its own messages: the posts it links to, the post it
 * answers, and the post it explicitly continues. Nothing here is inferred from adjacency —
 * a neighbouring message without a reply link or a continuation phrase stays unrelated.
 */
function relationsFor(group: { rootId: number; messages: TelegramMessage[] }, handle: string, publicationByRoot: Map<number, number>, knownIds: Set<number>): CanonicalRelation[] {
  const byTarget = new Map<string, CanonicalRelation>();
  const add = (relation: CanonicalRelation) => {
    const current = byTarget.get(relation.targetId);
    if (current && relationStrength[current.type] >= relationStrength[relation.type]) return;
    byTarget.set(relation.targetId, relation);
  };
  const publicationOf = (messageId: number | undefined) => {
    const root = messageId === undefined ? undefined : publicationByRoot.get(messageId);
    return root === undefined || root === group.rootId ? undefined : `publication:telegram:${handle}:${root}`;
  };
  for (const message of group.messages) {
    for (const link of linksFor(message)) {
      if (nearventureUrl.test(link.url)) { add({targetId:"project:nearventure",type:"references",evidence:"known-public-url",confidence:1}); continue; }
      const targetId = publicationOf(telegramPostIdForHandle(link.url, handle));
      if (targetId) add({targetId,type:"references",evidence:"telegram-link",confidence:1});
    }
    const replyTarget = publicationOf(message.reply_to_message_id);
    if (replyTarget) add({targetId:replyTarget,type:"reply-to",evidence:"telegram-reply",confidence:1});
    const continuation = publicationOf(continuationSource(message, knownIds, handle));
    if (continuation) add({targetId:continuation,type:"continues",evidence:"continuation",confidence:1});
  }
  return [...byTarget.values()];
}

export function normalizeExport(data: TelegramExport, handle = "staniverse"): CanonicalPublication[] {
  const groups = buildPublications(data.messages);
  const publicationByRoot = new Map(groups.flatMap((group) => group.messages.map((message) => [message.id, group.rootId] as const)));
  const knownIds = new Set(publicationByRoot.keys());
  return groups.map((group) => {
    const anchor = group.messages.find((message) => message.id === group.rootId) ?? group.messages[0];
    const bodyParts = group.messages.map(renderText).filter(Boolean);
    const media = group.messages.flatMap(messageMedia);
    const tags = [...new Set(group.messages.flatMap((message) => [...rawText(message).matchAll(hashtagPattern)].map((match) => match[0].slice(1).toLocaleLowerCase("ru"))))];
    return {
      id: `publication:telegram:${handle}:${group.rootId}`,
      kind: anchor.rich_message ? "telegram-article" : "telegram-post",
      sourceId: String(group.rootId),
      sourceUrl: `https://t.me/${handle}/${group.rootId}`,
      date: anchor.date,
      editedDate: group.messages.map((message) => message.edited).filter(Boolean).at(-1),
      threadIds: group.messages.map((message) => String(message.id)),
      body: bodyParts.join("\n\n"),
      tags,
      links: group.messages.flatMap(linksFor),
      relations: relationsFor(group, handle, publicationByRoot, knownIds),
      media,
      rawMessageIds: group.messages.map((message) => message.id),
    };
  });
}
