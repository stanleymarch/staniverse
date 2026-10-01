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
      // A forwarded message is its own posting action and never joins an album
      // run: a forward adjacent in time must not capture authored neighbours.
      if (isMediaMessage(message) && !message.rich_message && !message.forwarded_from) album.push(message);
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

export function buildPublications(input: TelegramMessage[], opts: { liveMergeHours?: number } = {}): PublicationGroup[] {
  const messages = [...new Map(input.filter((message) => message.type !== "service").map((message) => [message.id, message])).values()].sort((a, b) => a.id - b.id);
  const anchors = albumAnchors(messages);
  const rootOf = new Map<number, number>();
  const membersOf = new Map<number, number[]>();
  for (const message of messages) {
    const root = anchors.get(message.id) ?? message.id;
    rootOf.set(message.id, root);
    membersOf.set(root, [...membersOf.get(root) ?? [], message.id]);
  }

  if (opts.liveMergeHours !== undefined) mergeReplyLives(messages, anchors, rootOf, membersOf, opts.liveMergeHours);

  // Explicit continuations (a t.me link or a numbered target) are relations, not merges:
  // the author points at a specific post, which keeps its own page. A lead phrase with
  // no target merges into the previous publication, and chains merge transitively
  // because each later post re-aims at the root its predecessor already joined.
  const ids = new Set(messages.map((message) => message.id));
  let previousRoot: number | undefined;
  for (const message of messages) {
    // A forward cannot continue an authored chain: skipping it also keeps it
    // from becoming the chain's merge target for the post that follows.
    if (message.forwarded_from) continue;
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

  /** A life channel's live report: a reply chain the author keeps adding to over a
   * few hours is one evening at an event, not a series of publications. Every reply
   * edge is examined at album-anchor level — a whole album is the unit that answers —
   * and the chain closes a segment once the gap to its latest message exceeds the
   * threshold. A topic picked back up days later therefore opens its own publication,
   * still tied to the earlier one by the reply-to relation the normalizer records. */
  function mergeReplyLives(messages: TelegramMessage[], anchors: Map<number, number>, rootOf: Map<number, number>, membersOf: Map<number, number[]>, hours: number) {
    const chainOf = new Map<number, number>(messages.map((message) => [message.id, message.id]));
    const find = (id: number): number => {
      let root = id;
      while (chainOf.get(root) !== root) root = chainOf.get(root)!;
      for (let walk = id; walk !== root;) { const next = chainOf.get(walk)!; chainOf.set(walk, root); walk = next; }
      return root;
    };
    for (const message of messages) {
      const target = message.reply_to_message_id;
      if (target === undefined || !chainOf.has(target)) continue;
      const from = find(anchors.get(message.id) ?? message.id);
      const into = find(anchors.get(target) ?? target);
      if (from !== into) chainOf.set(from, into);
    }
    const latest = new Map<number, { id: number; time: number }>();
    for (const message of messages) {
      // Album members ride on their anchor; only anchors open or continue a segment.
      if ((anchors.get(message.id) ?? message.id) !== message.id) continue;
      const chain = find(message.id);
      const time = Number(message.date_unixtime) || (message.date ? Date.parse(message.date) / 1000 : Number.NaN);
      const last = latest.get(chain);
      if (last && Number.isFinite(time) && Number.isFinite(last.time) && time - last.time <= hours * 3600) {
        const from = rootOf.get(message.id)!;
        const into = rootOf.get(last.id)!;
        if (from !== into) {
          for (const memberId of membersOf.get(from) ?? []) rootOf.set(memberId, into);
          membersOf.set(into, [...(membersOf.get(into) ?? []), ...(membersOf.get(from) ?? [])]);
          membersOf.delete(from);
        }
      }
      latest.set(chain, { id: message.id, time });
    }
  }
}
