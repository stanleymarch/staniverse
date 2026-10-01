/** Jev pass over the life channel: taxonomy topics for the garden plus the three
 * curation flags the author curates by — нытьё, депрессуха, политика. A flag at
 * or above THRESHOLD hides the publication by default; the human override lives
 * in the materialized page's `hidden` frontmatter, not here. One Decisions call
 * per text-bearing publication, resumed for free from the per-hash cache. The
 * bundle stays in the ignored review/ directory: editorial judgments about
 * specific posts are machine-local, only the accepted result — the materialized
 * `hidden` flag — is committed. */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { jevTopicQuestions, type JevCriteria } from "../enrichment/jev-criteria";
import type { CanonicalPublication } from "./types";

const MODEL = process.env.JEV_MODEL ?? "typesafe/jev-1.13";
const THRESHOLD = Number(process.env.JEV_THRESHOLD ?? 0.7);
const CACHE_DIR = "pipeline/enrichment/review/life-cache";
const CANONICAL = "pipeline/telegram/archive/life/canonical.json";
const BUNDLE = "pipeline/enrichment/review/life-labels.json";
const FLOOR = 0.001;

const curationQuestions: Record<string, JevCriteria> = {
  whining: {
    instructions: "Является ли `post.text` нытьём или жалобами?",
    criteria: {
      true: "Преобладающий тон — жалобы на обстоятельства, людей или себя: недовольство, обида, беспомощность, «всё плохо».",
      false: "Недовольство как повод для разбора или решения, ирония без жалости к себе, нейтральное или позитивное повествование.",
    },
  },
  gloom: {
    instructions: "Пронизан ли `post.text` унынием или подавленностью?",
    criteria: {
      true: "Тоска, апатия, отсутствие сил и смысла, депрессивный фон: «не могу», «не хочется», «зачем всё это».",
      false: "Грусть как мимолётная нотка на фоне действия; усталость после конкретного дела без общего упадка.",
    },
  },
  politics: {
    instructions: "Существенная ли часть `post.text` — политика или властные темы?",
    criteria: {
      true: "Власть, чиновники, законы и запреты, выборы, партии, войны занимают заметную часть поста.",
      false: "Бытовая или технологическая тема; упоминание власти одним словом без разбора.",
    },
  },
};

const questions = Object.fromEntries(Object.entries({ ...jevTopicQuestions, ...curationQuestions }).map(([id, q]) => [id, { type: "noul", instructions: q.instructions, criteria: q.criteria }]));

const key = (await readFile(".env", "utf8"))
  .split(/\r?\n/).map((l) => l.match(/^OPENROUTER_API_KEY=(.*)$/)?.[1]?.trim().replace(/^["']|["']$/g, "")).find(Boolean) ?? process.env.OPENROUTER_API_KEY ?? "";
if (!key) throw new Error("OPENROUTER_API_KEY is missing (add it to .env)");

const { publications } = JSON.parse(await readFile(resolve(CANONICAL), "utf8")) as { publications: CanonicalPublication[] };
const textHash = (body: string) => createHash("sha256").update(body).digest("hex");

type LifeLabel = { id: string; textHash: string; provider: "jev"; model: string; createdAt: string; topics: string[]; flags: string[]; probs: Record<string, number>; hiddenByDefault: boolean };
let bundle: { version: number; channel: string; results: LifeLabel[] } = { version: 1, channel: "life", results: [] };
try { bundle = JSON.parse(await readFile(resolve(BUNDLE), "utf8")); } catch { /* first run */ }
const byHash = new Map(bundle.results.map((r) => [r.textHash, r]));

const pending = publications.filter((p) => p.body.trim().length > 0 && !byHash.has(textHash(p.body)));
if (pending.length === 0) {
  console.log(JSON.stringify({ labeled: 0, total: publications.length, note: "nothing uncovered" }));
  process.exit(0);
}

await mkdir(resolve(CACHE_DIR), { recursive: true });

async function limitRemaining(): Promise<number | null> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: "Bearer " + key } });
    if (!response.ok) return null;
    const payload = await response.json() as { data?: { limit_remaining?: unknown } };
    return typeof payload.data?.limit_remaining === "number" ? payload.data.limit_remaining : null;
  } catch { return null; }
}

async function askJev(post: CanonicalPublication): Promise<{ probs: Record<string, number>; cost: number } | { error: string; budget?: boolean }> {
  const response = await fetch("https://openrouter.ai/api/alpha/decisions", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, state: { post: { kind: post.kind, text: post.body } }, questions }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 160);
    return { error: `HTTP ${response.status}: ${body}`, budget: response.status === 403 && body.includes("limit exceeded") };
  }
  const payload = await response.json() as { answers?: Record<string, { noul?: number }>; usage?: { cost?: number } };
  const probs = Object.fromEntries(Object.entries(payload.answers ?? {}).map(([id, a]) => [id, typeof a.noul === "number" ? a.noul : -1]));
  return { probs, cost: payload.usage?.cost ?? 0 };
}

let labeled = 0, deferred = 0, errors = 0, spent = 0;
for (const post of pending) {
  const hash = textHash(post.body);
  const cachePath = resolve(CACHE_DIR, hash + ".json");
  let answer: { probs: Record<string, number> } | undefined;
  if (existsSync(cachePath)) {
    answer = JSON.parse(await readFile(cachePath, "utf8")) as { probs: Record<string, number> };
  } else {
    const remaining = await limitRemaining();
    if (remaining !== null && remaining < FLOOR) {
      deferred = pending.length - labeled - errors;
      break;
    }
    const result = await askJev(post);
    if ("error" in result) {
      if (result.budget) {
        deferred = pending.length - labeled - errors;
        console.error(`${post.id}: ${result.error}`);
        break;
      }
      errors += 1; console.error(`${post.id}: ${result.error}`); continue;
    }
    spent += result.cost;
    await writeFile(cachePath, JSON.stringify({ probs: result.probs }), "utf8");
    answer = result;
  }
  const flags = Object.entries(answer.probs).filter(([id, p]) => id in curationQuestions && p >= THRESHOLD).map(([id]) => id);
  const label: LifeLabel = {
    id: post.id, textHash: hash, provider: "jev", model: MODEL, createdAt: new Date().toISOString(),
    topics: Object.entries(answer.probs).filter(([id]) => id in jevTopicQuestions).filter(([, p]) => p >= THRESHOLD).map(([id]) => id),
    flags, probs: answer.probs,
    hiddenByDefault: flags.length > 0,
  };
  byHash.set(hash, label);
  bundle.results = [...byHash.values()];
  await writeFile(BUNDLE, JSON.stringify(bundle, null, 2) + "\n", "utf8");
  labeled += 1;
  process.stdout.write(`\r${labeled}/${pending.length} ${post.sourceId} $${spent.toFixed(4)}   `);
}

console.log("");
const flags = Object.fromEntries(Object.keys(curationQuestions).map((flag) => [flag, bundle.results.filter((r) => r.flags.includes(flag)).length]));
console.log(JSON.stringify({ labeled, deferred, errors, spent: Number(spent.toFixed(4)), total: publications.length, hiddenByDefault: bundle.results.filter((r) => r.hiddenByDefault).length, flags, bundle: BUNDLE }));
if (errors > 0 && labeled === 0 && deferred === 0) process.exit(1);
