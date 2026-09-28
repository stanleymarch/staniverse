/** Production Jev tagging: only the leftovers, never the whole corpus.
 *
 * Tags the publications that generated/full.json does not freshly cover
 * (new posts, edited posts, whatever a stopped run left behind) using
 * typesafe/jev-1.13 on the OpenRouter Decisions API — one request per post,
 * one `noul` question per taxonomy topic from jev-criteria.ts, thresholded
 * into topics. Results merge into generated/full.json, which is both the
 * output and the increment cache: a post with a fresh entry is never
 * re-asked. Per-answer files under review/jev-cache/ make a stopped run
 * resume for free.
 *
 * Entities come from the deterministic exact-mention rules (enrichLocally):
 * Jev classifies topics, regexes own entities — merge.ts takes the primary
 * result's entities, so they must be populated here.
 *
 * Budget: each post costs a fraction of a cent ($0.042/M input, ~$0.0004 for
 * a typical post). The key's remaining spend limit is checked before each
 * call; below the floor the run defers quietly (exit 0) — the sync treats
 * that as "retried next run", not a failure.
 *
 * Usage: npm run enrichment:jev   (env: JEV_MODEL, JEV_THRESHOLD)
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { enrichLocally, isFresh } from "./catalog";
import { readPublications } from "./prepare";
import { jevTopicQuestions } from "./jev-criteria";
import type { EnrichmentBundle, EnrichmentResult } from "./types";

const MODEL = process.env.JEV_MODEL ?? "typesafe/jev-1.13";
const THRESHOLD = Number(process.env.JEV_THRESHOLD ?? 0.7);
// Long Telegram articles ran past the old 6000-char state and were judged on
// their opening (a splat-focused article lost its splat topic): the cap now
// covers the whole corpus at token prices that keep it irrelevant.
const STATE_CAP = 30_000;
const CACHE_DIR = "pipeline/enrichment/review/jev-cache";
const FULL = "pipeline/enrichment/generated/full.json";
const FLOOR = 0.001;
/** An answer is usable only if its state covered the body as fully as the
 * current cap allows; answers without the marker predate STATE_CAP and are
 * assumed to have seen the old 6000-char window. */
const coversBody = (result: EnrichmentResult, bodyLength: number) =>
  (result.stateChars ?? 6000) >= Math.min(bodyLength, STATE_CAP);

const key = (await readFile(".env", "utf8"))
  .split(/\r?\n/).map((l) => l.match(/^OPENROUTER_API_KEY=(.*)$/)?.[1]?.trim().replace(/^["']|["']$/g, "")).find(Boolean) ?? process.env.OPENROUTER_API_KEY ?? "";
if (!key) throw new Error("OPENROUTER_API_KEY is missing (add it to .env)");

const questions = Object.fromEntries(Object.entries(jevTopicQuestions).map(([id, q]) => [id, { type: "noul", instructions: q.instructions, criteria: q.criteria }]));

const bundle: EnrichmentBundle = JSON.parse(await readFile(FULL, "utf8"));
const byId = new Map(bundle.results.map((r) => [r.id, r]));

const publications = (await readPublications("pipeline/telegram/archive/canonical.json"))
  .filter((p) => {
    if (p.body.trim().length === 0) return false;
    const covered = byId.get(p.id);
    return !covered || !isFresh(covered, p.body) || (covered.provider === "jev" && !coversBody(covered, p.body.length));
  });

if (publications.length === 0) {
  console.log(JSON.stringify({ tagged: 0, deferred: 0, spent: 0, note: "nothing uncovered" }));
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

/** One Decisions call for one post. A spend-limit 403 is reported as
 * `budget: true` so the caller stops the run instead of hammering the API. */
async function askJev(post: (typeof publications)[number]): Promise<{ topics: string[]; cost: number } | { error: string; budget?: boolean }> {
  const response = await fetch("https://openrouter.ai/api/alpha/decisions", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, state: { post: { kind: post.kind, text: post.body.slice(0, STATE_CAP) } }, questions }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 160);
    return { error: `HTTP ${response.status}: ${body}`, budget: response.status === 403 && body.includes("limit exceeded") };
  }
  const payload = await response.json() as { answers?: Record<string, { noul?: number }>; usage?: { cost?: number } };
  const topics = Object.entries(payload.answers ?? {})
    .filter(([, a]) => typeof a.noul === "number" && a.noul >= THRESHOLD)
    .map(([id]) => id);
  return { topics, cost: payload.usage?.cost ?? 0 };
}

let tagged = 0, deferred = 0, errors = 0, spent = 0;
for (const post of publications) {
  const local = enrichLocally(post);
  const cachePath = resolve(CACHE_DIR, local.textHash + ".json");
  let result: EnrichmentResult | null = null;
  if (existsSync(cachePath) && coversBody(JSON.parse(await readFile(cachePath, "utf8")) as EnrichmentResult, post.body.length)) {
    result = JSON.parse(await readFile(cachePath, "utf8")) as EnrichmentResult;
  } else {
    const remaining = await limitRemaining();
    if (remaining !== null && remaining < FLOOR) {
      // Spend only falls within a run: defer everything left in one decision
      // instead of re-asking the key endpoint per post.
      deferred = publications.length - tagged - errors;
      break;
    }
    const answer = await askJev(post);
    if ("error" in answer) {
      if (answer.budget) {
        // The key hit its monthly spend cap mid-run: keep what is done, defer
        // the rest (cache makes the resume free) instead of erroring per post.
        deferred = publications.length - tagged - errors;
        console.error(`${post.id}: ${answer.error}`);
        break;
      }
      errors += 1; console.error(`${post.id}: ${answer.error}`); continue;
    }
    spent += answer.cost;
    result = {
      id: post.id, textHash: local.textHash, promptVersion: "staniverse-jev-v1", provider: "jev", model: MODEL,
      createdAt: new Date().toISOString(), summary: "", topics: answer.topics, topicEvidence: [],
      stateChars: Math.min(post.body.length, STATE_CAP),
      entities: local.entities, relations: local.relations, needsReview: false,
    };
    await writeFile(cachePath, JSON.stringify(result), "utf8");
  }
  byId.set(post.id, result);
  bundle.results = [...byId.values()];
  await writeFile(FULL, JSON.stringify(bundle, null, 2) + "\n", "utf8");
  tagged += 1;
  process.stdout.write(`\r${tagged}/${publications.length} ${post.id.split(":").pop()} $${spent.toFixed(4)}   `);
}
console.log("");
console.log(JSON.stringify({ tagged, deferred, errors, spent: Number(spent.toFixed(4)), total: publications.length, model: MODEL, threshold: THRESHOLD }));
if (errors > 0 && tagged === 0 && deferred === 0) process.exit(1);
