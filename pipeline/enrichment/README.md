# Enrichment layer

Telegram text is immutable source data. Enrichment is a separate, replaceable layer keyed by `id + textHash + promptVersion`.

`prepare.ts` creates JSONL jobs. A provider must return `EnrichmentResult`; rejected or uncertain relations stay out of canonical content and go to review. The recommended bulk profile is the Responses API with Structured Outputs and a small current model; reserve a stronger model for long threads and ambiguous cross-project relations.

The deterministic layer is the default and runs without network access:

```powershell
npm run content:refresh
```

It recognizes a controlled public taxonomy and exact mentions of known projects. Its generated sidecar is committed, while Telegram wording remains untouched. Stale results are rejected by the source SHA-256.

The optional OpenAI pass uses the Responses API with strict Structured Outputs. It defaults to `gpt-5.4-mini`, but `OPENAI_ENRICHMENT_MODEL` can pin another compatible model. Results go to the ignored review folder and are never silently published:

```powershell
npm run enrichment:prepare
$env:OPENAI_API_KEY="..."
npm run enrichment:openai -- pipeline/enrichment/jobs/telegram.jsonl pipeline/enrichment/review/openai.json gpt-5.4-mini 10
```

The final number limits a paid trial run; `0` processes every job. Candidate relation targets include all works, projects and articles plus recent Telegram context. The runner discards target IDs that were not offered to the model. Causal `inspired` and `develops` proposals require review.

No API key, unreviewed provider response, or embedding is committed. Re-running the Telegram import never depends on an LLM.
