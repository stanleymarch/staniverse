import { existsSync } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { EnrichmentBundle } from "./enrichment/types";
import { isFresh } from "./enrichment/catalog";
import { readPublications } from "./enrichment/prepare";

const input = process.argv[2] ?? "pipeline/telegram/archive/canonical.json";
const sourceRoot = process.argv[3] ? resolve(process.argv[3]) : undefined;
/* The archived gate tracks drift against the full LLM bundle; the materialized
   gate verifies the parity of what materialize actually consumed — the local
   bundle — so the two modes must not silently compare against different sets. */
const enrichmentPath = process.argv[4] ?? (existsSync(resolve(input)) ? "pipeline/enrichment/generated/full.json" : "pipeline/enrichment/generated/telegram.json");

function frontmatterList(raw: string, key: string): string[] {
  const match = raw.match(new RegExp("^" + key + ": (.*)$", "m"));
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((value, index) => value === b[index]);

/** Materialized Markdown cannot reproduce the job source text byte-exact, so
 * freshness from Markdown means "deployed tags match the enrichment bundle" —
 * exactly the contract apply-tags guarantees. */
async function countTagsOutOfSync(enrichmentById: Map<string, EnrichmentBundle["results"][number]>): Promise<number> {
  const root = resolve("src/content/publications/telegram");
  let outOfSync = 0;
  for (const file of (await readdir(root)).filter((name) => name.endsWith(".md"))) {
    const raw = await readFile(resolve(root, file), "utf8");
    const sourceId = raw.match(/^sourceId: "?(\d+)"?$/m)?.[1] ?? file.match(/(\d+)/)?.[1];
    if (!sourceId) continue;
    const result = enrichmentById.get("publication:telegram:staniverse:" + sourceId);
    if (!result) continue;
    if (!sameList(frontmatterList(raw, "topics"), result.topics) || !sameList(frontmatterList(raw, "entities"), result.entities)) outOfSync += 1;
  }
  return outOfSync;
}

const publications = await readPublications(input);
// Without the archive, readPublications reconstructs the corpus from the materialized
// Markdown: media, albums and relations survive, but raw message bookkeeping does not,
// so the metrics derived from it must not be reported as zeros.
const archived = existsSync(resolve(input));
const ids = new Set(publications.map((publication) => publication.id));
const rawIds = publications.flatMap((publication) => publication.rawMessageIds);
const duplicateMessages = rawIds.filter((id, index) => rawIds.indexOf(id) !== index);
const brokenRelations = publications.flatMap((publication) => publication.relations.filter((relation) => relation.targetId.startsWith("publication:") && !ids.has(relation.targetId)).map((relation) => `${publication.id} -> ${relation.targetId}`));
const media = publications.flatMap((publication) => publication.media);
let enrichment: EnrichmentBundle | undefined;
try { enrichment = JSON.parse(await readFile(resolve(enrichmentPath), "utf8")) as EnrichmentBundle; } catch {}
const enrichmentById = new Map(enrichment?.results.map((result) => [result.id, result]) ?? []);
const staleEnrichment = archived
  ? publications.filter((publication) => { const result = enrichmentById.get(publication.id); return result && !isFresh(result, publication.body); }).length
  : await countTagsOutOfSync(enrichmentById);
let missingMedia = 0;
if (sourceRoot) for (const item of media) { try { await access(resolve(sourceRoot, item.sourcePath)); } catch { missingMedia++; } }
const report = {
  source: archived ? "canonical-archive" : "materialized-content",
  publications: publications.length,
  sourceMessages: archived ? new Set(rawIds).size : "not-checked",
  albumPublications: publications.filter((publication) => publication.threadIds.length > 1).length,
  maxAlbumLength: Math.max(...publications.map((publication) => publication.threadIds.length)),
  mediaOnly: archived ? publications.filter((publication) => !publication.body).length : "not-checked",
  mediaReferences: media.length,
  explicitRelations: publications.reduce((sum, publication) => sum + publication.relations.length, 0),
  tags: publications.reduce((sum, publication) => sum + publication.tags.length, 0),
  enrichedPublications: publications.filter((publication) => enrichmentById.get(publication.id)?.topics.length).length,
  generatedTopics: new Set(enrichment?.results.flatMap((result) => result.topics) ?? []).size,
  generatedEntities: new Set(enrichment?.results.flatMap((result) => result.entities) ?? []).size,
  generatedRelations: enrichment?.results.reduce((sum, result) => sum + result.relations.length, 0) ?? 0,
  staleEnrichment,
  duplicateMessages: archived ? duplicateMessages.length : "not-checked",
  brokenRelations: brokenRelations.length,
  missingMedia: sourceRoot ? missingMedia : "not-checked",
};
console.log(JSON.stringify(report, null, 2));
if ((archived && duplicateMessages.length) || brokenRelations.length || staleEnrichment) process.exitCode = 1;
