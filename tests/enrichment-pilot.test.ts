import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { expandSegments, parseMaterializedPublication, partitionSource, retrieve, segmentBaseId, sourceHash } from "../pipeline/enrichment/prepare";
import { buildEvidenceFragments, cacheKey, hydrateEvidence, loadDotEnv, DEFAULT_MODEL, responseSchema, retainGroundedTopics, valid } from "../pipeline/enrichment/openrouter";
import type { EnrichmentJob } from "../pipeline/enrichment/types";

function testJob(overrides: Partial<EnrichmentJob> = {}): EnrichmentJob {
  return {
    id: "publication:telegram:staniverse:test",
    textHash: "abc",
    promptVersion: "test",
    language: "ru",
    sourceKind: "telegram-post",
    sourceText: "Test source",
    existingTags: [],
    candidateTargets: [],
    allowedTopicIds: [],
    topicDefinitions: [],
    ...overrides,
  };
}

test("retrieval ranks exact canonical links above lexical overlap", () => {
  const targets = [
    { id: "project:noisy", title: "Цифровой архив", kind: "project", summaryExcerpt: "цифровой архив Вятки XR проект", text: "цифровой архив Вятки XR проект культура мир" },
    { id: "work:arka-vyatskogo-kremlya", title: "Арка Вятского Кремля", kind: "work", summaryExcerpt: "Кейс цифровой консервации", text: "Фотограмметрия" },
  ];
  const found = retrieve("Кейс описан здесь: /works/arka-vyatskogo-kremlya/. Это цифровой архив Вятки.", targets);
  assert.equal(found[0].id, "work:arka-vyatskogo-kremlya");
});

test("materialized publication parser preserves source identity, title and body", () => {
  const value = parseMaterializedPublication('---\nid: "publication:telegram:staniverse:416"\nkind: telegram-post\ntitle: "Pilot"\nsourceId: "416"\ntags: ["ai"]\n---\n\nOriginal body', "tg-416.md");
  assert.equal(value?.id, "publication:telegram:staniverse:416");
  assert.equal(value?.title, "Pilot");
  assert.equal(value?.body, "Original body");
  assert.deepEqual(value?.tags, ["ai"]);
});

test("materialized parser rejects deterministic entity edges formerly relabelled as imported", () => {
  const relation = JSON.stringify([{
    target: "project:staniverse",
    type: "references",
    evidence: "entity",
    confidence: 0.98,
    reviewStatus: "accepted",
    provenance: { kind: "imported", source: "telegram-export", method: "entity" },
  }]);
  const value = parseMaterializedPublication(`---\nkind: telegram-post\nsourceId: "10"\nrelations: ${relation}\n---\nBody`, "tg-10.md");
  assert.deepEqual(value?.relations, []);
});

test("source hashes are stable across LF and CRLF materialization", () => {
  assert.equal(sourceHash("Первый\n\nВторой"), sourceHash("Первый\r\n\r\nВторой"));
});

test("dotenv loader extracts only the OpenRouter key", () => {
  assert.equal(loadDotEnv("OTHER=ignored\nOPENROUTER_API_KEY='secret-value'\n"), "secret-value");
});

test("cache key changes with model and is deterministic", () => {
  const job = testJob();
  assert.equal(cacheKey(job,DEFAULT_MODEL),cacheKey(job,DEFAULT_MODEL));
  assert.notEqual(cacheKey(job,DEFAULT_MODEL),cacheKey(job,"other/model"));
});

test("valid accepts a source quote whose only difference is Unicode whitespace", () => {
  const job = testJob({ allowedTopicIds: ["ai"], sourceText: "Текст с\u00a0неразрывным пробелом" });
  const result = {
    summary: "Кратко",
    topics: ["ai"],
    topicEvidence: [{ topicId: "ai", quote: "Текст с неразрывным пробелом" }],
    entities: [],
    relations: [],
    needsReview: false,
  };
  assert.equal(valid(result, job), true);
});

test("model evidence IDs hydrate to exact source fragments", () => {
  const sourceText = "Первый абзац про искусственный интеллект.\n\nВторой абзац про генерацию изображения.";
  const job = testJob({ sourceText, allowedTopicIds: ["ai", "generative-art"] });
  const fragments = buildEvidenceFragments(sourceText, 50);
  const hydrated = hydrateEvidence({
    summary: "Две темы",
    topics: ["ai", "generative-art"],
    topicEvidence: [
      { topicId: "ai", evidenceId: fragments[0].id },
      { topicId: "generative-art", evidenceId: fragments[1].id },
    ],
    entities: [],
    relations: [],
    needsReview: false,
  }, fragments);

  assert.equal(valid(hydrated, job), true);
  assert.ok(hydrated && typeof hydrated === "object" && "topicEvidence" in hydrated);
  assert.deepEqual(hydrated.topicEvidence, [
    { topicId: "ai", quote: fragments[0].text },
    { topicId: "generative-art", quote: fragments[1].text },
  ]);
});

test("unknown evidence IDs cannot become accepted citations", () => {
  const job = testJob({ sourceText: "Пост про нейросети.", allowedTopicIds: ["ai"] });
  const hydrated = hydrateEvidence({
    summary: "Кратко",
    topics: ["ai"],
    topicEvidence: [{ topicId: "ai", evidenceId: "missing" }],
    entities: [],
    relations: [],
    needsReview: true,
  }, buildEvidenceFragments(job.sourceText));
  assert.equal(valid(hydrated, job), false);
});

test("topic-only response schema prohibits proposed relations", () => {
  assert.equal(responseSchema.properties.relations.maxItems, 0);
});

test("validator accepts up to the schema limit of eight grounded topics", () => {
  const topics = ["ai", "llm", "xr", "web", "sound", "culture", "education", "lifestyle"];
  const sourceText = "Один смешанный источник предметно раскрывает все восемь проверяемых тем.";
  const job = testJob({ allowedTopicIds: topics, sourceText });
  assert.equal(valid({
    summary: "Смешанный источник",
    topics,
    topicEvidence: topics.map((topicId) => ({ topicId, quote: sourceText })),
    entities: [],
    relations: [],
    needsReview: true,
  }, job), true);
});

test("grounded-topic repair drops only ungrounded proposals and requires review", () => {
  const job = testJob({
    sourceText: "Первый фрагмент про XR.\n\nВторой фрагмент про метавселенную.",
    allowedTopicIds: ["xr", "metaverse"],
  });
  const repaired = retainGroundedTopics({
    summary: "Смешанная разметка",
    topics: ["xr", "unknown", "metaverse"],
    topicEvidence: [
      { topicId: "xr", quote: "Первый фрагмент про XR." },
      { topicId: "unknown", quote: "Второй фрагмент про метавселенную." },
      { topicId: "metaverse", quote: "Первый фрагмент про XR." },
    ],
    entities: [],
    relations: [{ targetId: "forbidden" }],
    needsReview: false,
  }, job);

  assert.equal(valid(repaired, job), true);
  assert.ok(repaired && typeof repaired === "object" && "topics" in repaired && "topicEvidence" in repaired && "relations" in repaired && "needsReview" in repaired);
  assert.deepEqual(repaired.topics, ["xr", "metaverse"]);
  assert.deepEqual(repaired.topicEvidence, [
    { topicId: "xr", quote: "Первый фрагмент про XR." },
    { topicId: "metaverse", quote: "Первый фрагмент про XR." },
  ]);
  assert.deepEqual(repaired.relations, []);
  assert.equal(repaired.needsReview, true);
});

function longParagraphText(paragraphCount: number, repeats: number): string {
  const unit = "Раздел текста с темой для проверки сегментации длинных исходников. ";
  return Array.from({ length: paragraphCount }, (_, i) => unit.repeat(repeats) + "Маркер абзаца " + i + ".").join("\n\n");
}

test("partitionSource splits on paragraph boundaries, never exceeds the cap and reassembles the original exactly", () => {
  const text = longParagraphText(20, 10);
  assert.ok(text.length > 5000, "test fixture must exceed the cap");
  const parts = partitionSource(text, 2000);
  assert.ok(parts.length > 1, "expected multiple segments");
  assert.ok(parts.every((part) => part.text.length <= 2000), "every segment must respect the cap");
  assert.equal(parts.map((part) => part.text).join(""), text, "segments must partition the original without losing text");
  let offset = 0;
  for (const part of parts) {
    assert.equal(part.offset, offset);
    offset += part.text.length;
  }
  assert.deepEqual(partitionSource(text, 2000), parts, "segmentation must be deterministic");
});

test("partitionSource hard-splits a single oversized paragraph deterministically", () => {
  const text = "Без пустых строк ".repeat(1200);
  const parts = partitionSource(text, 2000);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((part) => part.text.length <= 2000));
  assert.equal(parts.map((part) => part.text).join(""), text);
  assert.deepEqual(partitionSource(text, 2000), parts);
});

test("expandSegments turns a long job into ordered segment jobs that keep the original source identity", () => {
  const sourceText = longParagraphText(8, 24);
  const job: EnrichmentJob = testJob({ id: "publication:telegram:staniverse:999", sourceText });
  const segments = expandSegments(job);
  assert.ok(segments.length > 1, "expected a long source to be segmented");
  let offset = 0;
  segments.forEach((segment, index) => {
    assert.equal(segment.id, "publication:telegram:staniverse:999::" + (index + 1));
    assert.equal(segment.segment?.index, index + 1);
    assert.equal(segment.segment?.total, segments.length);
    assert.equal(segment.segment?.offset, offset);
    assert.equal(segment.textHash, createHash("sha256").update(segment.sourceText).digest("hex"));
    assert.equal(segment.sourceUrl, job.sourceUrl);
    assert.equal(segment.promptVersion, job.promptVersion);
    assert.deepEqual(segment.candidateTargets, job.candidateTargets);
    offset += segment.sourceText.length;
  });
  assert.equal(segments.map((segment) => segment.sourceText).join(""), sourceText, "segment jobs must reproduce the original source text");
  assert.equal(segmentBaseId(segments[1].id), "publication:telegram:staniverse:999");
  assert.deepEqual(expandSegments(job).map((segment) => segment.id), segments.map((segment) => segment.id), "segment ids must be deterministic");
});

test("expandSegments leaves short sources as a single unchanged job", () => {
  const job = testJob();
  const out = expandSegments(job);
  assert.equal(out.length, 1);
  assert.equal(out[0], job, "short sources must not be cloned or rewritten");
});

test("segmentBaseId strips only the segment suffix", () => {
  assert.equal(segmentBaseId("publication:telegram:staniverse:423::2"), "publication:telegram:staniverse:423");
  assert.equal(segmentBaseId("publication:telegram:staniverse:3"), "publication:telegram:staniverse:3");
  assert.equal(segmentBaseId("project:metavyatka"), "project:metavyatka");
});
test("valid accepts sibling topics citing the same grounded fragment", () => {
  const job = testJob({ allowedTopicIds: ["xr", "metaverse", "social-vr"], sourceText: "Где смотреть кейноут Meta Connect, если не в Horizon Worlds?" });
  const result = {
    summary: "Вопрос",
    topics: ["xr", "metaverse", "social-vr"],
    topicEvidence: ["xr", "metaverse", "social-vr"].map((topicId) => ({ topicId, quote: "Где смотреть кейноут Meta Connect, если не в Horizon Worlds?" })),
    entities: [],
    relations: [],
    needsReview: false,
  };
  assert.equal(valid(result, job), true);
});

test("retainGroundedTopics keeps several topics backed by one shared fragment", () => {
  const sourceText = "Я создаю ИИ-компаньона на основе языковой модели.";
  const job = testJob({ sourceText, allowedTopicIds: ["ai", "llm", "companions"] });
  const repaired = retainGroundedTopics({
    summary: "ИИ-компаньон на языковой модели",
    topics: ["ai", "llm", "companions"],
    topicEvidence: ["ai", "llm", "companions"].map((topicId) => ({ topicId, quote: sourceText })),
    entities: [],
    relations: [],
    needsReview: false,
  }, job);
  assert.ok(repaired && typeof repaired === "object" && "topics" in repaired && "needsReview" in repaired);
  assert.deepEqual(repaired.topics, ["ai", "llm", "companions"]);
  assert.equal(repaired.needsReview, false);
});

test("valid rejects evidence that omits one topic and duplicates another", () => {
  const job = testJob({ allowedTopicIds: ["xr", "metaverse"], sourceText: "XR раскрывается отдельно.\n\nМетавселенная раскрывается отдельно." });
  const result = {
    summary: "Две темы",
    topics: ["xr", "metaverse"],
    topicEvidence: [
      { topicId: "xr", quote: "XR раскрывается отдельно" },
      { topicId: "xr", quote: "Метавселенная раскрывается отдельно" },
    ],
    entities: [],
    relations: [],
    needsReview: false,
  };
  assert.equal(valid(result, job), false);
});

test("valid accepts distinct evidence quotes for sibling topics", () => {
  const job = testJob({ allowedTopicIds: ["xr", "metaverse"], sourceText: "Кейноут покажут в Horizon Worlds.\n\nЭто платформа метавселенной от Meta." });
  const result = {
    summary: "Разбор",
    topics: ["xr", "metaverse"],
    topicEvidence: [{ topicId: "xr", quote: "Кейноут покажут в Horizon Worlds" }, { topicId: "metaverse", quote: "Это платформа метавселенной от Meta" }],
    entities: [],
    needsReview: false,
  };
  assert.equal(valid(result, job), true);
});

test("valid tolerates a missing relations array (relations are optional in this pilot)", () => {
  const job = testJob({ allowedTopicIds: ["ai"], sourceText: "Пост про нейросети." });
  const result = {
    summary: "Кратко",
    topics: ["ai"],
    topicEvidence: [{ topicId: "ai", quote: "Пост про нейросети" }],
    entities: [],
    needsReview: false,
  };
  assert.equal(valid(result, job), true);
});

test("valid rejects a fabricated quote that is not in the source", () => {
  const job = testJob({ allowedTopicIds: ["ai"], sourceText: "Пост про нейросети." });
  const result = {
    summary: "Кратко",
    topics: ["ai"],
    topicEvidence: [{ topicId: "ai", quote: "Автор утверждает, что нейросети опасны" }],
    entities: [],
    relations: [],
    needsReview: false,
  };
  assert.equal(valid(result, job), false);
});

test("valid accepts near-exact quotes: typographic folds and ellipsis elision, still verbatim fragments", () => {
  const job = testJob({ allowedTopicIds: ["ai", "sound"], sourceText: "Пост про «нейросети» — не про отношения.\n\nА ещё там длинная вторая часть про звук и видео, которую цитата сокращает многоточием." });
  const result = {
    summary: "Кратко",
    topics: ["ai"],
    topicEvidence: [{ topicId: "ai", quote: "Пост про \"нейросети\" - не про ... которую цитата сокращает многоточием" }],
    entities: [],
    needsReview: false,
  };
  assert.equal(valid(result, job), true);
});
