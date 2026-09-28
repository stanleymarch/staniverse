/** Jev (typesafe/jev-1.13, OpenRouter Decisions API) topic-tagging evaluation
 * against the reviewed generated/full.json ground truth.
 *
 * Method: one Decisions request per post — state carries the post text plus the
 * topic_definitions table (TOPIC_BOUNDARIES), questions are one `noul` per
 * taxonomy topic ("does the post substantively develop this topic"), answers
 * thresholded into the topic set. Stratified 60-post sample, threshold sweep,
 * cost/latency measured from the API's own usage reports.
 *
 * Findings (2026-09-28, 60 posts, $0.026 total ≈ $0.00044/post, ~600 ms/post):
 * - t=0.5: micro P=0.55 R=0.36 F1=0.44 vs the reviewed truth; t≥0.6 trades
 *   recall away steeply (the probability mass sits in 0.1–0.5 for misses).
 * - The "truth" itself is noisy in both directions, so F1 understates Jev:
 *   on inspected disagreements Jev is frequently the correct side (truth=llm on
 *   a Notion-geoaction post; truth=∅ on a post that substantively discusses XR
 *   and open-source). Genuine misses exist too (games on a FIFA-fandom post).
 * - Cost is ~2× lower than the deepseek-v4-flash chat pipeline with zero JSON
 *   parsing and native probability thresholds; a full 647-job corpus rerun
 *   would cost ≈ $0.30.
 *
 * To make Jev production-grade: rewrite the per-topic criteria as literal
 * true/false descriptions (the current TOPIC_BOUNDARIES are inclusion notes
 * written for an LLM prompt, not decision criteria), calibrate the threshold
 * on a hand-cleaned labeled sample, and re-run this script. Blocked on the
 * OpenRouter key's monthly spend limit until it is raised or resets.
 *
 * Usage: npx tsx pipeline/enrichment/jev-eval.mts   (cwd = repo root)
 */
import { readFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { readPublications, TOPIC_BOUNDARIES } from "./prepare";
import { isFresh } from "./catalog";
import { topicRegistry } from "../../src/lib/taxonomy";

const API = "https://openrouter.ai/api/alpha/decisions";
const MODEL = "typesafe/jev-1.13";
const COST_CAP = 0.05;
const OUT = "/tmp/jev-eval-results.json";

const key = (await readFile(".env", "utf8"))
  .split(/\r?\n/).map((l) => l.match(/^OPENROUTER_API_KEY=(.*)$/)?.[1]?.trim().replace(/^["']|["']$/g, "")).find(Boolean) ?? "";
if (!key) throw new Error("OPENROUTER_API_KEY is missing from .env");

const registry = topicRegistry.map((t) => ({
  id: t.id,
  label: t.label,
  definition: TOPIC_BOUNDARIES[t.id] ?? t.label + "; aliases: " + t.aliases.slice(0, 6).join(", "),
}));

const truth = new Map(JSON.parse(await readFile("pipeline/enrichment/generated/full.json", "utf8")).results.map((r) => [r.id, r]));

const pubs = (await readPublications("pipeline/telegram/archive/canonical.json"))
  .filter((p) => { const t = truth.get(p.id); return t && isFresh(t, p.body) && p.body.trim().length > 0; })
  .sort((a, b) => a.id.localeCompare(b.id));

const buckets: Record<string, typeof pubs> = { "0": [], "1": [], "2-3": [], "4+": [] };
for (const p of pubs) {
  const n = truth.get(p.id)!.topics.length;
  buckets[n === 0 ? "0" : n === 1 ? "1" : n <= 3 ? "2-3" : "4+"].push(p);
}
const pick = (list: typeof pubs, n: number) => Array.from({ length: Math.min(n, list.length) }, (_, i) => list[Math.floor((i + 0.5) * list.length / Math.min(n, list.length))]);
const sample = [...pick(buckets["0"], 15), ...pick(buckets["1"], 15), ...pick(buckets["2-3"], 15), ...pick(buckets["4+"], 15)];
console.log(`sample=${sample.length} (buckets 0:${buckets["0"].length} 1:${buckets["1"].length} 2-3:${buckets["2-3"].length} 4+:${buckets["4+"].length})`);

const buildState = (p: (typeof pubs)[number]) => ({
  post: { kind: p.kind, text: p.body.slice(0, 6000) },
  topic_definitions: Object.fromEntries(registry.map((t) => [t.id, t.definition])),
});
const questions = Object.fromEntries(registry.map((t) => [t.id, {
  type: "noul",
  instructions: `Раскрывает ли \`post.text\` предметно тему «${t.label}»? Границы темы заданы в \`topic_definitions.${t.id}\`. Предметно = обсуждает, объясняет, описывает или разбирает как основной предмет; единичное упоминание, ссылка, название или чужая новость без разбора — не раскрывает.`,
  criteria: {
    true: "Текст предметно раскрывает тему согласно определению.",
    false: "Тема лишь упомянута мимоходом (ссылка, название, список, чужая новость) либо не относится к тексту.",
  },
}]));

let spent = 0;
const results: Array<{ id: string; truth: string[]; probs: Record<string, number>; ms: number; cost: number }> = [];
const t0 = Date.now();
for (const [i, p] of sample.entries()) {
  if (spent > COST_CAP) { console.log(`cost cap hit at ${i}/${sample.length}`); break; }
  const start = Date.now();
  const response = await fetch(API, {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, state: buildState(p), questions }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) { console.log(`HTTP ${response.status} on ${p.id}: ${(await response.text()).slice(0, 200)}`); continue; }
  const payload = await response.json() as { answers?: Record<string, { noul?: number }>; usage?: { cost?: number } };
  const probs = Object.fromEntries(Object.entries(payload.answers ?? {}).map(([id, a]) => [id, typeof a.noul === "number" ? a.noul : -1]));
  const cost = payload.usage?.cost ?? 0;
  spent += cost;
  results.push({ id: p.id, truth: truth.get(p.id)!.topics, probs, ms: Date.now() - start, cost });
  process.stdout.write(`\r${i + 1}/${sample.length} ${p.id} ${Date.now() - start}ms $${spent.toFixed(4)}   `);
}
console.log(`\nwall=${((Date.now() - t0) / 1000).toFixed(0)}s spent=$${spent.toFixed(4)} avgMs=${Math.round(results.reduce((s, r) => s + r.ms, 0) / (results.length || 1))}`);

for (const threshold of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
  let tp = 0, fp = 0, fn = 0, exact = 0, predTotal = 0;
  for (const r of results) {
    const pred = Object.entries(r.probs).filter(([, p]) => p >= threshold).map(([id]) => id);
    predTotal += pred.length;
    if (pred.length === r.truth.length && pred.every((x) => r.truth.includes(x))) exact += 1;
    for (const id of pred) if (r.truth.includes(id)) tp += 1; else fp += 1;
    for (const id of r.truth) if (!pred.includes(id)) fn += 1;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0, recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  console.log(`t=${threshold}: micro P=${precision.toFixed(3)} R=${recall.toFixed(3)} F1=${f1.toFixed(3)} exact=${exact}/${results.length} avgPred=${(predTotal / (results.length || 1)).toFixed(2)}`);
}

writeFileSync(OUT, JSON.stringify(results, null, 1));
console.log("saved " + OUT);
