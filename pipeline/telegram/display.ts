import type { CanonicalPublication } from "./types";

/** The copy a publication page shows: one display title, a summary that does not repeat
 * it, and the body without the leading heading the title was taken from. */
export interface PublicationDisplay { title: string; summary: string; body: string }

const sourceLink = /[\r\n ]*\[Оригинал в Telegram\]\([^)]*\)\s*$/;
/** The headline the author wrote at the top of the text: a Markdown heading in a Telegram
 * Article, a whole line in bold in a post. */
const ledeHeading = /^(?:#{1,6}[ \t]+([^\n]+?)|\*\*([^\n]+?)\*\*)[ \t]*\r?\n(?:[ \t]*\r?\n)*/;

const plain = (value: string) => value
  .replace(/<!--[\s\S]*?-->/g, " ")
  .replace(/```[\s\S]*?```/g, " ")
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/[*_`>#]/g, "")
  .replace(/\s+/g, " ")
  .trim();
const shortened = (value: string, length: number) => value.length <= length ? value : `${value.slice(0, length - 1).trimEnd()}…`;
const withoutTrailingPunctuation = (value: string) => value.replace(/[\s.!?…:;,—–-]+$/u, "");

/** Removes the leading paragraph when the page already shows it as the title, so the same
 * sentence is not used as both the heading and the opening line. */
function withoutRepeatedLede(body: string, title: string): string {
  const block = body.split(/\r?\n[ \t]*\r?\n/, 1)[0];
  if (!title || block.trim() === body.trim()) return body;
  if (withoutTrailingPunctuation(plain(block)) !== withoutTrailingPunctuation(title)) return body;
  return body.slice(block.length).replace(/^(?:[ \t]*\r?\n)+/, "");
}

export function publicationDisplay(publication: CanonicalPublication): PublicationDisplay {
  const authored = publication.body.replace(sourceLink, "");
  const heading = authored.match(ledeHeading);
  const headingCopy = heading ? plain(heading[1] ?? heading[2] ?? "") : "";
  const afterHeading = headingCopy ? authored.slice(heading![0].length) : authored;
  const clean = plain(afterHeading);
  const dateLabel = publication.date ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(new Date(publication.date)) : publication.sourceId;
  const title = publication.title || headingCopy || (clean ? shortened(clean.split(/[.!?\n]/, 1)[0], 90) : `Медиапубликация · ${dateLabel}`);
  const body = headingCopy || !clean ? afterHeading : withoutRepeatedLede(afterHeading, title);
  const summarySource = plain(body);
  return {
    title,
    body,
    summary: summarySource ? shortened(summarySource, 220) : `Публикация без текстовой подписи; в архиве сохранено медиафайлов: ${publication.media.length}.`,
  };
}
