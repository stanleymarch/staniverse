/** Reconcile the reviewed cache with hand-curated pages.
 *
 * Doctrine: reviewed topics live in the materialized pages. The CI audit
 * (materialized-only mode) demands every page's topics/entities match at least
 * one bundle — a page a human curated after its cache entry was written
 * matches neither and fails the audit (and the Pages preview workflow).
 * This mirrors such pages' frontmatter back into generated/full.json;
 * hashes are untouched, so freshness and the Jev increment logic keep working.
 *
 * Usage: npm run enrichment:reconcile   (cwd = repo root)
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { EnrichmentBundle } from "./types";

const FULL = "pipeline/enrichment/generated/full.json";
const LOCAL = "pipeline/enrichment/generated/telegram.json";
const PAGES = "src/content/publications/telegram";

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const frontmatterList = (raw: string, key: string): string[] => {
  const match = raw.match(new RegExp(`^${key}: (.*)$`, "m"));
  if (!match) return [];
  try { const parsed = JSON.parse(match[1]); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
};

const cached: EnrichmentBundle = JSON.parse(await readFile(FULL, "utf8"));
const local = JSON.parse(await readFile(LOCAL, "utf8")) as EnrichmentBundle;
const cachedById = new Map(cached.results.map((r) => [r.id, r]));
const localById = new Map(local.results.map((r) => [r.id, r]));

let reconciled = 0;
for (const file of (await readdir(PAGES)).filter((name) => name.endsWith(".md")).sort()) {
  const raw = await readFile(resolve(PAGES, file), "utf8");
  const sourceId = raw.match(/^sourceId: "?(\d+)"?$/m)?.[1] ?? file.match(/(\d+)/)?.[1];
  if (!sourceId) continue;
  const id = "publication:telegram:staniverse:" + sourceId;
  const entry = cachedById.get(id);
  if (!entry) continue;
  const topics = frontmatterList(raw, "topics");
  const entities = frontmatterList(raw, "entities");
  const matches = (bundle: Map<string, { topics: string[]; entities: string[] }>) => {
    const result = bundle.get(id);
    return result && sameList(topics, result.topics) && sameList(entities, result.entities);
  };
  if (matches(cachedById) || matches(localById)) continue;
  entry.topics = topics;
  entry.entities = entities;
  reconciled += 1;
  console.log(`reconciled ${file} -> ${JSON.stringify(topics)}`);
}

if (reconciled) await writeFile(FULL, JSON.stringify(cached, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ reconciled, output: resolve(FULL) }));
