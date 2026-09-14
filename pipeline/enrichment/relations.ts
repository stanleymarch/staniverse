import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildEvidenceFragments, DEFAULT_MODEL, loadDotEnv, type EvidenceFragment } from "./openrouter";
import { relationCandidateSignals, segmentBaseId } from "./prepare";
import type { EnrichmentBundle, EnrichmentJob, EnrichmentRelationType, EnrichmentResult } from "./types";
export const RELATION_PROMPT_VERSION = "staniverse-openrouter-relations-v3";
const CACHE_DIR = "pipeline/enrichment/review/openrouter-relation-cache";
const RELATION_TYPES: readonly EnrichmentRelationType[] = ["mentions", "references", "documents", "develops", "inspired", "uses", "part-of", "related"];

const relationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["relations", "needsReview"],
  properties: {
    relations: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["targetId", "type", "explanation", "confidence", "evidenceId"],
        properties: {
          targetId: { type: "string" },
          type: { type: "string", enum: RELATION_TYPES },
          explanation: { type: "string" },
          confidence: { type: "number", minimum: 0.75, maximum: 1 },
          evidenceId: { type: "string" },
        },
      },
    },
    needsReview: { type: "boolean" },
  },
} as const;

const SYSTEM_PROMPT = [
  "Ты проверяешь доказательные связи из source с одним из candidateTargets. Верни строгий JSON.",
  "Направление каждой связи: source -> target. Предлагай связь только если sourceEvidence явно называет target, содержит ссылку на него или однозначно описывает именно этот объект.",
  "Совпадение темы, технологии, города или общего слова не является связью. Если доказательства нет, relations должен быть пустым.",
  "evidenceId обязан указывать на переданный фрагмент sourceEvidence. Не копируй цитату: система подставит точный фрагмент.",
  "mentions - простое явное упоминание; references - source ссылается на target как на отдельный материал или источник; documents - source документирует target-проект, работу, их процесс или результат; develops - source описывает работу, непосредственно развивающую target; uses - source явно использует target или его результат; inspired - source прямо говорит, что target вдохновил его; part-of - source явно является частью target; related - только явная сильная связь, которая не подходит к другим типам, а не тематическое сходство.",
  "Для одного target верни только один, самый содержательный тип связи: develops/part-of/uses/documents/inspired/references сильнее простого mentions, а related используется последним.",
  "Не предлагай обратную связь: например, если source-проект перечисляет свою работу, part-of в направлении project -> work неверен; выбери documents/related только при явном основании либо не предлагай ничего.",
  "confidence: 0.95-1 для прямой ссылки или названия вместе с утверждением о связи; 0.8-0.94 для явной связи с неоднозначным типом. Всё слабее 0.75 пропускай и ставь needsReview=true.",
].join(" ");

interface RelationResponse {
  relations: Array<{ targetId: string; type: EnrichmentRelationType; explanation: string; confidence: number; evidenceQuote: string }>;
  needsReview: boolean;
}

type GroundedCandidate = EnrichmentJob["candidateTargets"][number] & { match: string[] };

/** Keeps only candidates explicitly named or linked by the source. Lexical
 * similarity may rank a candidate in prepare.ts, but can never authorize a
 * semantic relation proposal by itself. */
export function groundedRelationCandidates(job: EnrichmentJob): GroundedCandidate[] {
  return job.candidateTargets.flatMap((candidate) => {
    const match = relationCandidateSignals(job.sourceText, candidate);
    return match.length ? [{ ...candidate, match }] : [];
  });
}

export function validateAndHydrateRelations(value: unknown, job: EnrichmentJob, fragments: EvidenceFragment[]): RelationResponse {
  if (!value || typeof value !== "object") throw new Error("relation response is not an object");
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.relations) || typeof raw.needsReview !== "boolean") throw new Error("relations or needsReview are missing");
  if (raw.relations.length > 5) throw new Error("relation response exceeds five proposals");
  const candidates = new Set(groundedRelationCandidates(job).map((candidate) => candidate.id));
  const evidence = new Map(fragments.map((fragment) => [fragment.id, fragment.text]));
  const seen = new Set<string>();
  const relations: RelationResponse["relations"] = [];
  for (const candidate of raw.relations) {
    if (!candidate || typeof candidate !== "object") throw new Error("relation proposal is not an object");
    const item = candidate as Record<string, unknown>;
    if (typeof item.targetId !== "string" || !candidates.has(item.targetId)) throw new Error("relation target is outside candidateTargets");
    if (typeof item.type !== "string" || !(RELATION_TYPES as readonly string[]).includes(item.type)) throw new Error("relation type is invalid");
    if (typeof item.explanation !== "string" || !item.explanation.trim()) throw new Error("relation explanation is missing");
    if (typeof item.confidence !== "number" || !Number.isFinite(item.confidence) || item.confidence < 0.75 || item.confidence > 1) throw new Error("relation confidence is outside 0.75-1");
    if (typeof item.evidenceId !== "string" || !evidence.has(item.evidenceId)) throw new Error("relation evidenceId is unknown");
    const key = item.targetId;
    if (seen.has(key)) throw new Error("duplicate relation proposal for one target");
    seen.add(key);
    relations.push({
      targetId: item.targetId,
      type: item.type as EnrichmentRelationType,
      explanation: item.explanation.trim(),
      confidence: item.confidence,
      evidenceQuote: evidence.get(item.evidenceId) as string,
    });
  }
  return { relations, needsReview: raw.needsReview };
}

async function keyFromEnv() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  try {
    return loadDotEnv(await readFile(".env", "utf8"));
  } catch {
    return "";
  }
}

const sleep = (ms: number) => new Promise<void>((resolvePromise) => setTimeout(resolvePromise, ms));

async function callOpenRouter(job: EnrichmentJob, base: EnrichmentResult, model: string, apiKey: string): Promise<EnrichmentResult> {
  const fragments = buildEvidenceFragments(job.sourceText);
  const candidateTargets = groundedRelationCandidates(job);
  if (candidateTargets.length === 0) {
    return { ...base, promptVersion: RELATION_PROMPT_VERSION, model, relations: [], createdAt: new Date().toISOString() };
  }
  const requestBody = JSON.stringify({
    model,
    temperature: 0,
    response_format: { type: "json_schema", json_schema: { name: "staniverse_relations", strict: true, schema: relationSchema } },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({ sourceKind: job.sourceKind, sourceTitle: job.sourceTitle, sourceUrl: job.sourceUrl, sourceEvidence: fragments, candidateTargets }) },
    ],
  });
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await sleep(attempt === 1 ? 2_000 : 8_000);
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json", "HTTP-Referer": "https://staniverse.xyz", "X-Title": "Staniverse relation pilot" },
        body: requestBody,
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) {
        const errorText = await response.text();
        lastError = response.status + ": " + errorText.slice(0, 200);
        if (response.status === 429 || response.status >= 500) continue;
        throw new Error(lastError);
      }
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const text = payload.choices?.[0]?.message?.content;
      if (typeof text !== "string") { lastError = "no JSON content"; continue; }
      const relationResult = validateAndHydrateRelations(JSON.parse(text), job, fragments);
      return {
        ...base,
        promptVersion: RELATION_PROMPT_VERSION,
        model,
        relations: relationResult.relations,
        needsReview: base.needsReview || relationResult.needsReview,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      lastError = String(error instanceof Error ? error.message : error);
    }
  }
  throw new Error("OpenRouter relation retries exhausted for " + job.id + " (" + lastError + ")");
}

function cacheKey(job: EnrichmentJob, base: EnrichmentResult, model: string) {
  return createHash("sha256").update(JSON.stringify({ sourceHash: job.textHash, basePrompt: base.promptVersion, candidates: job.candidateTargets, model, prompt: RELATION_PROMPT_VERSION })).digest("hex");
}

async function writeBundle(output: string, results: EnrichmentResult[], errors: Array<{ id: string; stage: string; error: string }>) {
  const bundle: EnrichmentBundle = { version: 1, generatedAt: new Date().toISOString(), results, ...(errors.length ? { errors } : {}) };
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(resolve(output), JSON.stringify(bundle, null, 2) + "\n", "utf8");
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name: string) => argv.includes(name);
  const value = (name: string) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const limit = Number(value("--limit"));
  const positional = argv.filter((item, index) => !item.startsWith("--") && !["--pilot", "--limit"].includes(argv[index - 1] ?? ""));
  const jobsPath = positional[0] ?? "pipeline/enrichment/jobs/pilot.jsonl";
  const topicBundlePath = positional[1] ?? "pipeline/enrichment/review/pilot-openrouter.json";
  const output = positional[2] ?? "pipeline/enrichment/review/pilot-openrouter-with-relations.json";
  const model = positional[3] ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
  if (!flag("--pilot")) throw new Error("Refusing relation run: pass --pilot explicitly.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new Error("--limit must be a positive integer <= 30.");
  const apiKey = await keyFromEnv();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required (process environment or local .env).");
  const jobs = (await readFile(resolve(jobsPath), "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as EnrichmentJob);
  const topicBundle = JSON.parse(await readFile(resolve(topicBundlePath), "utf8")) as EnrichmentBundle;
  const baseById = new Map(topicBundle.results.map((result) => [result.id, result]));
  const sourceIds = new Set<string>();
  const selected: EnrichmentJob[] = [];
  for (const job of jobs) {
    const sourceId = segmentBaseId(job.id);
    if (!sourceIds.has(sourceId)) {
      if (sourceIds.size >= limit) continue;
      sourceIds.add(sourceId);
    }
    selected.push(job);
  }
  await mkdir(resolve(CACHE_DIR), { recursive: true });
  const results: EnrichmentResult[] = [];
  const errors: Array<{ id: string; stage: string; error: string }> = [];
  let next = 0;
  let completed = 0;
  const worker = async () => {
    while (next < selected.length) {
      const job = selected[next++];
      const base = baseById.get(job.id);
      if (!base) {
        errors.push({ id: job.id, stage: "relations", error: "topic result is missing" });
        continue;
      }
      const path = resolve(CACHE_DIR, cacheKey(job, base, model) + ".json");
      try {
        const cached = await readFile(path, "utf8").then((text) => JSON.parse(text) as EnrichmentResult).catch(() => undefined);
        const result = cached?.id === job.id && cached.textHash === job.textHash && cached.promptVersion === RELATION_PROMPT_VERSION
          ? cached
          : await callOpenRouter(job, base, model, apiKey);
        results.push(result);
        if (result !== cached) await writeFile(path, JSON.stringify(result), "utf8");
      } catch (error) {
        errors.push({ id: job.id, stage: "relations", error: String(error instanceof Error ? error.message : error) });
      }
      completed += 1;
      if (completed % 5 === 0) await writeBundle(output, results, errors);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, selected.length) }, worker));
  await writeBundle(output, results, errors);
  console.log(JSON.stringify({ sources: sourceIds.size, jobs: selected.length, results: results.length, errors: errors.length, model, output: resolve(output) }));
  if (errors.length) process.exitCode = 1;
}

if (process.argv[1]?.replaceAll("\\", "/").includes("/relations.ts")) await main();
