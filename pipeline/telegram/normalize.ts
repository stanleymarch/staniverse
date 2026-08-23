import type { CanonicalMedia, CanonicalPublication, CanonicalSourceLink, TelegramExport, TelegramMessage, TelegramTextEntity } from "./types";
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
  if (message.text_entities?.length) return message.text_entities.map(renderEntity).join("").trim();
  if (typeof message.text === "string") return message.text.trim();
  if (Array.isArray(message.text)) return message.text.map((part) => typeof part === "string" ? part : renderEntity(part)).join("").trim();
  return "";
}

function mediaFor(message: TelegramMessage, order: number): CanonicalMedia | undefined {
  const sourcePath = message.photo ?? message.video_file ?? message.audio_file ?? message.voice_message ?? message.file;
  if (!sourcePath) return;
  const type = message.photo ? "image" : message.video_file || message.mime_type?.startsWith("video/") ? "video" : message.audio_file || message.voice_message || message.mime_type?.startsWith("audio/") ? "audio" : "document";
  return { sourcePath, type, order, messageId: message.id };
}

const urlPattern = /https?:\/\/[^\s<>)\]]+/giu;
const hashtagPattern = /#[\p{L}\p{N}_-]+/gu;

function rawText(message: TelegramMessage): string {
  if (typeof message.text === "string") return message.text;
  if (Array.isArray(message.text)) return message.text.map((part) => typeof part === "string" ? part : part.text).join("");
  return message.text_entities?.map((part) => part.text).join("") ?? "";
}

function linksFor(message: TelegramMessage): CanonicalSourceLink[] {
  const entityLinks = message.text_entities?.flatMap((entity) => entity.href && safeUrl(entity.href) ? [{url:entity.href,messageId:message.id}] : []) ?? [];
  const textLinks = [...rawText(message).matchAll(urlPattern)].map((match) => ({url:match[0],messageId:message.id}));
  return [...new Map([...entityLinks,...textLinks].map((link) => [link.url,link])).values()];
}

export function normalizeExport(data: TelegramExport, handle = "staniverse"): CanonicalPublication[] {
  const threads = buildThreads(data.messages);
  const rootByMessage = new Map(threads.flatMap((thread) => thread.messages.map((message) => [message.id,thread.rootId] as const)));
  return threads.map((thread) => {
    const bodyParts = thread.messages.map(renderText).filter(Boolean);
    const media = thread.messages.map(mediaFor).filter((item): item is CanonicalMedia => Boolean(item));
    const root = thread.messages[0];
    const links = thread.messages.flatMap(linksFor);
    const tags = [...new Set(thread.messages.flatMap((message) => [...rawText(message).matchAll(hashtagPattern)].map((match) => match[0].slice(1).toLocaleLowerCase("ru"))))];
    const relations = [...new Map(links.flatMap((link) => {
      const match = link.url.match(/(?:https?:\/\/)?t\.me\/[\w-]+\/(\d+)/iu);
      const targetRoot = match ? rootByMessage.get(Number(match[1])) : undefined;
      if (targetRoot === undefined || targetRoot === thread.rootId) return [];
      const relation = {targetId:`publication:telegram:${handle}:${targetRoot}`,type:"references" as const,evidence:"telegram-link" as const,confidence:1 as const};
      return [[relation.targetId,relation] as const];
    })).values()];
    return {
      id: `publication:telegram:${handle}:${thread.rootId}`,
      kind: "telegram-post",
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
