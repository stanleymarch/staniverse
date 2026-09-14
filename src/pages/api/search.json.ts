import { allEntries, hrefFor, kindLabel } from "../../lib/content";
import { normalizeTopics } from "../../lib/taxonomy";
import { getTopicDefinition } from "../../lib/taxonomy";

export const prerender = true;

/** Static search index consumed by /scripts/site-search.js on the client.
 * Field names stay short to keep the payload lean; `x` is a capped plain-text
 * digest of the body used for full-text matching and snippets. */
const strip = (value: string) => value
  .replace(/```[\s\S]*?```/g, " ")
  .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/<[^>]+>/g, " ")
  .replace(/[*_`>#~|-]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

export async function GET() {
  const entries = await allEntries();
  const documents = entries.map((entry) => {
    const body = "body" in entry ? (entry.body as string) : "";
    const topics = entry.collection === "publications"
      ? entry.data.topics ?? []
      : [...entry.data.tags, ...(entry.data.topics ?? [])];
    return {
      t: entry.data.title,
      k: kindLabel[entry.data.kind] ?? entry.data.kind,
      h: hrefFor(entry),
      s: entry.data.summary ?? "",
      p: normalizeTopics(topics).map((id) => getTopicDefinition(id)?.label ?? id).join(" · "),
      d: entry.data.date?.toISOString().slice(0, 10) ?? "",
      x: strip(body),
    };
  });
  return new Response(JSON.stringify({ version: 1, documents }), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
