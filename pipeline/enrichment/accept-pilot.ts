import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PILOT_MANIFEST } from "./pilot-manifest";
import { segmentBaseId, sourceHash } from "./prepare";
import type {
  AcceptedEnrichmentBundle,
  AcceptedEnrichmentResult,
  AcceptedStageProvenance,
  EnrichmentBundle,
  EnrichmentJob,
  EnrichmentRelationType,
} from "./types";

interface CorrectionEvidence {
  quote: string;
  explanation: string;
  confidence: number;
}
interface CorrectionRelation extends Omit<CorrectionEvidence, "quote"> {
  targetId: string;
  type: EnrichmentRelationType;
  evidenceQuote: string;
}
interface CorrectionSource {
  id: string;
  finalSummary: string;
  finalTopics: string[];
  topicEvidence: Array<CorrectionEvidence & { topicId: string }>;
  finalEntities: Array<CorrectionEvidence & { entity: string }>;
  finalRelations: CorrectionRelation[];
}
interface CorrectionManifest { version: 1; reviewer: string; sources: CorrectionSource[] }
interface SlowReview { verdict: string }

const DEFAULT_JOBS = "pipeline/enrichment/jobs/pilot.jsonl";
const DEFAULT_TOPICS = "pipeline/enrichment/review/pilot-openrouter.json";
const DEFAULT_RELATIONS = "pipeline/enrichment/review/pilot-openrouter-with-relations.json";
const DEFAULT_REVIEW = "pipeline/enrichment/review/pilot-slow-review.json";
const DEFAULT_CORRECTIONS = "pipeline/enrichment/review/pilot-corrections.json";
const DEFAULT_OUTPUT = "pipeline/enrichment/generated/accepted.json";
const MANIFEST_PATH = "pipeline/enrichment/pilot-manifest.json";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(resolve(path), "utf8")) as T;
}

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique.`);
}

function groupedJobs(jobs: EnrichmentJob[]): Map<string, EnrichmentJob[]> {
  const grouped = new Map<string, EnrichmentJob[]>();
  for (const job of jobs) {
    const id = segmentBaseId(job.id);
    grouped.set(id, [...(grouped.get(id) ?? []), job]);
  }
  for (const [id, parts] of grouped) {
    parts.sort((a, b) => (a.segment?.index ?? 1) - (b.segment?.index ?? 1));
    const total = parts[0]?.segment?.total ?? 1;
    if (parts.length !== total || parts.some((part, index) => (part.segment?.index ?? 1) !== index + 1)) {
      throw new Error(`Incomplete or unordered segment set for ${id}.`);
    }
    let offset = 0;
    for (const part of parts) {
      if ((part.segment?.offset ?? 0) !== offset) throw new Error(`Invalid segment offset for ${part.id}.`);
      offset += part.sourceText.length;
    }
  }
  return grouped;
}

function validateCorrection(source: CorrectionSource, jobs: EnrichmentJob[]): void {
  const text = jobs.map(({ sourceText }) => sourceText).join("");
  const allowedTopics = new Set(jobs.flatMap(({ allowedTopicIds }) => allowedTopicIds));
  const targets = new Set(jobs.flatMap(({ candidateTargets }) => candidateTargets.map(({ id }) => id)));
  if (!source.finalSummary.trim()) throw new Error(`Missing reviewed summary for ${source.id}.`);
  unique(source.finalTopics, `Topics for ${source.id}`);
  unique(source.topicEvidence.map(({ topicId }) => topicId), `Topic evidence for ${source.id}`);
  unique(source.finalEntities.map(({ entity }) => entity), `Entities for ${source.id}`);
  unique(source.finalRelations.map(({ targetId, type }) => `${targetId}:${type}`), `Relations for ${source.id}`);
  if (canonical([...source.finalTopics].sort()) !== canonical(source.topicEvidence.map(({ topicId }) => topicId).sort())) {
    throw new Error(`Every final topic needs exactly one evidence record for ${source.id}.`);
  }
  for (const topic of source.finalTopics) if (!allowedTopics.has(topic)) throw new Error(`Unknown topic ${topic} for ${source.id}.`);
  const checkEvidence = (quote: string, explanation: string, confidence: number, label: string) => {
    if (!text.includes(quote)) throw new Error(`${label} is not an exact source substring for ${source.id}: ${JSON.stringify(quote)}`);
    if (!explanation.trim() || confidence < 0 || confidence > 1) throw new Error(`Invalid reviewed ${label.toLowerCase()} for ${source.id}.`);
  };
  for (const evidence of source.topicEvidence) checkEvidence(evidence.quote, evidence.explanation, evidence.confidence, "Evidence");
  for (const evidence of source.finalEntities) checkEvidence(evidence.quote, evidence.explanation, evidence.confidence, "Entity evidence");
  for (const relation of source.finalRelations) {
    checkEvidence(relation.evidenceQuote, relation.explanation, relation.confidence, "Relation evidence");
    if (!targets.has(relation.targetId)) throw new Error(`Relation target ${relation.targetId} was not retrieved for ${source.id}.`);
  }
}

function stage(
  name: AcceptedStageProvenance["stage"],
  jobs: EnrichmentJob[],
  bundle: EnrichmentBundle,
): AcceptedStageProvenance {
  const byId = new Map(bundle.results.map((result) => [result.id, result]));
  const results = jobs.map((job) => {
    const result = byId.get(job.id);
    if (!result || result.textHash !== job.textHash) throw new Error(`${name} result is missing or stale for ${job.id}.`);
    return result;
  });
  const promptVersions = [...new Set(results.map(({ promptVersion }) => promptVersion))];
  const providers = [...new Set(results.map(({ provider }) => provider))];
  const models = [...new Set(results.map(({ model }) => model))];
  if (promptVersions.length !== 1 || providers.length !== 1 || models.length !== 1) throw new Error(`Mixed ${name} provenance.`);
  return {
    stage: name,
    promptVersion: promptVersions[0],
    provider: providers[0],
    model: models[0],
    resultHashes: results.map((result) => sha256(canonical(result))),
  };
}

function contentFileRelativePath(id: string): string {
  if (id.startsWith("publication:telegram:staniverse:")) return `src/content/publications/telegram/tg-${id.split(":").at(-1)}.md`;
  if (id.startsWith("project:")) return `src/content/projects/${id.slice("project:".length)}.md`;
  throw new Error(`No content mapping for ${id}.`);
}

function fileBodyRegion(raw: string, id: string): string {
  const match = raw.match(/^---(?:\r?\n)([\s\S]*?)(\r?\n)---(?:\r?\n)([\s\S]*)$/);
  if (!match || match.index !== 0) throw new Error(`Content file for ${id} has no parseable frontmatter.`);
  return match[3];
}

async function pinContentFile(id: string, sourceText: string): Promise<string> {
  const raw = await readFile(resolve(contentFileRelativePath(id)), "utf8");
  const body = fileBodyRegion(raw, id);
  const norm = (value: string) => value.replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
  const link = /\n*\[Оригинал в Telegram\]\([^)]*\)\s*$/;
  const consistent = norm(body) === norm(sourceText)
    || norm(body.replace(link, "")) === norm(sourceText)
    || norm(body) === norm(sourceText.replace(link, ""));
  if (!consistent) throw new Error(`Content file body for ${id} does not match the reviewed source text.`);
  return sourceHash(body);
}

export async function buildAcceptedPilot(
  jobsPath = DEFAULT_JOBS,
  topicPath = DEFAULT_TOPICS,
  relationPath = DEFAULT_RELATIONS,
  reviewPath = DEFAULT_REVIEW,
  correctionsPath = DEFAULT_CORRECTIONS,
  outputPath = DEFAULT_OUTPUT,
): Promise<AcceptedEnrichmentBundle> {
  const jobs = (await readFile(resolve(jobsPath), "utf8")).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as EnrichmentJob);
  const [topicBundle, relationBundle, review, corrections, manifestText, reviewText, correctionsText] = await Promise.all([
    json<EnrichmentBundle>(topicPath),
    json<EnrichmentBundle>(relationPath),
    json<SlowReview>(reviewPath),
    json<CorrectionManifest>(correctionsPath),
    readFile(resolve(MANIFEST_PATH), "utf8"),
    readFile(resolve(reviewPath), "utf8"),
    readFile(resolve(correctionsPath), "utf8"),
  ]);
  if (review.verdict !== "accept_with_changes") throw new Error("Slow review has not authorized a corrected pilot.");
  if (corrections.version !== 1 || !corrections.reviewer.trim()) throw new Error("Unsupported correction manifest.");
  const groups = groupedJobs(jobs);
  const expectedIds = PILOT_MANIFEST.sources.map(({ id }) => id);
  unique(corrections.sources.map(({ id }) => id), "Correction source IDs");
  if (canonical([...corrections.sources.map(({ id }) => id)].sort()) !== canonical([...expectedIds].sort())) {
    throw new Error("Correction manifest must cover exactly the canonical 30-source pilot.");
  }
  const correctionsById = new Map(corrections.sources.map((source) => [source.id, source]));
  const results: AcceptedEnrichmentResult[] = await Promise.all(expectedIds.map(async (id) => {
    const sourceJobs = groups.get(id);
    const correction = correctionsById.get(id);
    if (!sourceJobs || !correction) throw new Error(`Missing source inputs for ${id}.`);
    validateCorrection(correction, sourceJobs);
    const sourceText = sourceJobs.map(({ sourceText }) => sourceText).join("");
    const payload = {
      id,
      sourceHash: sourceHash(sourceText),
      fileBodyHash: await pinContentFile(id, sourceText),
      summary: correction.finalSummary,
      topics: correction.finalTopics,
      topicEvidence: correction.topicEvidence,
      entities: correction.finalEntities,
      relations: correction.finalRelations,
      stages: [stage("topic-proposal", sourceJobs, topicBundle), stage("relation-proposal", sourceJobs, relationBundle)],
    };
    return { ...payload, resultHash: sha256(canonical(payload)) };
  }));
  if (results.reduce((sum, result) => sum + result.relations.length, 0) !== 21) throw new Error("Reviewed pilot must contain exactly 21 accepted relations.");
  let generatedAt = new Date().toISOString();
  try {
    const previous = await json<Partial<AcceptedEnrichmentBundle>>(outputPath);
    if (previous.version === 2 && previous.lifecycle === "accepted") generatedAt = previous.generatedAt ?? generatedAt;
  } catch {
    // First accepted generation has no previous timestamp to preserve.
  }
  const bundle: AcceptedEnrichmentBundle = {
    version: 2,
    lifecycle: "accepted",
    generatedAt,
    manifest: { path: MANIFEST_PATH, sha256: sha256(manifestText) },
    review: {
      path: reviewPath,
      sha256: sha256(reviewText),
      correctionsPath,
      correctionsSha256: sha256(correctionsText),
      reviewer: corrections.reviewer,
      verdict: "accept_with_changes",
    },
    results,
  };
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await writeFile(resolve(outputPath), JSON.stringify(bundle, null, 2) + "\n", "utf8");
  return bundle;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bundle = await buildAcceptedPilot(...process.argv.slice(2) as [string?, string?, string?, string?, string?, string?]);
  console.log(`Accepted ${bundle.results.length} reviewed pilot sources at ${process.argv[7] ?? DEFAULT_OUTPUT}.`);
}
