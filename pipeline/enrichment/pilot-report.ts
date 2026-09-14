import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { EnrichmentBundle, EnrichmentJob } from "./types";
import { pilotSplitForSource } from "./pilot-manifest";

type SplitName = "tuning" | "holdout" | "other";
interface SplitAccounting {
  total: number;
  valid: number;
  stale: number;
  errors: number;
  unattempted: number;
}

export interface PilotAccounting {
  bySplit: Record<SplitName, SplitAccounting>;
  total: SplitAccounting;
  /** Bundle entries whose id is not among the reported job sources. */
  orphanResults: string[];
  orphanErrors: string[];
}

const DEFAULT_JOBS_PATH = "pipeline/enrichment/jobs/pilot.jsonl";
const DEFAULT_BUNDLE_PATH = "pipeline/enrichment/review/pilot-openrouter.json";
const DEFAULT_OUTPUT_PATH = "docs/taxonomy-pilot-results.md";

const jobsPath = process.argv[2] ?? DEFAULT_JOBS_PATH;
const bundlePath = process.argv[3] ?? DEFAULT_BUNDLE_PATH;
const outputPath = process.argv[4] ?? DEFAULT_OUTPUT_PATH;

const ZERO: SplitAccounting = { total: 0, valid: 0, stale: 0, errors: 0, unattempted: 0 };
const esc = (value: string) => value.replace(/\|/g, "\\|").replace(/\n+/g, " ");
const excerpt = (value: string, limit = 280) => (value.length > limit ? value.slice(0, limit - 1) + "…" : value);

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Classifies source and segment IDs through the canonical pilot manifest. */
export function splitOfJob(id: string): SplitName {
  return pilotSplitForSource(id) ?? "other";
}

/** True totals of the source set; segmented jobs count as one original source.
 * A source is successful only when every segment has a valid result. Any segment
 * error makes the source an error; partially attempted sources remain unattempted. */
export function accountPilot(jobs: EnrichmentJob[], bundle: EnrichmentBundle): PilotAccounting {
  const jobsBySource = new Map<string, EnrichmentJob[]>();
  for (const job of jobs) {
    const sourceId = job.id.replace(/::\d+$/, "");
    const sourceJobs = jobsBySource.get(sourceId) ?? [];
    sourceJobs.push(job);
    jobsBySource.set(sourceId, sourceJobs);
  }
  const jobIds = new Set(jobs.map((job) => job.id));
  const resultsById = new Map(bundle.results.map((result) => [result.id, result]));
  const errorIds = new Set((bundle.errors ?? []).map((error) => error.id));
  const bySplit: Record<SplitName, SplitAccounting> = { tuning: { ...ZERO }, holdout: { ...ZERO }, other: { ...ZERO } };
  for (const [sourceId, sourceJobs] of jobsBySource) {
    const acc = bySplit[splitOfJob(sourceId)];
    acc.total += 1;
    if (sourceJobs.every((job) => resultsById.get(job.id)?.textHash === job.textHash)) acc.valid += 1;
    else if (sourceJobs.some((job) => errorIds.has(job.id))) acc.errors += 1;
    else if (sourceJobs.some((job) => {
      const result = resultsById.get(job.id);
      return result !== undefined && result.textHash !== job.textHash;
    })) acc.stale += 1;
    else acc.unattempted += 1;
  }
  const total = { ...ZERO };
  for (const split of Object.keys(bySplit) as SplitName[]) {
    total.total += bySplit[split].total;
    total.valid += bySplit[split].valid;
    total.stale += bySplit[split].stale;
    total.errors += bySplit[split].errors;
    total.unattempted += bySplit[split].unattempted;
  }
  return {
    bySplit,
    total,
    orphanResults: bundle.results.filter((result) => !jobIds.has(result.id)).map((result) => result.id),
    orphanErrors: (bundle.errors ?? []).filter((error) => !jobIds.has(error.id)).map((error) => error.id),
  };
}

export function renderPilotReport(jobs: EnrichmentJob[], bundle: EnrichmentBundle): string {
  const sourceIds = new Set(jobs.map((job) => job.id));
  const results = new Map(bundle.results.map((result) => [result.id, result]));
  const errorsById = new Map((bundle.errors ?? []).map((error) => [error.id, error]));
  const { bySplit, total, orphanResults, orphanErrors } = accountPilot(jobs, bundle);

  const sourceIdsBySplit = new Map<SplitName, Set<string>>();
  for (const job of jobs) {
    const split = splitOfJob(job.id);
    const ids = sourceIdsBySplit.get(split) ?? new Set<string>();
    ids.add(job.id.replace(/::\d+$/, ""));
    sourceIdsBySplit.set(split, ids);
  }
  const presentSplits = (["tuning", "holdout", "other"] as const).filter((split) => bySplit[split].total > 0);
  const splitDescription = (split: SplitName) => {
    const ids = [...(sourceIdsBySplit.get(split) ?? [])];
    const projectIds = ids.filter((id) => id.startsWith("project:"));
    if (!projectIds.length) return "";
    const publicationCount = ids.length - projectIds.length;
    const parts: string[] = [];
    if (publicationCount) parts.push(`${publicationCount} ${plural(publicationCount, "публикация", "публикации", "публикаций")}`);
    if (projectIds.length) parts.push(`${projectIds.length} ${plural(projectIds.length, "проектный источник", "проектных источника", "проектных источников")} (${projectIds.map((id) => "`" + esc(id) + "`").join(", ")})`);
    return ` (${parts.join(", ")})`;
  };

  const lines: string[] = [
    "# Результаты таксономического пилота OpenRouter",
    "",
    `Дата: ${new Date().toISOString().slice(0, 10)}. Набор: \`${esc(jobsPath)}\`; бандл: \`${esc(bundlePath)}\`.`,
    "",
    "## Итоги",
    "",
    `Набор источников: ${total.total} — ${presentSplits.map((split) => `${split}: ${bySplit[split].total}${splitDescription(split)}`).join("; ")}.`,
    "",
    "| Сплит | Источников | Размечено успешно | Несовместимый hash | Ошибок обработки | Не обработано |",
    "|---|---:|---:|---:|---:|---:|",
    ...presentSplits.map((split) => `| ${split} | ${bySplit[split].total} | ${bySplit[split].valid} | ${bySplit[split].stale} | ${bySplit[split].errors} | ${bySplit[split].unattempted} |`),
    `| **Итого** | **${total.total}** | **${total.valid}** | **${total.stale}** | **${total.errors}** | **${total.unattempted}** |`,
    "",
    `Hash gate: **${total.stale === 0 ? "PASS" : "FAIL"}**${total.stale ? " — stale results cannot be accepted." : ""}`,
    "",
  ];

  const orphans = [...orphanResults, ...orphanErrors];
  if (orphans.length) {
    lines.push(`> Бандл содержит ${orphans.length} ${plural(orphans.length, "запись", "записи", "записей")} по источникам вне набора (${orphans.map((id) => "`" + esc(id) + "`").join(", ")}) — в итоги не включены.`, "");
  }

  const listedErrors = bundle.errors ?? [];
  if (listedErrors.length) {
    lines.push("## Ошибки обработки", "", "| Источник | Сплит | Этап | Ошибка |", "|---|---|---|---|");
    for (const error of listedErrors) lines.push(`| ${esc(error.id)} | ${splitOfJob(error.id)} | ${esc(error.stage)} | ${esc(error.error)} |`);
    lines.push("");
  }

  const currentResult = (result: EnrichmentBundle["results"][number]) => {
    const job = jobs.find((candidate) => candidate.id === result.id);
    return job?.textHash === result.textHash;
  };
  const needsReviewIds = bundle.results.filter((result) => result.needsReview && sourceIds.has(result.id) && currentResult(result)).map((result) => result.id);
  if (needsReviewIds.length) {
    lines.push("## Неоднозначные кейсы (needsReview)", "", needsReviewIds.map((id) => `- \`${esc(id)}\``).join("\n"), "");
  }

  const zeroTopic = bundle.results.filter((result) => result.topics.length === 0 && sourceIds.has(result.id) && currentResult(result)).map((result) => result.id);
  if (zeroTopic.length) {
    lines.push("## Нулевая разметка тем (кандидаты в негативные контроли)", "", zeroTopic.map((id) => `- \`${esc(id)}\``).join("\n"), "");
  }

  for (const job of jobs) {
    const id = job.id;
    const split = splitOfJob(id);
    const splitLabel = id.startsWith("project:") ? "tuning (project source)" : split;
    const result = results.get(id);
    const error = errorsById.get(id);
    lines.push(`## ${esc(job.sourceTitle ?? id)}`, "");
    lines.push(`- ID: \`${esc(id)}\` · ${splitLabel} · jobPromptVersion: \`${esc(job.promptVersion)}\``);
    if (job.sourceUrl) lines.push(`- Оригинал: ${esc(job.sourceUrl)}`);
    lines.push(`- Исходные hashtags: ${job.existingTags.length ? job.existingTags.map((tag) => "`" + esc(tag) + "`").join(", ") : "—"} `);
    lines.push(`<details><summary>Полный исходный текст</summary>`, "", "```", job.sourceText, "```", "", "</details>", "");
    if (!result && !error) {
      lines.push(`- Статус: не обработан в этом прогоне.`, "");
      continue;
    }
    if (error && !result) {
      lines.push(`- Статус: ошибка обработки (этап \`${esc(error.stage)}\`): ${esc(error.error)}`, "");
      continue;
    }
    if (!result) continue;
    if (result.textHash !== job.textHash) {
      lines.push(`- Статус: результат не применим — textHash не совпадает с текущим job (\`${esc(result.textHash)}\` ≠ \`${esc(job.textHash)}\`).`);
    } else {
      lines.push(`- Статус: размечено успешно.`);
    }
    lines.push(`- Модель: \`${esc(result.model)}\` · promptVersion: \`${esc(result.promptVersion)}\` · needsReview: ${result.needsReview}`);
    lines.push(`- Summary: ${esc(result.summary)}`);
    if (result.topics.length) {
      lines.push("", "### Темы", "", "| Тема | Цитата |", "|---|---|");
      const evidence = new Map((result.topicEvidence ?? []).map((e) => [e.topicId, e.quote]));
      for (const topic of result.topics) lines.push(`| \`${esc(topic)}\` | ${esc(excerpt(evidence.get(topic) ?? "—"))} |`);
    } else lines.push("", "### Темы: не размечены");
    if (result.entities.length) lines.push("", "### Сущности", "", result.entities.map((entity) => "- " + esc(entity)).join("\n"));
    else lines.push("", "### Сущности: нет");
    if (result.relations.length) {
      lines.push("", "### Предложенные связи", "", "| Цель | Тип | Уверенность | Объяснение | Цитата |", "|---|---|---|---|---|");
      const titles = new Map(job.candidateTargets.map((target) => [target.id, target.title]));
      for (const relation of result.relations) {
        lines.push(`| ${esc(titles.get(relation.targetId) ?? relation.targetId)} | \`${esc(relation.type)}\` | ${Math.round(relation.confidence * 100)}% | ${esc(excerpt(relation.explanation, 160))} | ${esc(excerpt(relation.evidenceQuote ?? "—", 120))} |`);
      }
    } else lines.push("", "### Предложенные связи: нет");
    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  const jobs = (await readFile(resolve(jobsPath), "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as EnrichmentJob);
  const bundle = JSON.parse(await readFile(resolve(bundlePath), "utf8")) as EnrichmentBundle;
  const text = renderPilotReport(jobs, bundle);
  await writeFile(resolve(outputPath), text + "\n", "utf8");
  const { total, bySplit } = accountPilot(jobs, bundle);
  console.log(JSON.stringify({ sources: total.total, bySplit, results: total.valid, stale: total.stale, errors: total.errors, unattempted: total.unattempted, output: resolve(outputPath) }));
  if (total.stale > 0) process.exitCode = 1;
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/pipeline/enrichment/pilot-report.ts")) main();
