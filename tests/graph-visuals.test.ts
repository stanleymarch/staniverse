import assert from "node:assert/strict";
import test from "node:test";
import type { GraphEdge } from "../src/lib/graph";
import { isCausalRelation, isInferredGraphEdge, provenanceField, relationLabel, selectVisualEdges } from "../src/lib/graph-visuals";

const edge = (type: string, evidence = "editorial", confidence = .8): GraphEdge => ({
  source: `${type}:source`,
  target: `${type}:target`,
  type,
  evidence,
  confidence,
});

test("selectVisualEdges keeps causal and explicit edges ahead of topic context", () => {
  const selected = selectVisualEdges([
    ...Array.from({ length: 20 }, () => edge("part-of", "topic", .99)),
    edge("related", "editorial", .7),
    edge("develops", "editorial", .8),
  ], 2);

  assert.deepEqual(selected.map((item) => item.type), ["develops", "related"]);
  assert.equal(selected.some(isInferredGraphEdge), false);
});

test("selector respects confidence and puts topic edges last", () => {
  const selected = selectVisualEdges([
    edge("related", "editorial", .4),
    edge("mentions", "entity", .92),
    edge("part-of", "topic", .99),
  ], 3);

  assert.deepEqual(selected.map((item) => item.type), ["mentions", "part-of"]);
});

test("causal relation labels and direction are explicit", () => {
  assert.equal(isCausalRelation(edge("documents")), true);
  assert.equal(isCausalRelation(edge("related")), false);
  assert.equal(relationLabel("develops"), "развивает");
  assert.equal(isInferredGraphEdge(edge("part-of", "editorial")), false);
  assert.equal(isInferredGraphEdge(edge("part-of", "topic")), true);
});

test("relation metadata remains readable in graph evidence views", () => {
  const relation = edge("mentions");
  relation.explanation = "Точное упоминание в исходном тексте.";
  relation.reviewStatus = "accepted";
  relation.provenance = { source: "local-rules", method: "entity-match", extractor: "topology-v1" };
  assert.equal(relation.explanation, "Точное упоминание в исходном тексте.");
  assert.equal(relation.reviewStatus, "accepted");
  assert.equal(provenanceField(relation.provenance, "source"), "local-rules");
  assert.equal(provenanceField(relation.provenance, "method"), "entity-match");
  assert.equal(provenanceField(relation.provenance, "extractor"), "topology-v1");
});
