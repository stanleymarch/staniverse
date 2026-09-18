import type { APIRoute } from "astro";
import { allEntries, hrefFor } from "../lib/content";

/**
 * Site feed: authored material only (articles, own works and projects, garden
 * posts), freshest first, capped so the file stays small. Parameters filtered
 * by garden UI never reach here — a feed entry is always the canonical URL.
 */
const FEED_SIZE = 30;

const escape = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

export const GET: APIRoute = async ({ site }) => {
  const entries = (await allEntries())
    .filter((entry) => ["articles", "works", "projects", "publications"].includes(entry.collection))
    .map((entry) => ({
      title: entry.data.title,
      description: entry.data.summary,
      path: hrefFor(entry),
      date: entry.data.updated ?? entry.data.date,
      kind: entry.data.kind,
    }))
    .filter((item): item is typeof item & { date: Date } => item.date instanceof Date)
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, FEED_SIZE);
  const items = entries.map((item) => (
    `<item><title>${escape(item.title)}</title><link>${new URL(item.path, site).href}</link><guid>${new URL(item.path, site).href}</guid><pubDate>${item.date.toUTCString()}</pubDate><description>${escape(item.description)}</description></item>`
  )).join("");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>Staniverse</title><link>${new URL("/", site).href}</link><description>Связи между технологиями, памятью, медиа и местом — работы, проекты и заметки Станислава Ермоленко.</description><language>ru-ru</language><atom:link href="${new URL("/rss.xml", site).href}" rel="self" type="application/rss+xml" />${items}</channel></rss>`,
    { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } },
  );
};
