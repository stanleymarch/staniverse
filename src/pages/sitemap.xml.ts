import type { APIRoute } from "astro";
import { allEntries, hrefFor } from "../lib/content";
import { collectTopics } from "../lib/topics";
import { alternatesFor, languageAlternates } from "../lib/i18n";

export const GET: APIRoute = async ({ site }) => {
  const entries = await allEntries();
  const canonicalEntries = entries;
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
    { path: "/lab/", modified: latest },
    { path: "/manifesto/", modified: lastModified(canonicalEntries.filter((entry) => entry.collection === "articles" && entry.id === "manifesto")) },
    { path: "/contacts/", modified: latest },
    { path: "/privacy/", modified: new Date("2026-09-18") },
    { path: "/donate/", modified: latest },
    ...canonicalEntries.map((entry) => ({ path: hrefFor(entry), modified: entry.data.updated ?? entry.data.date })),
    ...topics.map((topic) => ({ path: `/topics/${topic.slug}/`, modified: lastModified(topic.entries) })),
  ];
  const unique = new Map(records.map((record) => [record.path, record]));
  // EN twins enter through the central alternates map (lib/i18n.ts), so the
  // sitemap pair can never drift from the hreflang clusters Base.astro emits.
  for (const { en } of languageAlternates) unique.set(en, { path: en, modified: latest });
  const urls = [...unique.values()].map(({ path, modified }) => {
    const date = modified instanceof Date ? `<lastmod>${modified.toISOString()}</lastmod>` : "";
    const cluster = alternatesFor(path)
      .map((alternate) => `<xhtml:link rel="alternate" hreflang="${alternate.lang}" href="${new URL(alternate.href, site).href}" />`)
      .join("");
    return `<url><loc>${new URL(path, site).href}</loc>${date}${cluster}</url>`;
  }).join("");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
};
