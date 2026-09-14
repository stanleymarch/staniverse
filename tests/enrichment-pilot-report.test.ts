import test from "node:test";
import assert from "node:assert/strict";
import { accountPilot, renderPilotReport, splitOfJob } from "../pipeline/enrichment/pilot-report";
import { PILOT_HOLDOUT_IDS, PILOT_TUNING_IDS } from "../pipeline/enrichment/pilot-manifest";
import type { EnrichmentBundle, EnrichmentJob, EnrichmentResult } from "../pipeline/enrichment/types";

const PROJECT = "project:metavyatka";
const pub = (n: number | string) => `publication:telegram:staniverse:${n}`;
const tuningIds = [...PILOT_TUNING_IDS].map(pub);
const holdoutIds = [...PILOT_HOLDOUT_IDS].map(pub);

function job(id: string, overrides: Partial<EnrichmentJob> = {}): EnrichmentJob {
  const sourceId = id.startsWith("project:") ? id : id.split(":").at(-1) ?? id;
  return {
    id,
    textHash: "hash-" + id,
    promptVersion: "staniverse-pilot-v2",
    language: "ru",
    sourceKind: id.startsWith("project:") ? "project" : "telegram-post",
    sourceTitle: "Источник " + id,
    sourceUrl: id.startsWith("project:") ? "" : `https://t.me/staniverse/${sourceId}`,
    sourceText: "Исходный текст источника " + id,
    existingTags: [],
    candidateTargets: [],
    allowedTopicIds: ["ai", "games", "xr"],
    topicDefinitions: [{ id: "ai", label: "AI", family: "ai", definition: "Искусственный интеллект" }],
    ...overrides,
  };
}

function result(id: string, overrides: Partial<EnrichmentResult> = {}): EnrichmentResult {
  return {
    id,
    textHash: "hash-" + id,
    promptVersion: "staniverse-pilot-v2",
    provider: "openrouter",
    model: "test/model",
    createdAt: "2026-09-09T00:00:00.000Z",
    summary: "Резюме " + id,
    topics: [],
    topicEvidence: [],
    entities: [],
    relations: [],
    needsReview: false,
    ...overrides,
  };
}

function bundle(_jobs: EnrichmentJob[], results: EnrichmentResult[], errors: Array<{ id: string; stage: string; error: string }> = []): EnrichmentBundle {
  return { version: 1, generatedAt: "2026-09-09T00:00:00.000Z", results, ...(errors.length ? { errors } : {}) };
}

test("splitOfJob classifies publications, the project source and segment ids by manifest split", () => {
  assert.equal(splitOfJob(pub(PILOT_TUNING_IDS[0])), "tuning");
  assert.equal(splitOfJob(pub(PILOT_HOLDOUT_IDS[0])), "holdout");
  assert.equal(splitOfJob(PROJECT), "tuning");
  assert.equal(splitOfJob(pub(PILOT_HOLDOUT_IDS[0]) + "::1"), "holdout");
  assert.equal(splitOfJob(PROJECT + "::2"), "tuning");
  assert.equal(splitOfJob("publication:telegram:staniverse:999999"), "other");
});

test("full 16+14 run reports every requested source as successfully marked", () => {
  const jobs = [...tuningIds, ...holdoutIds, PROJECT].map((id) => job(id));
  const report = renderPilotReport(jobs, bundle(jobs, jobs.map((j) => result(j.id))));
  assert.match(report, /Набор источников: 30 — tuning: 16 \(15 публикаций, 1 проектный источник \(`project:metavyatka`\)\); holdout: 14\./);
  assert.match(report, /\| tuning \| 16 \| 16 \| 0 \| 0 \| 0 \|/);
  assert.match(report, /\| holdout \| 14 \| 14 \| 0 \| 0 \| 0 \|/);
  assert.match(report, /\| \*\*Итого\*\* \| \*\*30\*\* \| \*\*30\*\* \| \*\*0\*\* \| \*\*0\*\* \| \*\*0\*\* \|/);
  assert.match(report, /Hash gate: \*\*PASS\*\*/);
});

test("partial tuning run over the full set does not read as N-of-30 processed and never counts API errors as results", () => {
  const jobs = [...tuningIds, ...holdoutIds, PROJECT].map((id) => job(id));
  const validIds = tuningIds.slice(0, 10);
  const errorIds = [...tuningIds.slice(10), PROJECT];
  const errors = errorIds.map((id) => ({ id, stage: "enrich", error: "сбой " + id }));
  const report = renderPilotReport(jobs, bundle(jobs, validIds.map((id) => result(id)), errors));

  assert.match(report, /\| tuning \| 16 \| 10 \| 0 \| 6 \| 0 \|/);
  assert.match(report, /\| holdout \| 14 \| 0 \| 0 \| 0 \| 14 \|/);
  assert.match(report, /\| \*\*Итого\*\* \| \*\*30\*\* \| \*\*10\*\* \| \*\*0\*\* \| \*\*6\*\* \| \*\*14\*\* \|/);
  assert.doesNotMatch(report, /Обработано/);
  assert.doesNotMatch(report, /Результат отсутствует \(ошибка/);

  const unprocessed = report.slice(report.indexOf(pub(416)), report.indexOf(pub(451)));
  assert.match(unprocessed, /· holdout ·/);
  assert.match(unprocessed, /Оригинал: https:\/\/t\.me\/staniverse\/416/);
  assert.match(unprocessed, /Исходный текст источника publication:telegram:staniverse:416/);
  assert.match(unprocessed, /- Статус: не обработан в этом прогоне\./);

  const projectSection = report.slice(report.indexOf("## Источник project:metavyatka"));
  assert.match(projectSection, /- ID: `project:metavyatka` · tuning \(project source\) ·/);
  assert.match(projectSection, /- Статус: ошибка обработки \(этап `enrich`\): сбой project:metavyatka/);
  assert.match(report, /\| project:metavyatka \| tuning \| enrich \| сбой project:metavyatka \|/);
  assert.match(report, /- Статус: размечено успешно\./);
});

test("tuning-only source set is accounted out of 16 and never implies holdout or the full 30", () => {
  const jobs = [...tuningIds, PROJECT].map((id) => job(id));
  const unattempted = tuningIds[tuningIds.length - 1];
  const errorIds = [PROJECT, tuningIds[0]];
  const errors = errorIds.map((id) => ({ id, stage: "enrich", error: "сбой " + id }));
  const results = tuningIds.slice(1, tuningIds.length - 1).map((id) => result(id));
  const report = renderPilotReport(jobs, bundle(jobs, results, errors));

  assert.match(report, /Набор источников: 16 — tuning: 16 \(15 публикаций, 1 проектный источник \(`project:metavyatka`\)\)\./);
  assert.match(report, /\| tuning \| 16 \| 13 \| 0 \| 2 \| 1 \|/);
  assert.match(report, /\| \*\*Итого\*\* \| \*\*16\*\* \| \*\*13\*\* \| \*\*0\*\* \| \*\*2\*\* \| \*\*1\*\* \|/);
  assert.doesNotMatch(report, /holdout/);
  assert.doesNotMatch(report, /\b30\b/);
  const unattemptedSection = report.slice(report.indexOf("## Источник " + unattempted), report.indexOf("## Источник " + PROJECT));
  assert.match(unattemptedSection, /- Статус: не обработан в этом прогоне\./);
});

test("accounting distinguishes valid results from explicit API errors", () => {
  const jobs = [job(pub(3)), job(pub(4))];
  const errors = [{ id: pub(4), stage: "enrich", error: "OpenRouter 500" }];
  const totals = accountPilot(jobs, bundle(jobs, [result(pub(3))], errors)).total;
  assert.deepEqual(totals, { total: 2, valid: 1, stale: 0, errors: 1, unattempted: 0 });
  const report = renderPilotReport(jobs, bundle(jobs, [result(pub(3))], errors));
  assert.match(report, /\| \*\*Итого\*\* \| \*\*2\*\* \| \*\*1\*\* \| \*\*0\*\* \| \*\*1\*\* \| \*\*0\*\* \|/);
});

test("a matching id with a different text hash is stale, never successful", () => {
  const jobs = [job(pub(3))];
  const staleResult = result(pub(3), { textHash: "old-source-hash" });
  const totals = accountPilot(jobs, bundle(jobs, [staleResult])).total;
  assert.deepEqual(totals, { total: 1, valid: 0, stale: 1, errors: 0, unattempted: 0 });
  const report = renderPilotReport(jobs, bundle(jobs, [staleResult]));
  assert.match(report, /результат не применим — textHash не совпадает/);
  assert.doesNotMatch(report, /Статус: размечено успешно/);
});

test("segmented jobs count as one source and require every segment to succeed", () => {
  const base = pub(414);
  const jobs = [job(base + "::1"), job(base + "::2")];
  const complete = accountPilot(jobs, bundle(jobs, jobs.map((item) => result(item.id)))).total;
  assert.deepEqual(complete, { total: 1, valid: 1, stale: 0, errors: 0, unattempted: 0 });

  const partial = accountPilot(jobs, bundle(jobs, [result(base + "::1")])).total;
  assert.deepEqual(partial, { total: 1, valid: 0, stale: 0, errors: 0, unattempted: 1 });

  const failed = accountPilot(jobs, bundle(jobs, [result(base + "::1")], [
    { id: base + "::2", stage: "enrich", error: "OpenRouter 500" },
  ])).total;
  assert.deepEqual(failed, { total: 1, valid: 0, stale: 0, errors: 1, unattempted: 0 });
});

test("result details, evidence, source context and hashtags stay visible and truthful", () => {
  const jobs = [
    job(pub(3), {
      existingTags: ["vr", "метавселенная"],
      candidateTargets: [{ id: "work:metavyatka", title: "MetaVyatka", kind: "work", summaryExcerpt: "Цифровой архив Вятки" }],
    }),
  ];
  const relations = [{ targetId: "work:metavyatka", type: "mentions" as const, explanation: "Пост описывает использование проекта", confidence: 0.85, evidenceQuote: "работаю над MetaVyatka" }];
  const results = [
    result(pub(3), {
      needsReview: true,
      summary: "Пост о проекте MetaVyatka и XR.",
      topics: ["ai", "xr"],
      topicEvidence: [{ topicId: "ai", quote: "нейросети для архива" }, { topicId: "xr", quote: "XR-форма разговора" }],
      entities: ["OpenAI", "MetaVyatka"],
      relations,
    }),
    // Stale bundle entry for a source that is not part of the job set.
    result("publication:telegram:staniverse:999999"),
  ];
  const report = renderPilotReport(jobs, bundle(jobs, results));
  assert.match(report, /- Исходные hashtags: `vr`, `метавселенная`/);
  assert.match(report, /Оригинал: https:\/\/t\.me\/staniverse\/3/);
  assert.match(report, /Исходный текст источника publication:telegram:staniverse:3/);
  assert.match(report, /- Статус: размечено успешно\./);
  assert.match(report, /- Модель: `test\/model` · promptVersion: `staniverse-pilot-v2` · needsReview: true/);
  assert.match(report, /\| `ai` \| нейросети для архива \|/);
  assert.match(report, /\| `xr` \| XR-форма разговора \|/);
  assert.match(report, /### Сущности[\s\S]*?- MetaVyatka/);
  assert.match(report, /\| MetaVyatka \| `mentions` \| 85% \| Пост описывает использование проекта \| работаю над MetaVyatka \|/);
  assert.match(report, /- `publication:telegram:staniverse:3`/);
  assert.match(report, /Бандл содержит 1 запись по источникам вне набора/);
  assert.doesNotMatch(report, /Нулевая разметка тем/);
  assert.equal(accountPilot(jobs, bundle(jobs, results)).total.valid, 1);
});
