import test from "node:test";
import assert from "node:assert/strict";
import { buildLocalGraph, isDottedLocalEdge } from "../src/components/localGraph";
import type { GraphEdge, GraphNode } from "../src/lib/graph";

const node = (id: string, kind = "article"): GraphNode => ({ id, title: id, kind, href: `/${id}`, tags: [], featured: false });
const edge = (source: string, target: string, evidence = "editorial", type = "related"): GraphEdge => ({ source, target, evidence, type, confidence: .8 });

test("projects a neighbourhood to three hops and keeps the current node active", () => {
  const graph = buildLocalGraph("a", [node("a"), node("b"), node("c"), node("d"), node("e")], [edge("a", "b"), edge("b", "c"), edge("c", "d"), edge("d", "e")]);
  assert.equal(graph.current?.id, "a");
  assert.deepEqual(graph.nodes.map((item) => [item.id, item.depth]), [["a", 0], ["b", 1], ["c", 2], ["d", 3]]);
  assert.equal(graph.edges.length, 3);
});

test("treats topic and semantic edges as dotted context", () => {
  assert.equal(isDottedLocalEdge(edge("a", "b", "topic")), true);
  assert.equal(isDottedLocalEdge(edge("a", "b", "semantic-match")), true);
  assert.equal(isDottedLocalEdge(edge("a", "b", "editorial")), false);
  assert.equal(isDottedLocalEdge(edge("a", "b", "editorial", "part-of")), false);
});

test("keeps causal direction and a readable relation label in the local projection", () => {
  const graph = buildLocalGraph("a", [node("a"), node("b")], [edge("a", "b", "editorial", "develops")]);
  assert.equal(graph.edges[0]?.causal, true);
  assert.equal(graph.edges[0]?.label, "развивает");
});

test("returns an empty neighbourhood for an unknown stable id", () => {
  const graph = buildLocalGraph("missing", [node("a")], []);
  assert.equal(graph.current, undefined);
  assert.deepEqual(graph.nodes, []);
  assert.deepEqual(graph.edges, []);
});
