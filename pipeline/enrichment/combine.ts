import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { segmentBaseId } from "./prepare";
import type { EnrichmentBundle, EnrichmentJob, EnrichmentResult } from "./types";

/** Merges per-segment OpenRouter results back into one result per original
 * source. A source counts as tagged only when every segment succeeded; its
 * textHash covers the concatenated segments, which partition the source body
 * exactly, so freshness checks in materialize keep working. */
const [jobsPath = "pipeline/enrichment/jobs/full.jsonl", bundlePath = "pipeline/enrichment/review/full-openrouter.json", output = "pipeline/enrichment/generated/full.json"] = process.argv.slice(2);

const jobs = (await readFile(resolve(jobsPath), "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as EnrichmentJob);
const bundle = JSON.parse(await readFile(resolve(bundlePath), "utf8")) as EnrichmentBundle;
const resultsById = new Map(bundle.results.map((result) => [result.id, result]));

const segmentsBySource = new Map<string, EnrichmentJob[]>();
for (const job of jobs) {
  const baseId = segmentBaseId(job.id);
  const list = segmentsBySource.get(baseId) ?? [];
  list.push(job);
  segmentsBySource.set(baseId, list);
}

const merged: EnrichmentResult[] = [];
const incomplete: Array<{ id: string; missing: string[] }> = [];
for (const [baseId, segments] of segmentsBySource) {
  const segmentResults = segments.map((segment) => resultsById.get(segment.id));
  if (segmentResults.some((result) => !result)) {
    incomplete.push({ id: baseId, missing: segments.filter((segment) => !resultsById.get(segment.id)).map((segment) => segment.id) });
    continue;
  }
  const parts = segmentResults as EnrichmentResult[];
  const topics: string[] = [];
  const topicEvidence: Array<{ topicId: string; quote: string }> = [];
  const entities: string[] = [];
  for (const part of parts) {
    for (const topic of part.topics) if (topics.length < 8 && !topics.includes(topic)) topics.push(topic);
    for (const evidence of part.topicEvidence ?? []) if (!topicEvidence.some((item) => item.topicId === evidence.topicId)) topicEvidence.push(evidence);
    for (const entity of part.entities) if (entities.length < 12 && !entities.includes(entity)) entities.push(entity);
  }
  const first = parts[0];
  merged.push({
    ...first,
    id: baseId,
    textHash: createHash("sha256").update(segments.map((segment) => segment.sourceText).join("")).digest("hex"),
    summary: parts.map((part) => part.summary).filter(Boolean).sort((a, b) => b.length - a.length)[0] ?? "",
    topics,
    topicEvidence: topics.map((topic) => topicEvidence.find((item) => item.topicId === topic)).filter((item): item is { topicId: string; quote: string } => Boolean(item)),
    entities,
    relations: [],
    needsReview: parts.some((part) => part.needsReview),
    createdAt: parts.map((part) => part.createdAt).sort().at(-1) ?? new Date().toISOString(),
  });
}

await mkdir(dirname(resolve(output)), { recursive: true });
await writeFile(resolve(output), JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), results: merged, ...(incomplete.length ? { errors: incomplete.map((item) => ({ id: item.id, stage: "combine", error: "missing segment results: " + item.missing.join(", ") })) } : {}) }, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ sources: segmentsBySource.size, tagged: merged.length, incomplete: incomplete.length, output: resolve(output) }));
