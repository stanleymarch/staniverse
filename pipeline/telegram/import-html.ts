/**
 * Telegram Desktop exports a chat either as `result.json` or as HTML pages
 * (`messages.html`, `messages2.html`, … plus `photos/`, `video_files/`, `files/`).
 * The HTML export keeps everything the site publishes — author text with its entities,
 * replies, albums, media paths and Telegram Article blocks — but drops the fields the
 * pipeline reads: the channel id, edit timestamps, `grouped_id` and the target of a reply
 * into another chat. This converter rebuilds the `result.json` shape from the exported
 * pages, so an HTML export travels the same import path (`telegram:sync`,
 * `telegram:import`) as a JSON one.
 *
 * Usage:
 *   tsx pipeline/telegram/import-html.ts <export-folder> <output.json> [--previous <result.json>]
 *
 * `--previous` points at an earlier JSON export of the same channel. HTML pages carry no
 * edit timestamp and no channel id, so those two fields are inherited from it by message
 * id when available; every other field comes from the HTML pages themselves.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { TelegramExport, TelegramMessage, TelegramRichMessage, TelegramRichNode, TelegramTextEntity } from "./types";

interface Element { tag: string; attrs: Record<string, string>; children: (Element | string)[] }

const voidTags = new Set(["br", "img", "meta", "link", "input", "hr", "source", "col", "base", "area", "embed", "param", "track", "wbr"]);
const rawTags = new Set(["script", "style"]);
const namedEntities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", laquo: "«", raquo: "»", mdash: "—", ndash: "–", hellip: "…" };

const decodeEntities = (value: string) => value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (entity, body: string) => {
  if (body.startsWith("#")) {
    const hex = body[1] === "x" || body[1] === "X";
    const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
  }
  return namedEntities[body] ?? entity;
});

const parseAttributes = (raw: string) => {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(/([:@a-zA-Z_][-.:\w]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
};

/** One stack walk over the generated pages; Telegram writes well-formed, plainly nested HTML. */
function parseDocument(html: string): Element {
  const root: Element = { tag: "#root", attrs: {}, children: [] };
  const stack: Element[] = [root];
  let index = 0;
  while (index < html.length) {
    const start = html.indexOf("<", index);
    if (start === -1) {
      const text = html.slice(index);
      if (text.trim()) stack[stack.length - 1].children.push(decodeEntities(text));
      break;
    }
    if (start > index) stack[stack.length - 1].children.push(decodeEntities(html.slice(index, start)));
    if (html.startsWith("<!--", start)) {
      const end = html.indexOf("-->", start);
      index = end === -1 ? html.length : end + 3;
      continue;
    }
    const end = html.indexOf(">", start);
    const inside = html.slice(start + 1, end);
    index = end + 1;
    if (inside.startsWith("!") || inside.startsWith("?")) continue;
    const name = /^\/?\s*([a-zA-Z][\w-]*)/.exec(inside)?.[1]?.toLowerCase();
    if (!name) continue;
    if (inside.startsWith("/")) {
      const open = stack.map((node) => node.tag).lastIndexOf(name);
      if (open > 0) stack.length = open;
      continue;
    }
    const node: Element = { tag: name, attrs: parseAttributes(inside.slice(inside.indexOf(name) + name.length)), children: [] };
    stack[stack.length - 1].children.push(node);
    if (voidTags.has(name) || inside.endsWith("/")) continue;
    if (rawTags.has(name)) {
      const close = html.toLowerCase().indexOf(`</${name}`, index);
      index = close === -1 ? html.length : close;
      continue;
    }
    stack.push(node);
  }
  return root;
}

const walk = (node: Element, visit: (node: Element) => void) => {
  visit(node);
  for (const child of node.children) if (typeof child !== "string") walk(child, visit);
};

const classList = (node: Element) => (node.attrs.class ?? "").split(/\s+/).filter(Boolean);
const hasClass = (node: Element, name: string) => classList(node).includes(name);
const elements = (node: Element) => node.children.filter((child): child is Element => typeof child !== "string");
/** Inline text of an element: a `<br>` is the line break the JSON export keeps in the
 * entity's own text, so it survives inside emphasis and quotes. */
const text = (node: Element): string => node.children.map((child) => typeof child === "string" ? child : child.tag === "br" ? "\n" : text(child)).join("");

const trimEdges = (children: (Element | string)[]): (Element | string)[] => {
  const trimmed = [...children];
  while (trimmed.length) {
    const first = trimmed[0];
    if (typeof first !== "string" || first.trim()) break;
    trimmed.shift();
  }
  while (trimmed.length) {
    const last = trimmed[trimmed.length - 1];
    if (typeof last !== "string" || last.trim()) break;
    trimmed.pop();
  }
  const first = trimmed[0];
  if (typeof first === "string") trimmed[0] = first.replace(/^\s+/, "");
  const last = trimmed[trimmed.length - 1];
  if (typeof last === "string") trimmed[trimmed.length - 1] = last.replace(/\s+$/, "");
  return trimmed;
};

/** A quoted reply repeats the message it answers, and a Telegram Article keeps its own
 * media and links inside `div.text`: neither is an attachment of the answering message.
 * Both sets hold what lies *inside* such an element, never the element itself. */
function innerOf(root: Element, classNames: string[]): WeakSet<Element> {
  const inner = new WeakSet<Element>();
  walk(root, (node) => {
    if (!classNames.some((name) => hasClass(node, name))) return;
    walk(node, (child) => { if (child !== node) inner.add(child); });
  });
  return inner;
}

const mimeByExtension: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".m4a": "audio/mp4", ".wav": "audio/wav",
  ".pdf": "application/pdf", ".tgs": "application/x-tgsticker",
};

/** The one attachment a message carries; Telegram tags its anchor with the media kind. */
function mediaOf(root: Element, excluded: WeakSet<Element>): Partial<TelegramMessage> {
  let found: Partial<TelegramMessage> | undefined;
  walk(root, (node) => {
    if (found || node.tag !== "a" || excluded.has(node)) return;
    const path = node.attrs.href;
    if (!path || /^(?:https?:|#|mailto:)/i.test(path)) return;
    if (hasClass(node, "pagination")) return;
    const classes = classList(node);
    const mime = mimeByExtension[path.slice(path.lastIndexOf(".")).toLowerCase()];
    if (classes.includes("photo_wrap") || classes.includes("media_photo")) found = { photo: path, ...(mime ? { mime_type: mime } : {}) };
    else if (classes.includes("video_file_wrap") || classes.includes("animated_wrap") || classes.includes("media_video")) found = { video_file: path, mime_type: mime ?? "video/mp4" };
    else if (classes.includes("media_audio_file")) found = { audio_file: path, mime_type: mime ?? "audio/mpeg" };
    else if (classes.includes("media_voice_message")) found = { voice_message: path, mime_type: mime ?? "audio/ogg" };
    else if (classes.includes("media_file")) found = { file: path, ...(mime ? { mime_type: mime } : {}) };
    else if (node.children.some((child) => typeof child !== "string" && child.tag === "img")) found = { photo: path, ...(mime ? { mime_type: mime } : {}) };
    else if (mime?.startsWith("video/")) found = { video_file: path, mime_type: mime };
    else if (mime?.startsWith("audio/")) found = { audio_file: path, mime_type: mime };
  });
  return found ?? {};
}

const telegramPostPath = /^https?:\/\/t\.me\/([A-Za-z0-9_]{3,32})$/i;
/** A URL the author pasted reads as itself; Telegram renders it as an anchor, the JSON
 * export keeps it as plain `link` text, and so does the body the site publishes. */
const withoutScheme = (value: string) => value.replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();

/** A Telegram entity as the JSON export writes it: a mention stays text, a custom emoji
 * keeps its glyph, and only real sources become links. */
function entityFor(node: Element, inner: string): TelegramTextEntity | undefined {
  if (node.tag !== "a") return undefined;
  const href = node.attrs.href ?? "";
  const mention = telegramPostPath.exec(href);
  if (!/^https?:/i.test(href)) return { type: "custom_emoji", text: inner };
  if (mention && inner.toLowerCase() === `@${mention[1].toLowerCase()}`) return { type: "mention", text: inner };
  if (withoutScheme(inner) === withoutScheme(href)) return { type: "link", text: inner };
  if (/[?&]q=%23/.test(href)) return { type: "hashtag", text: inner };
  if (/[?&]q=%24/.test(href)) return { type: "cashtag", text: inner };
  if (/^#go_to_message\d+$|\.html#go_to_message\d+$/.test(href)) return { type: "plain", text: inner };
  return { type: "text_link", text: inner, href };
}

function entitiesOf(children: (Element | string)[]): TelegramTextEntity[] {
  const list: TelegramTextEntity[] = [];
  const push = (entity: TelegramTextEntity) => {
    if (!entity.text) return;
    const last = list[list.length - 1];
    if (last?.type === "plain" && entity.type === "plain") last.text += entity.text;
    else list.push(entity);
  };
  for (const child of children) {
    if (typeof child === "string") { push({ type: "plain", text: child }); continue; }
    const inner = child.tag === "br" ? "\n" : text(child);
    if (child.tag === "br") { push({ type: "plain", text: "\n" }); continue; }
    const link = entityFor(child, inner);
    if (link) { push(link); continue; }
    if (hasClass(child, "spoiler")) { push({ type: "spoiler", text: inner }); continue; }
    const kind = child.tag === "strong" ? "bold"
      : child.tag === "em" ? "italic"
        : child.tag === "code" ? "code"
          : child.tag === "pre" ? "pre"
            : child.tag === "s" ? "strikethrough"
              : child.tag === "blockquote" ? "blockquote"
                : undefined;
    if (kind) push({ type: kind, text: inner });
    else push({ type: "plain", text: inner });
  }
  return list;
}

const empty = (): TelegramRichNode => ({ type: "empty" });
const concat = (parts: TelegramRichNode[]): TelegramRichNode => parts.length === 1 ? parts[0] : parts.length ? { type: "concat", text: parts } : empty();

/** Telegram Article text as the JSON export nests it: `plain`, `concat`, `mention`,
 * `text_link` and the inline styles, with `<br>` as a line break. */
function richTextOf(children: (Element | string)[]): TelegramRichNode {
  return concat(children.map((child): TelegramRichNode => {
    if (typeof child === "string") return { type: "plain", text: child };
    const inner = () => richTextOf(child.children);
    if (child.tag === "br") return { type: "plain", text: "\n" };
    if (child.tag === "a") {
      const href = child.attrs.href ?? "";
      const mention = telegramPostPath.exec(href);
      const plain = text(child);
      if (!/^https?:/i.test(href)) return { type: "custom_emoji", text: plain };
      if (mention && plain.toLowerCase() === `@${mention[1].toLowerCase()}`) return { type: "mention", text: { type: "plain", text: plain } };
      return { type: "text_link", href, text: inner() };
    }
    if (child.tag === "strong") return { type: "bold", text: inner() };
    if (child.tag === "em") return { type: "italic", text: inner() };
    if (child.tag === "code") return { type: "code", text: inner() };
    if (child.tag === "s") return { type: "strikethrough", text: inner() };
    if (hasClass(child, "spoiler")) return { type: "spoiler", text: inner() };
    return inner();
  }).filter((part) => !(part.type === "plain" && part.text === "")));
}

const caption = (node: Element | undefined): TelegramRichNode => {
  const captionText = node ? elements(node).find((child) => hasClass(child, "rich_caption_text")) : undefined;
  const value = captionText ? text(captionText).trim() : "";
  return { text: value ? { type: "plain", text: value } : empty(), credit: empty() };
};

function mediaItem(figure: Element): TelegramRichNode {
  const anchor = elements(figure).flatMap((child) => { const all: Element[] = []; walk(child, (node) => { if (node.tag === "a") all.push(node); }); return all; })[0];
  const path = anchor?.attrs.href ?? "";
  const kind = figure.attrs["data-rich-kind"];
  const mime = mimeByExtension[path.slice(path.lastIndexOf(".")).toLowerCase()];
  const ownCaption = caption(elements(figure).find((child) => child.tag === "figcaption"));
  if (kind === "video" || mime?.startsWith("video/")) return { type: "video", media_type: "video_file", video_file: path, mime_type: mime ?? "video/mp4", caption: ownCaption };
  return { type: "photo", photo: path, caption: ownCaption };
}

/** One Telegram Article: headings, paragraphs, single media and media groups in order. */
function richMessage(node: Element): TelegramRichMessage {
  const blocks: TelegramRichNode[] = [];
  for (const child of elements(node)) {
    if (/^h[1-6]$/.test(child.tag)) { blocks.push({ type: "heading", level: Number(child.attrs["data-level"]) || Number(child.tag[1]), text: richTextOf(trimEdges(child.children)) }); continue; }
    if (child.tag === "p") { blocks.push({ type: "paragraph", text: richTextOf(trimEdges(child.children)) }); continue; }
    if (child.tag === "section") {
      const items: TelegramRichNode[] = [];
      walk(child, (inner) => { if (inner.tag === "figure" && hasClass(inner, "rich_media_item")) items.push(mediaItem(inner)); });
      blocks.push({ type: child.attrs["data-rich-kind"] === "collage" ? "collage" : "slideshow", items, caption: caption(elements(child).find((inner) => inner.tag === "figcaption")) });
      continue;
    }
    if (child.tag === "figure" && hasClass(child, "rich_media_item")) { blocks.push(mediaItem(child)); continue; }
    if (child.tag === "blockquote") { blocks.push({ type: "paragraph", text: richTextOf(trimEdges(child.children)) }); continue; }
  }
  return { rtl: false, part: node.attrs["data-rich-part"] === "true", blocks };
}

const dateTitle = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2}) UTC([+-])(\d{2}):(\d{2})$/;

/** The export writes the message time in the channel's own timezone; the JSON export
 * stores the same local wall clock plus its Unix second. */
function timestamp(title: string): { date: string; date_unixtime: string } {
  const match = dateTitle.exec(title.trim());
  if (!match) throw new Error(`Unparsable message timestamp: ${JSON.stringify(title)}`);
  const [, day, month, year, hour, minute, second, sign, offsetHour, offsetMinute] = match;
  const offset = (sign === "-" ? -1 : 1) * (Number(offsetHour) * 60 + Number(offsetMinute));
  const date = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  const utc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) - offset * 60000;
  return { date, date_unixtime: String(Math.floor(utc / 1000)) };
}

function messageOf(node: Element): TelegramMessage | undefined {
  const id = Number(node.attrs.id.replace("message", ""));
  if (!Number.isFinite(id) || id <= 0) return undefined;
  if (hasClass(node, "service")) return { id, type: "service", text: "", text_entities: [] };
  const body = elements(node).find((child) => hasClass(child, "body") && !hasClass(child, "forwarded"));
  if (!body) return undefined;
  const time = elements(body).find((child) => hasClass(child, "pull_right") && hasClass(child, "date"));
  const title = time?.attrs.title;
  if (!title) throw new Error(`Message ${id} has no timestamp`);
  const quoted = innerOf(node, ["reply_to"]);
  let textNode: Element | undefined;
  walk(body, (child) => { if (!textNode && hasClass(child, "text") && !quoted.has(child)) textNode = child; });
  let quotedBlock: Element | undefined;
  walk(body, (child) => { if (!quotedBlock && hasClass(child, "reply_to")) quotedBlock = child; });
  const replyTarget = (() => {
    if (!quotedBlock) return undefined;
    let target: number | undefined;
    walk(quotedBlock, (child) => {
      if (target || child.tag !== "a") return;
      const id = /GoToMessage\((\d+)\)/.exec(child.attrs.onclick ?? "")?.[1] ?? /(?:^|#)go_to_message(\d+)$/.exec(child.attrs.href ?? "")?.[1];
      if (id) target = Number(id);
    });
    return target;
  })();
  const rich = textNode && hasClass(textNode, "rich_message") ? richMessage(textNode) : undefined;
  const entities = rich ? [] : entitiesOf(trimEdges(textNode?.children ?? []));
  return {
    id,
    type: "message",
    ...timestamp(title),
    ...(replyTarget ? { reply_to_message_id: replyTarget } : {}),
    ...mediaOf(node, innerOf(node, ["reply_to", "text"])),
    ...(rich ? { rich_message: rich } : {}),
    text: entities.length === 0 ? "" : entities.map((entity) => entity.type === "plain" ? entity.text : entity) as TelegramMessage["text"],
    text_entities: entities,
  };
}

const [inputFolder, output] = process.argv.slice(2).filter((value) => !value.startsWith("--"));
const previousIndex = process.argv.indexOf("--previous");
const previousPath = previousIndex === -1 ? undefined : process.argv[previousIndex + 1];
if (!inputFolder || !output) throw new Error("Usage: tsx pipeline/telegram/import-html.ts <export-folder> <output.json> [--previous <result.json>]");

const pages = (await readdir(resolve(inputFolder))).filter((name) => /^messages\d*\.html$/i.test(name))
  .sort((a, b) => (Number(a.match(/\d+/)?.[0] ?? 1) - Number(b.match(/\d+/)?.[0] ?? 1)));
if (!pages.length) throw new Error(`${inputFolder} has no messages*.html pages`);

const messages = new Map<number, TelegramMessage>();
let serviceMessages = 0;
for (const page of pages) {
  const document = parseDocument(await readFile(resolve(inputFolder, page), "utf8"));
  const nodes: Element[] = [];
  walk(document, (node) => {
    if (node.tag === "div" && hasClass(node, "message") && /^message-?\d+$/.test(node.attrs.id ?? "") && !/^message-/.test(node.attrs.id)) nodes.push(node);
  });
  for (const node of nodes) {
    const message = messageOf(node);
    if (!message) continue;
    if (message.type === "service") serviceMessages += 1;
    const existing = messages.get(message.id);
    // Pages never overlap, but a message edited between two exports does: the later page wins.
    messages.set(message.id, existing ? { ...existing, ...message } : message);
  }
}

let inheritedEdits = 0;
const previous = previousPath ? JSON.parse(await readFile(resolve(previousPath), "utf8")) as TelegramExport : undefined;
if (previous) {
  const byId = new Map(previous.messages.map((message) => [message.id, message]));
  for (const message of messages.values()) {
    const earlier = byId.get(message.id);
    if (!earlier) continue;
    if (earlier.edited) { message.edited = earlier.edited; message.edited_unixtime = earlier.edited_unixtime; inheritedEdits += 1; }
  }
}

const ordered = [...messages.values()].sort((a, b) => a.id - b.id);
const export_: TelegramExport = {
  name: previous?.name ?? "",
  ...(previous?.id ? { id: previous.id } : {}),
  messages: ordered,
};
await writeFile(resolve(output), JSON.stringify(export_, null, 2), "utf8");
console.log(JSON.stringify({
  pages,
  messages: ordered.length,
  serviceMessages,
  posts: ordered.filter((message) => message.type !== "service").length,
  articles: ordered.filter((message) => message.rich_message).length,
  withMedia: ordered.filter((message) => message.photo || message.video_file || message.audio_file || message.voice_message || message.file).length,
  withReply: ordered.filter((message) => message.reply_to_message_id).length,
  editedInherited: inheritedEdits,
  firstId: ordered[0]?.id,
  lastId: ordered[ordered.length - 1]?.id,
  output: resolve(output),
}));
