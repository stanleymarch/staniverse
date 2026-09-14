import type { APIRoute } from "astro";
import { allEntries, hrefFor } from "../lib/content";
import { collectTopics } from "../lib/topics";

export const GET: APIRoute = async ({ site }) => {
  const entries = await allEntries();
  // The manifesto stub is a redirect to /about/#manifesto, not canonical content.
  const canonicalEntries = entries.filter((entry) => !(entry.collection === "articles" && entry.id === "manifesto"));
  const lastModified = (items: typeof canonicalEntries) => items
    .map((entry) => entry.data.updated ?? entry.data.date)
    .filter((value): value is Date => value instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const latest = lastModified(canonicalEntries);
  const topics = collectTopics(canonicalEntries);
  const records = [
    { path: "/", modified: latest },
    { path: "/about/", modified: latest },
    { path: "/works/", modified: lastModified(canonicalEntries.filter((entry) => entry.collection === "works")) },
    { path: "/projects/", modified: lastModified(canonicalEntries.filter((entry) => entry.collection === "projects")) },
    { path: "/garden/", modified: lastModified(canonicalEntries.filter((entry) => ["articles", "publications"].includes(entry.collection))) },
    { path: "/videos/", modified: lastModified(canonicalEntries.filter((entry) => entry.collection === "publications" && entry.data.platform === "youtube")) },
    { path: "/topics/", modified: latest },
    { path: "/universe/", modified: latest },
    { path: "/donate/", modified: latest },
    ...canonicalEntries.map((entry) => ({ path: hrefFor(entry), modified: entry.data.updated ?? entry.data.date })),
    ...topics.map((topic) => ({ path: `/topics/${topic.slug}/`, modified: lastModified(topic.entries) })),
  ];
  const unique = new Map(records.map((record) => [record.path, record]));
  const urls = [...unique.values()].map(({ path, modified }) => {
    const date = modified instanceof Date ? `<lastmod>${modified.toISOString()}</lastmod>` : "";
    return `<url><loc>${new URL(path, site).href}</loc>${date}</url>`;
  }).join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
