import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { CanonicalPublication } from "../telegram/types";
import { topicRegistry } from "../../src/lib/taxonomy";
import type { EnrichmentJob } from "./types";
import { PILOT_HOLDOUT_IDS, PILOT_LIMIT, PILOT_PROJECT_SOURCES, PILOT_TUNING_IDS, type PilotSplit } from "./pilot-manifest";


/**
 * Sources whose text exceeds this size are emitted as deterministic, paragraph-aligned
 * segment jobs before model execution (each segment stays well inside the model context).
 * The limit is applied at the source level, so a 30-source run may emit more than 30 jobs
 * while every original source is still accounted for exactly once across its segments.
 */
export const SEGMENT_MAX_CHARS = 12000;

/** Removes the trailing `::<segment index>` suffix, returning the original source id. */
export function segmentBaseId(id: string): string {
  return id.replace(/::\d+$/, "");
}

/** Partitions `text` into an ordered list of slices no longer than `maxChars`.
 * Cuts fall on blank-line boundaries (kept deterministic by content alone); when a single
 * run of text exceeds the cap it is hard-split at the last whitespace within the window.
 * The slices form a partition: concatenating them in order reproduces `text` exactly. */
export function partitionSource(text: string, maxChars: number = SEGMENT_MAX_CHARS): Array<{ text: string; offset: number }> {
  if (text.length <= maxChars) return [{ text, offset: 0 }];
  const ends: number[] = [];
  for (const match of text.matchAll(/\r?\n[ \t]*\r?\n/g)) ends.push((match.index ?? 0) + match[0].length);
  const out: Array<{ text: string; offset: number }> = [];
  let start = 0;
  while (start < text.length) {
    if (text.length - start <= maxChars) {
      out.push({ text: text.slice(start), offset: start });
      break;
    }
    let cut = start;
    for (const end of ends) {
      if (end > start && end <= start + maxChars) cut = end;
      else if (end > start + maxChars) break;
    }
    if (cut === start) {
      cut = text.lastIndexOf(" ", start + maxChars);
      if (cut <= start) cut = Math.min(start + maxChars, text.length);
    }
    out.push({ text: text.slice(start, cut), offset: start });
    start = cut;
  }
  return out;
}

/** Emits `job` unchanged when its source fits one segment; otherwise returns ordered
 * segment jobs whose ids keep the original source id and add a `::<index>` suffix. */
export function expandSegments(job: EnrichmentJob, maxChars: number = SEGMENT_MAX_CHARS): EnrichmentJob[] {
  const parts = partitionSource(job.sourceText, maxChars);
  if (parts.length === 1) return [job];
  return parts.map((part, index) => ({
    ...job,
    id: job.id + "::" + (index + 1),
    textHash: sourceHash(part.text),
    sourceText: part.text,
    segment: { index: index + 1, total: parts.length, offset: part.offset },
  }));
}

/** Inclusion boundaries transcribed from the reviewed vocabulary table. */
const TOPIC_BOUNDARIES: Record<string, string> = {
  ai: "Общие методы/применения искусственного интеллекта; конкретная языковая модель получает также llm.",
  llm: "Языковые модели, обучение, prompting, inference и их продукты; не любой автоматический скрипт.",
  "agents-automation": "Агент, workflow или автоматизация, выполняющая цепочку действий; чат без действия не достаточен.",
  "embodied-ai": "Воплощённый ИИ: situated perception/action в виртуальной или физической среде; пересекается с XR/IoT; память или голос сами по себе недостаточны.",
  xr: "XR/WebXR/VR/AR/MR и пространственные интерфейсы; social VR — отдельная уточняющая тема.",
  metaverse: "Метавселенные как платформы/миры/инфраструктура; не синоним любого 3D или XR.",
  "social-vr": "Социальное взаимодействие и события внутри VR; не каждый VR-игровой или технический пост.",
  iot: "Сенсоры, устройства и физические интерфейсы, связанные с данными/сетью.",
  "intimate-tech": "Интим и близость в цифровых средах и технологиях: ERP и отношения людей в VR, теледильдоника, интимные устройства и их API, сексуальность онлайн. Уточняй сопутствующими темами: ai/companions для ИИ-участника, social-vr для человеческого ERP, iot для разбора устройств; сама тема — одна на любой носитель.",
  "companions": "AI-компаньоны и отношения человек-машина: виртуальные собеседники, вайфу, NPC с личностью; человеческая близость без ИИ — не эта тема (используй intimate-tech); вместе с интимной практикой добавляй intimate-tech.",
  "vtubing": "Втюберы и виртуальные персонажи как исполнители: аватары и трекинг, стримы через виртуальную личность, AI-VTubers вроде Neuro-sama; экономика и фэндом. Наличие 3D-модели или аватара без формата исполнения — недостаточно.",
  "lifestyle": "Повседневность и личный опыт: быт, самочувствие, воспоминания, отношения между людьми, переезды и личные истории; технологии, город или путешествия могут быть фоном. Не заменяет конкретные темы, когда предмет раскрыт именно в них.",
};

type Target = { id: string; title: string; kind: string; summaryExcerpt: string; text: string };
type Archive = { publications: CanonicalPublication[] };

export const sourceHash = (value: string) => createHash("sha256").update(value.replace(/\r\n?/g, "\n")).digest("hex");
const scalar = (fm: string, key: string) => fm.match(new RegExp("^" + key + ":\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\n]+))$", "m"))?.slice(1).find(Boolean)?.trim() ?? "";
const unquote = (value: string) => value.replace(/^['"]|['"]$/g, "");
const parseList = (fm: string, key: string) => {
  const value = fm.match(new RegExp("^" + key + ":\\s*\\[(.*?)\\]$", "m"))?.[1] ?? "";
  return [...value.matchAll(/"((?:\\.|[^"\\])*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2]);
};

function parseJsonArray<T>(fm: string, key: string): T[] {
  const line = fm.match(new RegExp("^" + key + ":\\s*(\\[.*\\])$", "m"))?.[1];
  if (!line) return [];
  try {
    const value = JSON.parse(line.replace(/,(?=\s*\])/, ""));
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

type MaterializedRelation = {
  target?: unknown;
  targetId?: unknown;
  type?: unknown;
  evidence?: unknown;
  confidence?: unknown;
  explanation?: unknown;
  reviewStatus?: unknown;
  status?: unknown;
  provenance?: unknown;
};
type MaterializedMedia = { sourcePath?: unknown; publicPath?: unknown; type?: unknown; messageId?: unknown };

function canonicalRelations(fm: string): CanonicalPublication["relations"] {
  return parseJsonArray<MaterializedRelation>(fm, "relations").flatMap((entry) => {
    const targetId = typeof entry.target === "string" ? entry.target : typeof entry.targetId === "string" ? entry.targetId : undefined;
    if (!targetId) return [];
    const provenance = typeof entry.provenance === "string" || (typeof entry.provenance === "object" && entry.provenance !== null)
      ? entry.provenance as CanonicalPublication["relations"][number]["provenance"]
      : undefined;
    const evidence = typeof entry.evidence === "string" ? entry.evidence : "telegram-link";
    // Telegram import creates only link-backed relations. This impossible
    // combination identifies deterministic edges relabelled by the former
    // Markdown fallback and prevents them from becoming accepted evidence.
    if (evidence === "entity" && typeof provenance === "object"
      && provenance.kind === "imported" && provenance.source === "telegram-export"
      && provenance.method === "entity") return [];
    return [{
      targetId,
      type: typeof entry.type === "string" ? entry.type : "references",
      evidence,
      confidence: typeof entry.confidence === "number" ? entry.confidence : 1,
      ...(typeof entry.explanation === "string" ? { explanation: entry.explanation } : {}),
      ...(typeof entry.reviewStatus === "string" ? { reviewStatus: entry.reviewStatus } : {}),
      ...(typeof entry.status === "string" ? { status: entry.status } : {}),
      ...(provenance !== undefined ? { provenance } : {}),
    }];
  });
}

function canonicalMedia(fm: string): CanonicalPublication["media"] {
  return parseJsonArray<MaterializedMedia>(fm, "media").flatMap((entry) => {
    if (typeof entry.sourcePath !== "string") return [];
    return [{
      sourcePath: entry.sourcePath,
      ...(typeof entry.publicPath === "string" ? { publicPath: entry.publicPath } : {}),
      type: (typeof entry.type === "string" ? entry.type : "document") as CanonicalPublication["media"][number]["type"],
      order: 0,
      messageId: typeof entry.messageId === "number" ? entry.messageId : 0,
    }];
  });
}

export function parseMaterializedPublication(raw: string, fileName: string): CanonicalPublication | undefined {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return undefined;
  const fm = match[1];
  const body = match[2].trim();
  const sourceId = unquote(scalar(fm, "sourceId") || fileName.match(/(\d+)/)?.[1] || "");
  if (!sourceId || !body) return undefined;
  return {
    id: "publication:telegram:staniverse:" + sourceId,
    sourceId,
    sourceUrl: unquote(scalar(fm, "sourceUrl")) || `https://t.me/staniverse/${sourceId}`,
    kind: (unquote(scalar(fm, "kind")) || "telegram-post") as CanonicalPublication["kind"],
    title: unquote(scalar(fm, "title")) || undefined,
    body,
    date: unquote(scalar(fm, "date")) || undefined,
    editedDate: unquote(scalar(fm, "updated")) || undefined,
    threadIds: parseList(fm, "threadIds"),
    tags: parseList(fm, "tags"),
    links: [],
    relations: canonicalRelations(fm),
    media: canonicalMedia(fm),
    rawMessageIds: [],
  };
}

function splitFrontmatter(raw: string) {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  return match ? { fm: match[1], body: match[2].trim() } : undefined;
}

export async function readPublications(input: string): Promise<CanonicalPublication[]> {
  try {
    return (JSON.parse(await readFile(resolve(input), "utf8")) as Archive).publications;
  } catch {
    const root = resolve("src/content/publications/telegram");
    const rows: CanonicalPublication[] = [];
    for (const file of (await readdir(root)).filter((f) => f.endsWith(".md"))) {
      const parsed = parseMaterializedPublication(await readFile(resolve(root, file), "utf8"), file);
      if (parsed) rows.push(parsed);
    }
    return rows;
  }
}

async function editorialTargets(): Promise<Target[]> {
  const out: Target[] = [];
  for (const folder of ["works", "projects", "articles"]) {
    const root = resolve("src/content", folder);
    for (const file of (await readdir(root)).filter((f) => f.endsWith(".md"))) {
      const parsed = splitFrontmatter(await readFile(resolve(root, file), "utf8"));
      if (!parsed) continue;
      const id = unquote(scalar(parsed.fm, "id"));
      const title = unquote(scalar(parsed.fm, "title"));
      const kind = unquote(scalar(parsed.fm, "kind"));
      if (id && title && kind) out.push({ id, title, kind, summaryExcerpt: unquote(scalar(parsed.fm, "summary")).slice(0, 500), text: parsed.body.slice(0, 2000) });
    }
  }
  return out;
}

async function projectSource(id: string): Promise<Target | undefined> {
  const slug = id.replace(/^project:/, "");
  const parsed = splitFrontmatter(await readFile(resolve("src/content/projects", slug + ".md"), "utf8"));
  if (!parsed) return undefined;
  return { id, title: unquote(scalar(parsed.fm, "title")), kind: "project", summaryExcerpt: unquote(scalar(parsed.fm, "summary")).slice(0, 500), text: parsed.body };
}

const targetAliases: Readonly<Record<string, readonly string[]>> = {
  "project:metavyatka": ["MetaVyatka", "МетаВятка", "Метавятка", "Мета Вятка"],
  "project:ya-ty-gorod": ["я.ты.город", "я ты город", "yatygorod"],
  "project:zapovednaya-vyatka-360": ["Заповедная Вятка", "Заповедная Вятка 360"],
  "project:albina": ["Albina", "Альбина"],
  "project:omnipub": ["OmniPub", "Омнипаб"],
};

/** Exact naming/link evidence used to prioritize retrieval and to authorize a
 * candidate for the relation model. URLs are removed before name matching so
 * the Telegram channel handle cannot masquerade as project:staniverse. */
export function relationCandidateSignals(source: string, target: { id: string; title: string }): string[] {
  const foldedSource = source.toLocaleLowerCase("ru-RU").normalize("NFKC").replace(/ё/g, "е");
  const visibleSource = foldedSource.replace(/\]\([^)]+\)/g, "]").replace(/https?:\/\/[^\s)]+/g, " ");
  const compactSource = visibleSource.replace(/[^\p{L}\p{N}]+/gu, "");
  const slug = target.id.slice(target.id.indexOf(":") + 1).toLocaleLowerCase();
  const publicationId = target.id.match(/^publication:telegram:[^:]+:(\d+)$/)?.[1];
  const canonicalPaths = target.id.startsWith("project:")
    ? [`/projects/${slug}`, `/lab/${slug}`]
    : target.id.startsWith("work:")
      ? [`/works/${slug}`, `/works/cases/${slug}`]
      : target.id.startsWith("article:")
        ? [`/articles/${slug}`]
        : [];
  const names = [target.title, ...(targetAliases[target.id] ?? [])]
    .map((name) => name.toLocaleLowerCase("ru-RU").normalize("NFKC").replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, ""))
    .filter((name) => name.length >= 8);
  const signals: string[] = [];
  if (!publicationId && names.some((name) => compactSource.includes(name))) signals.push("exact-title");
  if (canonicalPaths.some((path) => foldedSource.includes(path))) signals.push("canonical-path");
  if (publicationId && new RegExp(`(?:t\\.me/[^/\\s)]+/|/garden/telegram/tg-)${publicationId}(?:\\D|$)`, "iu").test(source)) signals.push("direct-telegram-link");
  return signals;
}

export function retrieve(source: string, targets: Target[], limit = 12) {
  const stopWords = ["который", "только", "этого", "можно", "будет", "есть", "если", "this", "that", "with"];
  const foldedSource = source.toLocaleLowerCase("ru-RU").normalize("NFKC").replace(/ё/g, "е");
  const words = new Set((foldedSource.match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter((word) => !stopWords.includes(word)));
  return targets
    .map((target) => {
      const signals = relationCandidateSignals(source, target);
      const hay = (target.title + " " + target.summaryExcerpt + " " + target.text).toLocaleLowerCase("ru-RU");
      const lexical = [...words].reduce((score, word) => score + (hay.includes(word) ? 1 : 0), 0);
      const score = lexical
        + (signals.includes("exact-title") ? 1_000 : 0)
        + (signals.includes("canonical-path") ? 2_000 : 0)
        + (signals.includes("direct-telegram-link") ? 3_000 : 0);
      return { target, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.target.id.localeCompare(b.target.id))
    .slice(0, limit)
    .map(({ target }) => ({ id: target.id, title: target.title, kind: target.kind, summaryExcerpt: target.summaryExcerpt }));
}

const topicDefinitions = topicRegistry.map((t) => ({
  id: t.id,
  label: t.label,
  family: t.family,
  definition: TOPIC_BOUNDARIES[t.id] ?? t.label + "; aliases: " + t.aliases.slice(0, 6).join(", "),
}));

function publicationJob(publication: CanonicalPublication, allTargets: Target[]): EnrichmentJob {
  const title = publication.body.replace(/\s+/g, " ").slice(0, 100) || "Telegram " + publication.sourceId;
  return {
    id: publication.id,
    textHash: sourceHash(publication.body),
    promptVersion: "staniverse-pilot-v3",
    language: "ru",
    sourceKind: publication.kind,
    sourceTitle: title,
    sourceUrl: publication.sourceUrl,
    sourceText: publication.body,
    existingTags: publication.tags,
    candidateTargets: retrieve(publication.body, allTargets).filter((t) => t.id !== publication.id),
    allowedTopicIds: topicRegistry.map((t) => t.id),
    topicDefinitions,
  };
}

function projectJob(source: Target, allTargets: Target[]): EnrichmentJob {
  return {
    id: source.id,
    textHash: sourceHash(source.text),
    promptVersion: "staniverse-pilot-v3",
    language: "ru",
    sourceKind: "project",
    sourceTitle: source.title,
    sourceUrl: "",
    sourceText: source.text,
    existingTags: [],
    candidateTargets: retrieve(source.text, allTargets).filter((t) => t.id !== source.id),
    allowedTopicIds: topicRegistry.map((t) => t.id),
    topicDefinitions,
  };
}

export async function buildPilotJobs(input = "pipeline/telegram/archive/canonical.json", split: PilotSplit = "all", limit: number = PILOT_LIMIT): Promise<EnrichmentJob[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > PILOT_LIMIT) throw new Error(`Pilot limit must be 1-${PILOT_LIMIT}.`);
  const publications = await readPublications(input);
  const byId = new Map(publications.map((p) => [String(p.sourceId), p]));
  const editorial = await editorialTargets();
  const projectTargets = await Promise.all(PILOT_PROJECT_SOURCES.map((id) => projectSource(id)));
  const allTargets: Target[] = [
    ...editorial,
    ...publications.map((p) => ({ id: p.id, title: p.body.replace(/\s+/g, " ").slice(0, 100) || "Telegram " + p.sourceId, kind: p.kind, summaryExcerpt: p.body.replace(/\s+/g, " ").slice(0, 500), text: p.body.slice(0, 3000) })),
  ];
  const tuningIds = split === "holdout" ? [] : PILOT_TUNING_IDS;
  const holdoutIds = split === "tuning" ? [] : PILOT_HOLDOUT_IDS;
  const projectIds = split === "all" || split === "tuning" ? [...PILOT_PROJECT_SOURCES] : [];
  const sources: EnrichmentJob[] = [];
  for (const id of [...tuningIds, ...holdoutIds]) {
    const publication = byId.get(String(id));
    if (publication && publication.body.trim()) sources.push(publicationJob(publication, allTargets));
  }
  for (const id of projectIds) {
    const source = projectTargets.find((target) => target?.id === id);
    if (source) sources.push(projectJob(source, allTargets));
  }
  // `limit` counts original sources; long sources expand into ordered segment jobs afterwards,
  // so partial runs never truncate a source mid-way through its segments.
  return sources.slice(0, limit).flatMap((job) => expandSegments(job));
}

/** Full-corpus tagging jobs: every publication with a non-empty body. Project
 * sources are excluded — editorial metadata already carries their taxonomy. */
export async function buildAllJobs(input = "pipeline/telegram/archive/canonical.json"): Promise<EnrichmentJob[]> {
  const publications = (await readPublications(input)).filter((p) => p.body.trim());
  const allTargets: Target[] = [
    ...(await editorialTargets()),
    ...publications.map((p) => ({ id: p.id, title: p.body.replace(/\s+/g, " ").slice(0, 100) || "Telegram " + p.sourceId, kind: p.kind, summaryExcerpt: p.body.replace(/\s+/g, " ").slice(0, 500), text: p.body.slice(0, 3000) })),
  ];
  return publications.flatMap((p) => expandSegments(publicationJob(p, allTargets)));
}

function args() {
  const values = process.argv.slice(2);
  const flag = (name: string) => values.includes(name);
  const value = (name: string) => {
    const index = values.indexOf(name);
    return index >= 0 ? values[index + 1] : undefined;
  };
  const positional = values.filter((v, i) => !v.startsWith("--") && !["--pilot", "--full", "--split", "--limit"].includes(values[i - 1] ?? ""));
  return {
    pilot: flag("--pilot"),
    full: flag("--full"),
    split: (value("--split") ?? "all") as PilotSplit,
    limit: Number(value("--limit")),
    input: positional[0] ?? "pipeline/telegram/archive/canonical.json",
    output: positional[1] ?? (flag("--full") ? "pipeline/enrichment/jobs/full.jsonl" : "pipeline/enrichment/jobs/pilot.jsonl"),
  };
}
if (process.argv[1]?.replaceAll("\\", "/").includes("/prepare.ts")) {
  const a = args();
  if (!a.pilot && !a.full) throw new Error("Refusing corpus preparation: pass --pilot or --full explicitly.");
  if (a.full) {
    const jobs = await buildAllJobs(a.input);
    await mkdir(dirname(resolve(a.output)), { recursive: true });
    await writeFile(resolve(a.output), jobs.map((job) => JSON.stringify(job)).join("\n") + "\n", "utf8");
    console.log(JSON.stringify({ jobs: jobs.length, full: true, output: resolve(a.output) }));
  } else {
    if (!["tuning", "holdout", "all"].includes(a.split)) throw new Error("--split must be tuning, holdout or all.");
    if (!Number.isInteger(a.limit) || a.limit < 1 || a.limit > PILOT_LIMIT) throw new Error(`--limit must be a positive integer <= ${PILOT_LIMIT}.`);
    const jobs = await buildPilotJobs(a.input, a.split, a.limit);
    await mkdir(dirname(resolve(a.output)), { recursive: true });
    await writeFile(resolve(a.output), jobs.map((job) => JSON.stringify(job)).join("\n") + "\n", "utf8");
    console.log(JSON.stringify({ jobs: jobs.length, split: a.split, pilot: true, output: resolve(a.output) }));
  }
}
