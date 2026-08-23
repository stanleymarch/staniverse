import type { APIRoute } from "astro";
import { allEntries, hrefFor } from "../lib/content";
import { collectTopics } from "../lib/topics";

export const GET: APIRoute = async ({ site }) => {
  const entries = await allEntries();
  const paths = ["/", "/about/", "/works/", "/projects/", "/garden/", "/topics/", "/universe/", ...entries.map(hrefFor), ...collectTopics(entries).map((topic) => `/topics/${topic.slug}/`)];
  const urls = [...new Set(paths)].map((path) => `<url><loc>${new URL(path, site).href}</loc></url>`).join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
