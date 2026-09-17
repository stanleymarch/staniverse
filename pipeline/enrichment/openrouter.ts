import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { EnrichmentBundle, EnrichmentJob, EnrichmentResult } from "./types";
import { pilotSplitForSource, type PilotSplit } from "./pilot-manifest";
import { partitionSource, segmentBaseId } from "./prepare";

export const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";
export const PROMPT_VERSION = "staniverse-openrouter-pilot-v5";
const CACHE_DIR = "pipeline/enrichment/review/openrouter-cache";
const RELATION_TYPES = ["mentions", "documents", "develops", "inspired", "uses", "part-of", "related"] as const;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function cacheKey(job: EnrichmentJob, model: string) {
  return digest({ sourceHash: job.textHash, model, prompt: PROMPT_VERSION, taxonomy: job.topicDefinitions });
}

export function loadDotEnv(text: string) {
  return text.split(/\r?\n/).reduce((out, line) => {
    const match = line.match(/^\s*OPENROUTER_API_KEY\s*=\s*(.*?)\s*$/);
    if (match) out = match[1].replace(/^['"]|['"]$/g, "");
    return out;
  }, "");
}

/** Same .env scan as loadDotEnv, for the Z.ai key (ZAI_API_KEY=...). */
async function loadZaiKey() {
  try {
    const text = await readFile(".env", "utf8");
    return text.split(/\r?\n/).map((line) => line.match(/^\s*ZAI_API_KEY\s*=\s*(.*?)\s*$/)?.[1]?.replace(/^['"]|['"]$/g, "") ?? "").find(Boolean) ?? "";
  } catch {
    return "";
  }
}
const SYSTEM_PROMPT = [
  "Размечай только фрагменты sourceEvidence. Верни строгий JSON.",
  "Темы выбирай только из allowedTopicIds; topicDefinitions задают границы включения/исключения. Тем может быть несколько или ни одной.",
  "Тему включай, только если текст предметно раскрывает её: обсуждает, объясняет, описывает или разбирает как основной предмет. Единичное упоминание, ссылка, чужая новость, продукт или устройство без содержательного разбора темой не являются.",
  "Для каждой темы верни topicId и evidenceId фрагмента sourceEvidence, который её подтверждает. Один фрагмент может подтверждать несколько тем — это нормально. Не копируй и не пересказывай цитату.",
  "Названия продуктов, компаний, устройств и собственных проектов — entities, не темы.",
  "Связи между материалами в этом topic-only pilot не размечаются: relations всегда пустой массив.",
  "Тема ≠ статус реализации. Не выдумывай факты; сомнение выражай через needsReview=true.",
].join(" ");

export const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "topics", "topicEvidence", "entities", "relations", "needsReview"],
  properties: {
    summary: { type: "string" },
    topics: { type: "array", items: { type: "string" }, maxItems: 8 },
    topicEvidence: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["topicId", "evidenceId"],
        properties: { topicId: { type: "string" }, evidenceId: { type: "string" } },
      },
    },
    entities: { type: "array", items: { type: "string" }, maxItems: 12 },
    relations: { type: "array", maxItems: 0, items: { type: "object" } },
    needsReview: { type: "boolean" },
  },
} as const;

export interface EvidenceFragment {
  id: string;
  text: string;
}

export function buildEvidenceFragments(sourceText: string, maxChars = 700): EvidenceFragment[] {
  return partitionSource(sourceText, maxChars)
    .map((part) => part.text.trim())
    .filter(Boolean)
    .map((text, index) => ({ id: `e${index + 1}`, text }));
}

export function hydrateEvidence(value: unknown, fragments: EvidenceFragment[]): unknown {
  if (!value || typeof value !== "object") return value;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.topicEvidence)) return value;
  const textById = new Map(fragments.map((fragment) => [fragment.id, fragment.text]));
  return {
    ...raw,
    topicEvidence: raw.topicEvidence.map((item) => {
      if (!item || typeof item !== "object") return item;
      const evidence = item as Record<string, unknown>;
      return { topicId: evidence.topicId, quote: typeof evidence.evidenceId === "string" ? textById.get(evidence.evidenceId) ?? "" : "" };
    }),
    relations: Array.isArray(raw.relations) ? raw.relations : [],
  };
}

/** Normalization applied to both source text and evidence quotes before matching:
 * NFKC, typographic quotes/dashes folded to ASCII, whitespace collapsed. This keeps
 * evidence auditable (fragments must still appear verbatim in the source) while
 * tolerating near-exact rendering differences. */
function normalize(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[«»]/g, '"')
    .replace(/[“”‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Verifies a quote is grounded in the source: every fragment separated by an ellipsis
 * ("…" or "...") must appear verbatim (normalized) in the source, in quote order.
 * This accepts truncated/elided quotes while rejecting paraphrased or invented ones. */
function sourceIncludesQuote(sourceText: string, quote: string) {
  const source = normalize(sourceText);
  const fragments = quote.split(/…|\.{3}/).map(normalize).filter(Boolean);
  if (fragments.length === 0) return false;
  let position = 0;
  for (const fragment of fragments) {
    const at = source.indexOf(fragment, position);
    if (at < 0) return false;
    position = at + fragment.length;
  }
  return true;
}

/**
 * Conservative repair of model bookkeeping without inventing evidence: only
 * allowed topics with a verbatim source fragment survive. One fragment may
 * back several topics — dropping a topic to "deduplicate quotes" loses real
 * signal. Any dropped proposal forces human review; relations stay empty here.
 */
export function retainGroundedTopics(value: unknown, job: EnrichmentJob): unknown {
  if (!value || typeof value !== "object") return value;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.topics) || !Array.isArray(raw.topicEvidence)) {
    // Schemaless fallback answers may omit arrays entirely: treat as empty
    // (reviewable) instead of passing through and failing validation later.
    return { ...raw, entities: Array.isArray(raw.entities) ? raw.entities : [], topics: [], topicEvidence: [], relations: [], needsReview: true };
  }

  const topics: string[] = [];
  const topicEvidence: Array<{ topicId: string; quote: string }> = [];
  const seenTopics = new Set<string>();
  let repaired = false;

  for (const topic of raw.topics) {
    if (topics.length >= 8) {
      repaired = true;
      continue;
    }
    if (typeof topic !== "string" || !job.allowedTopicIds.includes(topic) || seenTopics.has(topic)) {
      repaired = true;
      continue;
    }
    const evidence = raw.topicEvidence.find((candidate) => {
      if (!candidate || typeof candidate !== "object") return false;
      const item = candidate as Record<string, unknown>;
      return item.topicId === topic && typeof item.quote === "string" && item.quote.trim() && sourceIncludesQuote(job.sourceText, item.quote);
    });
    if (!evidence || typeof evidence !== "object" || typeof (evidence as Record<string, unknown>).quote !== "string") {
      repaired = true;
      continue;
    }
    topics.push(topic);
    topicEvidence.push({ topicId: topic, quote: (evidence as Record<string, unknown>).quote as string });
    seenTopics.add(topic);
  }

  if (topics.length !== raw.topics.length || topicEvidence.length !== raw.topicEvidence.length) repaired = true;
  const relations = Array.isArray(raw.relations) ? raw.relations : [];
  if (relations.length > 0) repaired = true;
  // GLM flash sometimes returns entity objects ({name, kind}) instead of
  // plain strings; salvage the label and drop the rest.
  const entities = (Array.isArray(raw.entities) ? raw.entities : []).flatMap((entity) => {
    if (typeof entity === "string") return entity.trim() ? [entity] : [];
    if (entity && typeof entity === "object") {
      const item = entity as Record<string, unknown>;
      const label = [item.name, item.text, item.label, item.term].find((candidate) => typeof candidate === "string" && candidate.trim());
      return typeof label === "string" ? [label] : [];
    }
    return [];
  });
  if (entities.length !== (Array.isArray(raw.entities) ? raw.entities.length : 0)) repaired = true;
  return {
    ...raw,
    entities,
    topics,
    topicEvidence,
    relations: [],
    // Missing flag means the model skipped an explicit verdict: send to review.
    needsReview: typeof raw.needsReview === "boolean" ? raw.needsReview || repaired : true,
  };
}

function validationError(value: unknown, job: EnrichmentJob): string | undefined {
  if (!value || typeof value !== "object") return "response is not an object";
  const v = value as Record<string, unknown>;
  // summary is a courtesy field (combine falls back to ""); models increasingly
  if (!Array.isArray(v.topics) || !Array.isArray(v.entities) || !Array.isArray(v.topicEvidence) || typeof v.needsReview !== "boolean") return "required arrays or needsReview are missing";
  if (typeof v.summary !== "string" && !("topics" in v)) return "summary is missing";
  const rawRelations = v.relations ?? [];
  if (!Array.isArray(rawRelations)) return "relations must be an array when present";
  const rawEntities = v.entities as unknown[];
  if (v.topics.length > 8 || rawEntities.length > 12 || rawRelations.length > 8 || v.topicEvidence.length !== v.topics.length) return "result exceeds limits or topic evidence count differs";
  if (rawEntities.some((entity) => typeof entity !== "string")) return "an entity is not a string";
  const topics = v.topics as string[];
  if (topics.some((id) => !job.allowedTopicIds.includes(id))) return "an unknown topic was returned";
  if (new Set(topics).size !== topics.length) return "a topic was repeated";
  const evidence = v.topicEvidence as Array<{ topicId: string; quote: string }>;
  if (evidence.some((e) => typeof e?.topicId !== "string" || !job.allowedTopicIds.includes(e.topicId) || typeof e.quote !== "string" || !e.quote.trim() || !sourceIncludesQuote(job.sourceText, e.quote))) return "topic evidence is not an exact source quote";
  const evidenceTopicIds = evidence.map((item) => item.topicId);
  if (new Set(evidenceTopicIds).size !== topics.length || topics.some((topicId) => !evidenceTopicIds.includes(topicId))) return "topic evidence must cover each selected topic exactly once";
  const relations = rawRelations as Array<{ targetId: string; type: string; explanation: string; confidence: number; evidenceQuote: string }>;
  for (const relation of relations) {
    if (!job.candidateTargets.some((candidate) => candidate.id === relation.targetId)) return "a relation target is outside candidateTargets";
    if (!(RELATION_TYPES as readonly string[]).includes(relation.type)) return "a relation type is invalid";
    if (typeof relation.explanation !== "string" || !relation.explanation.trim()) return "a relation explanation is missing";
    if (typeof relation.confidence !== "number" || !Number.isFinite(relation.confidence) || relation.confidence < 0 || relation.confidence > 1) return "a relation confidence is invalid";
    if (typeof relation.evidenceQuote !== "string" || !relation.evidenceQuote.trim() || !sourceIncludesQuote(job.sourceText, relation.evidenceQuote)) return "relation evidence is not an exact source quote";
  }
  return undefined;
}

export function valid(value: unknown, job: EnrichmentJob): value is EnrichmentResult {
  return validationError(value, job) === undefined;
}

async function keyFromEnv() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  try {
    return loadDotEnv(await readFile(".env", "utf8"));
  } catch {
    return "";
  }
}

const sleep = (ms: number) => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

interface ProviderSpec { name: string; endpoint: string; extraHeaders: Record<string, string> }
const PROVIDERS: Record<string, ProviderSpec> = {
  openrouter: { name: "openrouter", endpoint: "https://openrouter.ai/api/v1/chat/completions", extraHeaders: { "HTTP-Referer": "https://staniverse.xyz", "X-Title": "Staniverse enrichment pilot" } },
  // Z.ai exposes an OpenAI-compatible chat/completions endpoint; GLM flash
  // models may reject strict json_schema, so the caller retries schemaless.
  zai: { name: "zai", endpoint: "https://api.z.ai/api/paas/v4/chat/completions", extraHeaders: {} },
};

async function callOpenRouter(job: EnrichmentJob, model: string, apiKey: string, provider: ProviderSpec = PROVIDERS.openrouter): Promise<EnrichmentResult> {
  const sourceEvidence = buildEvidenceFragments(job.sourceText);
  let useSchema = true;
  let lastError = "";
  const maxAttempts = model.endsWith(":free") ? 1 : 4;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) await sleep(attempt === 1 ? 2_000 : 8_000);
    let response: Response;
    try {
      response = await fetch(provider.endpoint, {
        method: "POST",
        headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json", ...provider.extraHeaders },
        body: JSON.stringify({
          model,
          temperature: 0,
 ...(useSchema ? [{ response_format: { type: "json_schema", json_schema: { name: "staniverse_enrichment", strict: true, schema: responseSchema } } }] : []),
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: JSON.stringify({ sourceKind: job.sourceKind, sourceTitle: job.sourceTitle, sourceUrl: job.sourceUrl, sourceEvidence, existingTags: job.existingTags, allowedTopicIds: job.allowedTopicIds, topicDefinitions: job.topicDefinitions }) },
          ],
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      lastError = String(error instanceof Error ? error.message : error);
      continue;
    }
    if (response.ok) {
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const text = payload.choices?.[0]?.message?.content;
      if (typeof text !== "string") { lastError = "no JSON content"; continue; }
      const stripped = text.replace(/^\s*```(?:json)?\s*\n?/i, "").replace(/\n?\s*```\s*$/i, "");
      const parseFirstObject = (raw: string): unknown => {
        try {
          return JSON.parse(raw);
        } catch {
          // GLM flash occasionally appends prose or a second fragment after
          // the object; salvage the outermost {...} instead of failing.
          const start = raw.indexOf("{");
          const end = raw.lastIndexOf("}");
          if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
          throw new Error("no JSON object in response");
        }
      };
      try {
        const parsed = retainGroundedTopics(hydrateEvidence(parseFirstObject(stripped), sourceEvidence), job);
        if (!valid(parsed, job)) throw new Error(validationError(parsed, job));
        return { ...parsed, summary: typeof parsed.summary === "string" ? parsed.summary : "", id: job.id, textHash: job.textHash, promptVersion: PROMPT_VERSION, provider: provider.name, model, createdAt: new Date().toISOString() };
      } catch (error) {
        // Malformed or contract-invalid model output is retriable like a transport failure.
        lastError = String(error instanceof Error ? error.message : error);
        continue;
      }
    }
    const errorText = await response.text();
    lastError = response.status + ": " + errorText.slice(0, 200);
    if (response.status === 429 || response.status >= 500) continue;
    if (response.status === 400 && useSchema && /response_format|json_schema/i.test(errorText)) { useSchema = false; continue; }
    throw new Error(provider.name + " " + response.status + ": " + errorText.slice(0, 200));
  }
  throw new Error(provider.name + " retries exhausted for " + job.id + " (" + lastError + ")");
}

function jobSplit(id: string): PilotSplit {
  return pilotSplitForSource(id) ?? "all";
}

async function writeBundle(output: string, results: EnrichmentResult[], errors: Array<{ id: string; stage: string; error: string }>) {
  const bundle: EnrichmentBundle = { version: 1, generatedAt: new Date().toISOString(), results, ...(errors.length ? { errors } : {}) };
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(resolve(output), JSON.stringify(bundle, null, 2) + "\n", "utf8");
}

async function remainingBudget(apiKey: string): Promise<number | null> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: "Bearer " + apiKey } });
    if (!response.ok) return null;
    const payload = await response.json() as { data?: { limit_remaining?: unknown } };
    return typeof payload.data?.limit_remaining === "number" ? payload.data.limit_remaining : null;
  } catch {
    return null;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name: string) => argv.includes(name);
  const value = (name: string) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const full = flag("--full");
  const split = (value("--split") ?? "all") as PilotSplit;
  const limit = Number(value("--limit"));
  const positional = argv.filter((v, i) => !v.startsWith("--") && !["--pilot", "--full", "--split", "--limit", "--provider"].includes(argv[i - 1] ?? ""));
  const input = positional[0] ?? "pipeline/enrichment/jobs/pilot.jsonl";
  const output = positional[1] ?? (full ? "pipeline/enrichment/review/full-openrouter.json" : "pipeline/enrichment/review/pilot-openrouter.json");
  const providerName = value("--provider") ?? "openrouter";
  const provider = PROVIDERS[providerName];
  if (!provider) throw new Error(`Unknown provider "${providerName}"; known: ${Object.keys(PROVIDERS).join(", ")}.`);
  const defaultModel = providerName === "zai" ? "glm-5.3-flash" : DEFAULT_MODEL;
  const model = positional[2] ?? (providerName === "zai" ? process.env.ZAI_MODEL : process.env.OPENROUTER_MODEL) ?? defaultModel;
  if (!flag("--pilot") && !full) throw new Error("Refusing enrichment run: pass --pilot or --full explicitly.");
  if (!full) {
    if (!["tuning", "holdout", "all"].includes(split)) throw new Error("--split must be tuning, holdout or all.");
    if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new Error("--limit must be a positive integer <= 30.");
  }
  const envKey = providerName === "zai" ? "ZAI_API_KEY" : "OPENROUTER_API_KEY";
  const apiKey = providerName === "zai" ? (process.env.ZAI_API_KEY ?? await loadZaiKey()) : await keyFromEnv();
  if (!apiKey) throw new Error(envKey + " is required (process environment or local .env).");
  const jobs = (await readFile(resolve(input), "utf8")).split(/\r?\n/).filter(Boolean)
    .map((line) => JSON.parse(line) as EnrichmentJob)
    .filter((job) => full || split === "all" || jobSplit(job.id) === split);
  // `limit` counts original sources: once a source is included, all of its segment jobs run.
  const takenSources = new Set<string>();
  const selected: EnrichmentJob[] = [];
  for (const job of jobs) {
    const baseId = segmentBaseId(job.id);
    if (!full) {
      if (!takenSources.has(baseId)) {
        if (takenSources.size >= limit) continue;
        takenSources.add(baseId);
      }
    }
    selected.push(job);
  }
  await mkdir(resolve(CACHE_DIR), { recursive: true });
  const results: EnrichmentResult[] = [];
  const errors: Array<{ id: string; stage: string; error: string }> = [];
  const concurrency = full ? 6 : 3;
  const budgetFloor = full ? 0.1 : 0;
  let next = 0;
  let completed = 0;
  let stoppedForBudget = false;

  // Cache reuse across models: a validated enrichment does not depend on which
  // cheap model produced it. Weak results (no topics + needsReview) count as
  // misses so a stronger model can re-tag them.
  const FALLBACK_CACHE_MODELS = [DEFAULT_MODEL, "z-ai/glm-5.3-flash"].filter((candidate) => candidate !== model);
  const readCache = async (path: string) =>
    readFile(path, "utf8").then((text) => JSON.parse(text) as EnrichmentResult).catch(() => undefined);
  const reusable = (cached: EnrichmentResult | undefined, job: EnrichmentJob): cached is EnrichmentResult =>
    !!cached && cached.id === job.id && valid(cached, job) && (cached.topics.length > 0 || cached.needsReview !== true);
  const processJob = async (job: EnrichmentJob) => {
    try {
      const cachePath = resolve(CACHE_DIR, cacheKey(job, model) + ".json");
      const cached = await readCache(cachePath);
      if (reusable(cached, job)) {
        results.push(cached);
        return;
      }
      for (const fallbackModel of FALLBACK_CACHE_MODELS) {
        const legacy = await readCache(resolve(CACHE_DIR, cacheKey(job, fallbackModel) + ".json"));
        if (!reusable(legacy, job)) continue;
        results.push(legacy);
        await writeFile(cachePath, JSON.stringify(legacy), "utf8");
        return;
      }
      const result = await callOpenRouter(job, model, apiKey, provider);
      results.push(result);
      await writeFile(cachePath, JSON.stringify(result), "utf8");
    } catch (error) {
      errors.push({ id: job.id, stage: "enrich", error: String(error instanceof Error ? error.message : error) });
    }
  };

  const worker = async () => {
    while (next < selected.length && !stoppedForBudget) {
      const job = selected[next];
      next += 1;
      await processJob(job);
      completed += 1;
      if (completed % 10 === 0) await writeBundle(output, results, errors);
      if (provider.name === "openrouter" && budgetFloor > 0 && completed % 25 === 0) {
        const remaining = await remainingBudget(apiKey);
        if (remaining !== null && remaining < budgetFloor) stoppedForBudget = true;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, worker));
  await writeBundle(output, results, errors);
  console.log(JSON.stringify({ results: results.length, errors: errors.length, ...(full ? { full: true } : { split }), model, output: resolve(output), ...(stoppedForBudget ? { stoppedForBudget: true, completedJobs: completed, totalJobs: selected.length } : {}) }));
  if (errors.length || stoppedForBudget) process.exitCode = 1;
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/pipeline/enrichment/openrouter.ts")) main();
