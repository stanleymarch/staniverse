/** Jev (typesafe/jev-1.13, OpenRouter Decisions API) topic-tagging evaluation.
 *
 * One Decisions request per post: state = the post, questions = one `noul` per
 * taxonomy topic from jev-criteria.ts (calibrated literal true/false pairs).
 * Scores against BOTH references: the hand-labeled clean truth
 * (jev-calibration-truth.json, same deterministic sample) and the reviewed
 * full.json (noisy). Threshold sweep, cost/latency from the API usage reports.
 *
 * Findings log:
 * - 2026-09-28 v1 (TOPIC_BOUNDARIES in state, generic criteria): F1 0.44 vs
 *   reviewed at t=0.5; misses concentrated in 0.1–0.5 probability band; on
 *   inspection the reviewed truth itself is wrong in a large share of
 *   disagreements (llm on a Notion post, ∅ on a substantive XR/OSS post).
 * - v2 (this version): calibrated criteria + clean hand-labeled truth.
 *
 * Usage: npx tsx pipeline/enrichment/jev-eval.mts [--limit N]   (cwd = repo root)
 */
import { readFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { readPublications } from "./prepare";
import { isFresh } from "./catalog";
import { jevTopicQuestions } from "./jev-criteria";

const API = "https://openrouter.ai/api/alpha/decisions";
const MODEL = "typesafe/jev-1.13";
const COST_CAP = 0.05;
const OUT = "/tmp/jev-eval-results.json";

const limit = (() => { const i = process.argv.indexOf("--limit"); return i >= 0 ? Number(process.argv[i + 1]) : Infinity; })();

const key = (await readFile(".env", "utf8"))
  .split(/\r?\n/).map((l) => l.match(/^OPENROUTER_API_KEY=(.*)$/)?.[1]?.trim().replace(/^["']|["']$/g, "")).find(Boolean) ?? "";
if (!key) throw new Error("OPENROUTER_API_KEY is missing from .env");

const questions = Object.fromEntries(Object.entries(jevTopicQuestions).map(([id, q]) => [id, { type: "noul", instructions: q.instructions, criteria: q.criteria }]));

const reviewed = new Map(JSON.parse(await readFile("pipeline/enrichment/generated/full.json", "utf8")).results.map((r) => [r.id, r]));
const clean = new Map<string, string[]>(Object.entries(JSON.parse(await readFile("pipeline/enrichment/jev-calibration-truth.json", "utf8")) as Record<string, string[]>).filter(([k]) => k !== "_comment"));

const pubs = (await readPublications("pipeline/telegram/archive/canonical.json"))
  .filter((p) => { const t = reviewed.get(p.id); return t && isFresh(t, p.body) && p.body.trim().length > 0; })
  .sort((a, b) => a.id.localeCompare(b.id));

const buckets: Record<string, typeof pubs> = { "0": [], "1": [], "2-3": [], "4+": [] };
for (const p of pubs) {
  const n = reviewed.get(p.id)!.topics.length;
  buckets[n === 0 ? "0" : n === 1 ? "1" : n <= 3 ? "2-3" : "4+"].push(p);
}
const pick = (list: typeof pubs, n: number) => Array.from({ length: Math.min(n, list.length) }, (_, i) => list[Math.floor((i + 0.5) * list.length / Math.min(n, list.length))]);
let sample = [...pick(buckets["0"], 15), ...pick(buckets["1"], 15), ...pick(buckets["2-3"], 15), ...pick(buckets["4+"], 15)];
if (Number.isFinite(limit)) sample = sample.slice(0, limit);
console.log(`sample=${sample.length} (buckets 0:${buckets["0"].length} 1:${buckets["1"].length} 2-3:${buckets["2-3"].length} 4+:${buckets["4+"].length})`);

let spent = 0;
const results: Array<{ id: string; clean: string[]; reviewed: string[]; probs: Record<string, number>; ms: number; cost: number }> = [];
const t0 = Date.now();
for (const [i, p] of sample.entries()) {
  if (spent > COST_CAP) { console.log(`cost cap hit at ${i}/${sample.length}`); break; }
  const start = Date.now();
  const response = await fetch(API, {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, state: { post: { kind: p.kind, text: p.body.slice(0, 6000) } }, questions }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) { console.log(`HTTP ${response.status} on ${p.id}: ${(await response.text()).slice(0, 200)}`); continue; }
  const payload = await response.json() as { answers?: Record<string, { noul?: number }>; usage?: { cost?: number } };
  const probs = Object.fromEntries(Object.entries(payload.answers ?? {}).map(([id, a]) => [id, typeof a.noul === "number" ? a.noul : -1]));
  const cost = payload.usage?.cost ?? 0;
  spent += cost;
  results.push({ id: p.id, clean: clean.get(p.id) ?? [], reviewed: reviewed.get(p.id)!.topics, probs, ms: Date.now() - start, cost });
  process.stdout.write(`\r${i + 1}/${sample.length} ${p.id.split(":").pop()} ${Date.now() - start}ms $${spent.toFixed(4)}   `);
}
console.log(`\nwall=${((Date.now() - t0) / 1000).toFixed(0)}s spent=$${spent.toFixed(4)} avgMs=${Math.round(results.reduce((s, r) => s + r.ms, 0) / (results.length || 1))}`);

const evaluate = (label: string, truthOf: (r: (typeof results)[number]) => string[]) => {
  for (const threshold of [0.3, 0.4, 0.5, 0.6, 0.7]) {
    let tp = 0, fp = 0, fn = 0, exact = 0, predTotal = 0, truthTotal = 0;
    const perTopic = new Map<string, { tp: number; fp: number; fn: number }>();
    for (const r of results) {
      const truth = truthOf(r);
      const pred = Object.entries(r.probs).filter(([, p]) => p >= threshold).map(([id]) => id);
      predTotal += pred.length; truthTotal += truth.length;
      if (pred.length === truth.length && pred.every((x) => truth.includes(x))) exact += 1;
      for (const id of pred) {
        const slot = perTopic.get(id) ?? { tp: 0, fp: 0, fn: 0 };
        if (truth.includes(id)) { tp += 1; slot.tp += 1; } else { fp += 1; slot.fp += 1; }
        perTopic.set(id, slot);
      }
      for (const id of truth) if (!pred.includes(id)) { fn += 1; const slot = perTopic.get(id) ?? { tp: 0, fp: 0, fn: 0 }; slot.fn += 1; perTopic.set(id, slot); }
    }
    const precision = tp + fp ? tp / (tp + fp) : 0, recall = tp + fn ? tp / (tp + fn) : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    console.log(`[${label}] t=${threshold}: micro P=${precision.toFixed(3)} R=${recall.toFixed(3)} F1=${f1.toFixed(3)} exact=${exact}/${results.length} avgPred=${(predTotal / (results.length || 1)).toFixed(2)} avgTruth=${(truthTotal / (results.length || 1)).toFixed(2)}`);
    if (threshold === 0.5) {
      const worst = [...perTopic.entries()].filter(([, s]) => s.fn + s.fp > 0)
        .map(([id, s]) => [id, s, (2 * s.tp) / (2 * s.tp + s.fp + s.fn)] as const)
        .sort((a, b) => a[2] - b[2]).slice(0, 6);
      console.log(`  [${label}] weakest:`, worst.map(([id, s, f]) => `${id}(P${s.tp}/${s.tp + s.fp} R${s.tp}/${s.tp + s.fn} f=${f.toFixed(2)})`).join(" "));
    }
  }
};
evaluate("clean", (r) => r.clean);
evaluate("reviewed", (r) => r.reviewed);

writeFileSync(OUT, JSON.stringify(results, null, 1));
console.log("saved " + OUT);
