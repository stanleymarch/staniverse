import { isMediaMessage } from "./media";
import type { PublicationGroup, TelegramMessage } from "./types";

 const continuationMarker = /(?:продолжение|начало|часть)/iu;
 const numberedContinuation = /(?:продолжение|начало|часть)\s*(?:поста)?\s*(?:№|#|:)?\s*(\d+)/giu;
 const telegramPostLink = /(?:https?:\/\/)?(?:www\.)?t\.me\/(?:s\/)?([\w-]+)\/(\d+)/giu;
/**
 * A post that OPENS with a continuation phrase and names no explicit target continues
 * the previous publication: the author said "продолжение поста" / "часть 2/3" /
 * "начало здесь", and adjacency only picks which post is being continued. A bare
 * "начало" is not enough — it must point at a place ("здесь", "в предыдущем посте"),
 * otherwise "начало июня выдалось загруженным" would swallow the previous post.
 */
const continuationLead = /^\W{0,3}\s*(?:\(?\s*(?:продолжение(?:\s+этого)?\s+поста?(?!\s*[№#:]\s*\d)|начало\s+(?:здесь|в\s+предыдущем\s+посте))\s*\)?|часть\s*\d+\s*\/\s*\d+)(?:[\s:;.,—–-]|$)/iu;

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


/**
 * Telegram albums are one posting action that carries several media items and at most one
 * caption; the caption is the message the album is anchored to, which is also the id the
 * published Quartz site used for those posts.
 *
 * The archive marks albums with `grouped_id`. Some exports omit that field, but the album
 * shape survives: consecutive ids, timestamps no more than two seconds apart, every member
 * a media message, and at most one member carrying text. The small tolerance covers Telegram
 * splitting one ten-item upload across adjacent seconds; separate captions still stay separate.
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
    const previousTime = previous ? Number(previous.date_unixtime) || (previous.date ? Date.parse(previous.date) / 1000 : Number.NaN) : Number.NaN;
    const currentTime = Number(message.date_unixtime) || (message.date ? Date.parse(message.date) / 1000 : Number.NaN);
    const samePosting = previous !== undefined
      && previous.id + 1 === message.id
      && Number.isFinite(previousTime)
      && Number.isFinite(currentTime)
      && Math.abs(currentTime - previousTime) <= 2
      && run.length < 10;
    if (!samePosting) flushRun();
    run.push(message);
  }
  flushRun();
  return anchors;
}

export function buildPublications(input: TelegramMessage[]): PublicationGroup[] {
  const messages = [...new Map(input.filter((message) => message.type !== "service").map((message) => [message.id, message])).values()].sort((a, b) => a.id - b.id);
  const anchors = albumAnchors(messages);
  const rootOf = new Map<number, number>();
  const membersOf = new Map<number, number[]>();
  for (const message of messages) {
    const root = anchors.get(message.id) ?? message.id;
    rootOf.set(message.id, root);
    membersOf.set(root, [...membersOf.get(root) ?? [], message.id]);
  }
  // Explicit continuations (a t.me link or a numbered target) are relations, not merges:
  // the author points at a specific post, which keeps its own page. A lead phrase with
  // no target merges into the previous publication, and chains merge transitively
  // because each later post re-aims at the root its predecessor already joined.
  const ids = new Set(messages.map((message) => message.id));
  let previousRoot: number | undefined;
  for (const message of messages) {
    const ownRoot = rootOf.get(message.id)!;
    const text = plainText(message).trimStart();
    if (previousRoot !== undefined && ownRoot !== previousRoot && continuationLead.test(text) && !hasExplicitTarget(text)) {
      for (const memberId of membersOf.get(ownRoot) ?? []) rootOf.set(memberId, previousRoot);
      membersOf.set(previousRoot, [...(membersOf.get(previousRoot) ?? []), ...(membersOf.get(ownRoot) ?? [])]);
      membersOf.delete(ownRoot);
    } else {
      previousRoot = rootOf.get(message.id)!;
    }
  }
  const grouped = new Map<number, TelegramMessage[]>();
  for (const message of messages) {
    const rootId = rootOf.get(message.id) ?? message.id;
    grouped.set(rootId, [...grouped.get(rootId) ?? [], message]);
  }
  return [...grouped.entries()]
    .map(([rootId, group]) => ({ rootId, messages: group.sort((a, b) => a.id - b.id) }))
    .sort((a, b) => a.rootId - b.rootId);
  function hasExplicitTarget(text: string) {
    // A numbered target needs its separator («продолжение поста №5», «часть: 3»);
    // a bare «часть 2/3» numbers the part itself and continues the previous post.
    if (/(?:продолжение|начало|часть)\s*(?:поста)?\s*[№#:]\s*\d+/iu.test(text)) return true;
    telegramPostLink.lastIndex = 0;
    for (const match of text.matchAll(telegramPostLink)) if (ids.has(Number(match[2]))) return true;
    return false;
  }
}
