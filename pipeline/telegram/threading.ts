import { isMediaMessage } from "./media";
import type { PublicationGroup, TelegramMessage } from "./types";

const continuationMarker = /(?:продолжение|начало|часть)/iu;
const numberedContinuation = /(?:продолжение|начало|часть)\s*(?:поста)?\s*(?:№|#|:)?\s*(\d+)/giu;
const telegramPostLink = /(?:https?:\/\/)?(?:www\.)?t\.me\/(?:s\/)?([\w-]+)\/(\d+)/giu;

/** The local post id a Telegram URL points at, or `undefined` for another channel. */
export function telegramPostIdForHandle(url: string, handle: string): number | undefined {
  const match = url.match(/^(?:https?:\/\/)?(?:www\.)?t\.me\/(?:s\/)?([\w-]+)\/(\d+)(?:[/?#]|$)/iu);
  if (!match || match[1].toLocaleLowerCase() !== handle.toLocaleLowerCase()) return undefined;
  return Number(match[2]);
}

function plainText(message: TelegramMessage): string {
  if (typeof message.text === "string") return message.text;
  if (Array.isArray(message.text)) return message.text.map((part) => typeof part === "string" ? part : part.text).join("");
  return "";
}

/**
 * The post this message explicitly continues: a `t.me/<handle>/<id>` link inside a
 * continuation phrase, or the post number written after that phrase. Nothing is inferred
 * from mere adjacency — the author has to say it.
 */
export function continuationSource(message: TelegramMessage, ids: Set<number>, handle: string): number | undefined {
  const text = plainText(message);
  const candidates: number[] = [];
  if (continuationMarker.test(text)) {
    telegramPostLink.lastIndex = 0;
    for (const match of text.matchAll(telegramPostLink)) {
      if (match[1].toLocaleLowerCase() === handle.toLocaleLowerCase()) candidates.push(Number(match[2]));
    }
  }
  numberedContinuation.lastIndex = 0;
  for (const match of text.matchAll(numberedContinuation)) candidates.push(Number(match[1]));
  return candidates.find((id) => id !== message.id && ids.has(id));
}

const instant = (message: TelegramMessage) => message.date_unixtime ?? message.date;

/**
 * Telegram albums are one posting action that carries several media items and at most one
 * caption; the caption is the message the album is anchored to, which is also the id the
 * published Quartz site used for those posts.
 *
 * The archive marks albums with `grouped_id`. This export omits that field, but the album
 * shape survives: consecutive ids, one identical timestamp, every member a media message
 * and at most one of them carrying text. Posts that merely happen to share a second carry
 * their own text — two captions never collapse into one publication.
 */
function albumAnchors(messages: TelegramMessage[]): Map<number, number> {
  const anchors = new Map<number, number>();

  const explicit = new Map<string, TelegramMessage[]>();
  for (const message of messages) {
    if (message.grouped_id === undefined) continue;
    const group = String(message.grouped_id);
    explicit.set(group, [...explicit.get(group) ?? [], message]);
  }
  for (const group of explicit.values()) {
    const ordered = [...group].sort((a, b) => a.id - b.id);
    const head = ordered.find((message) => plainText(message).trim() !== "" && !message.rich_message) ?? ordered[0];
    for (const message of ordered) anchors.set(message.id, head.id);
  }

  let run: TelegramMessage[] = [];
  let album: TelegramMessage[] = [];
  const flushAlbum = () => {
    const captions = album.filter((message) => plainText(message).trim() !== "" && !message.rich_message);
    if (album.length > 1 && captions.length <= 1) {
      const head = captions[0] ?? album[0];
      for (const message of album) if (!anchors.has(message.id)) anchors.set(message.id, head.id);
    }
    album = [];
  };
  const flushRun = () => {
    for (const message of run) {
      if (isMediaMessage(message) && !message.rich_message) album.push(message);
      else flushAlbum();
    }
    flushAlbum();
    run = [];
  };
  for (const [index, message] of messages.entries()) {
    const previous = messages[index - 1];
    const samePosting = previous !== undefined && previous.id + 1 === message.id && instant(previous) === instant(message) && instant(message) !== undefined;
    if (!samePosting) flushRun();
    run.push(message);
  }
  flushRun();
  return anchors;
}

/** One publication: a single Telegram message, or the album that message anchors. */
export function buildPublications(input: TelegramMessage[]): PublicationGroup[] {
  const messages = [...new Map(input.filter((message) => message.type !== "service").map((message) => [message.id, message])).values()].sort((a, b) => a.id - b.id);
  const anchors = albumAnchors(messages);
  const grouped = new Map<number, TelegramMessage[]>();
  for (const message of messages) {
    const rootId = anchors.get(message.id) ?? message.id;
    grouped.set(rootId, [...grouped.get(rootId) ?? [], message]);
  }
  return [...grouped.entries()]
    .map(([rootId, group]) => ({ rootId, messages: group.sort((a, b) => a.id - b.id) }))
    .sort((a, b) => a.rootId - b.rootId);
}
