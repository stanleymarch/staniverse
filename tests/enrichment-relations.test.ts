import test from "node:test";
import assert from "node:assert/strict";
import { groundedRelationCandidates, validateAndHydrateRelations } from "../pipeline/enrichment/relations";
import type { EnrichmentJob } from "../pipeline/enrichment/types";

const job: EnrichmentJob = {
  id: "publication:telegram:staniverse:526",
  textHash: "hash",
  promptVersion: "pilot",
  language: "ru",
  sourceKind: "telegram-post",
  sourceText: "Продолжаю собирать MetaVyatka и публикую новый цифровой объект.",
  existingTags: [],
  candidateTargets: [{ id: "project:metavyatka", title: "MetaVyatka", kind: "project", summaryExcerpt: "Цифровой архив Вятки" }],
  allowedTopicIds: [],
  topicDefinitions: [],
};
const fragments = [{ id: "e1", text: job.sourceText }];

test("hydrates a relation only from an exact supplied evidence fragment", () => {
  const result = validateAndHydrateRelations({
    relations: [{ targetId: "project:metavyatka", type: "develops", explanation: "Автор сообщает о продолжении собственной работы над проектом.", confidence: 0.97, evidenceId: "e1" }],
    needsReview: false,
  }, job, fragments);
  assert.equal(result.relations[0].evidenceQuote, job.sourceText);
  assert.equal(result.relations[0].targetId, "project:metavyatka");
});

test("keeps only candidates explicitly named or linked by the source", () => {
  const explicitJob: EnrichmentJob = {
    ...job,
    sourceText: "Рассказываю про проект «МетаВятка»; контекст в https://t.me/staniverse/965 и кейс /works/arka-vyatskogo-kremlya/.",
    candidateTargets: [
      job.candidateTargets[0],
      { id: "publication:telegram:staniverse:965", title: "Другой заголовок", kind: "telegram-post", summaryExcerpt: "OpenClaw" },
      { id: "work:arka-vyatskogo-kremlya", title: "Арка Вятского Кремля", kind: "work", summaryExcerpt: "Кейс" },
      { id: "project:unrelated", title: "Совершенно другой проект", kind: "project", summaryExcerpt: "Общие слова" },
    ],
  };
  assert.deepEqual(groundedRelationCandidates(explicitJob).map((candidate) => candidate.id), [
    "project:metavyatka",
    "publication:telegram:staniverse:965",
    "work:arka-vyatskogo-kremlya",
  ]);
});

test("accepts an empty relation set as an honest negative", () => {
  assert.deepEqual(validateAndHydrateRelations({ relations: [], needsReview: false }, job, fragments), { relations: [], needsReview: false });
});

test("rejects targets outside retrieved candidates", () => {
  assert.throws(() => validateAndHydrateRelations({ relations: [{ targetId: "project:other", type: "mentions", explanation: "Нет", confidence: 0.9, evidenceId: "e1" }], needsReview: true }, job, fragments), /outside candidateTargets/);
});

test("rejects unknown evidence ids instead of inventing a citation", () => {
  assert.throws(() => validateAndHydrateRelations({ relations: [{ targetId: "project:metavyatka", type: "mentions", explanation: "Упомянут проект", confidence: 0.9, evidenceId: "e404" }], needsReview: true }, job, fragments), /evidenceId is unknown/);
});

test("rejects weak confidence and duplicate proposals", () => {
  assert.throws(() => validateAndHydrateRelations({ relations: [{ targetId: "project:metavyatka", type: "related", explanation: "Слабое сходство", confidence: 0.4, evidenceId: "e1" }], needsReview: true }, job, fragments), /outside 0.75-1/);
  const duplicate = { targetId: "project:metavyatka", type: "mentions", explanation: "Упоминание", confidence: 0.95, evidenceId: "e1" };
  assert.throws(() => validateAndHydrateRelations({ relations: [duplicate, duplicate], needsReview: true }, job, fragments), /duplicate relation/);
});
