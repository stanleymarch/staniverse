import type { APIRoute } from "astro";
import { statSync } from "node:fs";
import { join } from "node:path";
import { allEntries, hrefFor } from "../lib/content";

/**
 * Site feed: authored material only (articles, own works, projects, experiments
 * and garden posts), freshest first, capped so the file stays small. Parameters
 * filtered by garden UI never reach here — a feed entry is always the canonical URL.
 *
 * A publication whose cover exists on our own disk also carries it as an
 * `<enclosure>`, so a cross-posting service (VK) attaches the same picture the
 * site shows. External thumbnails are skipped: RSS requires a byte length and
 * we only know it for local files.
 */
const FEED_SIZE = 30;

const escape = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const mimeByExtension: Record<string, string> = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".avif": "image/avif",
};

const mimeFor = (path: string) => mimeByExtension[path.slice(path.lastIndexOf(".")).toLowerCase()] ?? "image/jpeg";

const localCover = (publicPath: string | undefined) => {
  if (!publicPath?.startsWith("/media/")) return undefined;
  try {
    return { publicPath, length: statSync(join("public", publicPath)).size };
  } catch {
    return undefined;
  }
};

export const GET: APIRoute = async ({ site }) => {
  const entries = (await allEntries())
    .filter((entry) => ["articles", "works", "projects", "experiments", "publications"].includes(entry.collection))
    .map((entry) => {
      const publication = entry.collection === "publications" ? entry.data : undefined;
      const coverPath = publication
        ? publication.media.find((item) => item.type === "image" && item.publicPath)?.publicPath
          ?? (publication.thumbnailUrl?.startsWith("/media/") ? publication.thumbnailUrl : undefined)
        : undefined;
      return {
        title: entry.data.title,
        description: entry.data.summary,
        path: hrefFor(entry),
        date: entry.data.updated ?? entry.data.date,
        kind: entry.data.kind,
        cover: localCover(coverPath),
      };
    })
    .filter((item): item is typeof item & { date: Date } => item.date instanceof Date)
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, FEED_SIZE);
  const items = entries.map((item) => {
    const enclosure = item.cover
      ? `<enclosure url="${new URL(item.cover.publicPath, site).href}" type="${mimeFor(item.cover.publicPath)}" length="${item.cover.length}" />`
      : "";
    return `<item><title>${escape(item.title)}</title><link>${new URL(item.path, site).href}</link><guid>${new URL(item.path, site).href}</guid><pubDate>${item.date.toUTCString()}</pubDate><description>${escape(item.description)}</description>${enclosure}</item>`;
  }).join("");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>станивёрс</title><link>${new URL("/", site).href}</link><description>Связи между технологиями, памятью, медиа и местом — работы, проекты и заметки Станислава Ермоленко.</description><language>ru-ru</language><atom:link href="${new URL("/rss.xml", site).href}" rel="self" type="application/rss+xml" />${items}</channel></rss>`,
    { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } },
  );
};
