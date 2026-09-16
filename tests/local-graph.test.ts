import test from "node:test";
import assert from "node:assert/strict";
import { buildDirectedRelations, buildLocalGraph, isDottedLocalEdge } from "../src/components/localGraph";
import type { GraphEdge, GraphNode } from "../src/lib/graph";

const node = (id: string, kind = "article"): GraphNode => ({ id, title: id, summary: `${id} summary`, kind, href: `/${id}`, topics: [], sourceTags: [], featured: false });
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

test("does not expand a topic hub into the whole archive and respects the node budget", () => {
  const archive = Array.from({ length: 80 }, (_, index) => node(`post-${index}`));
  const topic = node("topic:ai", "topic");
  const graph = buildLocalGraph("current", [node("current"), topic, ...archive], [
    edge("current", "topic:ai", "topic", "topic"),
    ...archive.map((item) => edge("topic:ai", item.id, "topic", "topic")),
  ]);
  assert.deepEqual(graph.nodes.map((item) => item.id), ["current", "topic:ai"]);
  assert.ok(graph.nodes.length <= 32);
});

test("shows a direct edge as outgoing on its source and incoming on its target", () => {
  const nodes = [node("a"), node("b"), node("c")];
  const edges = [edge("a", "b", "editorial", "develops"), edge("c", "a")];

  const fromA = buildDirectedRelations("a", nodes, edges);
  assert.deepEqual(
    fromA.map(({ id, heading, relations }) => [id, heading, relations.map((relation) => relation.node.id)]),
    [["outgoing", "Исходящие", ["b"]], ["incoming", "Входящие", ["c"]]],
  );

  const fromB = buildDirectedRelations("b", nodes, edges);
  assert.deepEqual(fromB.map(({ relations }) => relations.map((relation) => relation.node.id)), [[], ["a"]]);
  assert.equal(fromB[1]?.relations[0]?.label, "развивает");
  assert.ok(fromB[0]!.emptyText.length > 0);
});

test("links each neighbour through the href the graph resolved for it", () => {
  const topic: GraphNode = { ...node("topic:ai", "topic"), title: "Искусственный интеллект", href: "/topics/ai/" };
  const directions = buildDirectedRelations("a", [node("a"), topic, node("b")], [edge("a", "topic:ai", "topic", "part-of"), edge("b", "a", "editorial", "mentions")]);
  assert.deepEqual(directions[0]?.relations.map((relation) => [relation.href, relation.title]), [["/topics/ai/", "Искусственный интеллект"]]);
  assert.deepEqual(directions[1]?.relations.map((relation) => [relation.href, relation.title]), [["/b", "b"]]);
});

test("carries label, evidence, and review state without flattening inferred context", () => {
  const edges: GraphEdge[] = [
    { ...edge("a", "b", "topic", "part-of"), reviewStatus: "inferred" },
    edge("a", "c", "editorial", "develops"),
    { ...edge("a", "d", "editorial", "mentions"), reviewStatus: "proposed" },
  ];
  const [outgoing] = buildDirectedRelations("a", [node("a"), node("b"), node("c"), node("d")], edges);
  assert.deepEqual(
    outgoing?.relations.map((relation) => [relation.title, relation.label, relation.causal, relation.inferred, relation.status]),
    [["c", "развивает", true, false, undefined], ["d", "упоминает", false, false, "proposed"], ["b", "часть", false, true, "inferred"]],
  );
  assert.deepEqual(outgoing?.relations.map((relation) => relation.evidence), ["editorial", "editorial", "topic"]);
});

test("lists a repeated relation once and keeps self-edges out of both directions", () => {
  const [outgoing, incoming] = buildDirectedRelations("a", [node("a"), node("b")], [edge("a", "b"), edge("a", "b"), edge("a", "a")]);
  assert.equal(outgoing?.relations.length, 1);
  assert.equal(incoming?.relations.length, 0);
});
