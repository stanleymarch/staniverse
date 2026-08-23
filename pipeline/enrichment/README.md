# Enrichment layer

Telegram text is immutable source data. Enrichment is a separate, replaceable layer keyed by `id + textHash + promptVersion`.

`prepare.ts` creates JSONL jobs. A provider must return `EnrichmentResult`; rejected or uncertain relations stay out of canonical content and go to review. The recommended bulk profile is the Responses API with Structured Outputs and a small current model; reserve a stronger model for long threads and ambiguous cross-project relations.

No API key, provider response, or embedding is committed. Re-running the Telegram import never depends on an LLM.
