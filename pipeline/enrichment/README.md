# Enrichment layer

Telegram text is immutable source data. Enrichment is a separate, replaceable layer keyed by `id + textHash + promptVersion`.

`prepare.ts` creates JSONL jobs from the materialized publications. Topic/entity classification and relation classification are deliberately separate:

- the topic pass sees the controlled taxonomy but cannot propose graph edges;
- `relations.ts` sees only candidates explicitly named or linked by the source, requires an exact source evidence fragment, and writes proposals to a review bundle;
- no provider output becomes canonical content until a human accepts it.

The deterministic layer remains available without network access:

```powershell
npm run content:refresh
```

It recognizes the controlled public taxonomy and exact mentions of known projects. Its generated sidecar is committed, while Telegram wording remains untouched. Stale results are rejected by the source SHA-256.

## Bounded OpenRouter pilot

Always prepare and inspect the 30-source tuning/holdout pilot before any paid corpus run:

```powershell
npm run enrichment:prepare -- --pilot --split all --limit 30
npm run enrichment:openrouter -- pipeline/enrichment/jobs/pilot.jsonl pipeline/enrichment/review/pilot-openrouter.json deepseek/deepseek-v4-flash --pilot --split all --limit 30
npm run enrichment:relations
npm run enrichment:pilot-report
```

The pilot contains short and long publications, old and new material, tagged/untagged sources, negative controls, ambiguous sources, and one project source. Long sources are segmented without dropping text and are recombined by source ID.

Candidate retrieval scores the entire archive plus works, projects, and articles; it is never limited to recent posts. Lexical overlap may rank a candidate, but only an exact canonical name, curated name variant, canonical site path, or direct Telegram link authorizes it for relation classification. This keeps topic similarity out of the evidence graph.

Pilot outputs:

- `pipeline/enrichment/review/pilot-openrouter.json` — topics/entities;
- `pipeline/enrichment/review/pilot-openrouter-with-relations.json` — the same results plus proposed relations;
- `docs/taxonomy-pilot-results.md` — inspectable source text, labels, evidence, confidence, and explanations.

## Full corpus

`enrichment:prepare-full` and `enrichment:openrouter-full` are explicit opt-in commands. Do not run them before pilot acceptance and a budget check. `content:retag` applies only topic/entity arrays from a completed bundle; source body, media, source hashtags, and editorial relations remain unchanged.

## Pipeline order

The source of truth for publications is the materialized Markdown in `src/content/publications/telegram`; `canonical.json` is a regenerated sync cache. The materializer reads two sidecars in order:

1. `generated/full.json` supplies the reviewed enrichment cache only while its SHA-256 matches the source body. Its accepted topics, entities and relations survive Telegram re-syncs.
2. `generated/telegram.json` is the deterministic fallback. It classifies an edited or newly fetched post immediately; an out-of-date reviewed result is never reapplied.

`content:refresh` rebuilds the local sidecar and materializes both layers. No paid model call is required for new Telegram messages; they receive deterministic categories and exact-name relations until the next explicit full enrichment run. `content:retag` remains useful for applying a newly completed full bundle without materializing again, but it must not be used to override a stale bundle.

The audit pair (`npm run audit:content`, `npm run audit:media`) reads the same loader and fails on stale sidecar hashes, broken relation targets, or missing/orphaned media. Body text and media files are never mutated by enrichment: a triple materialize run was verified byte-stable (EOL-normalized) over all 744 publications and 780 media files.

No API key, response cache, unreviewed provider response, or embedding is committed. Re-running the Telegram import never depends on an LLM.
