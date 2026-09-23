import test from "node:test";
import assert from "node:assert/strict";
import { getCardPortalGraph } from "../src/lib/card/graphSubset";
import type { GraphEdge, GraphNode } from "../src/lib/graph";

const node = (id: string, kind: string, featured = false): GraphNode => ({ id, kind, featured, title: id, summary: `${id} summary`, href: `/${id}/`, topics: [], sourceTags: [] });

test("card portal selection is stable, bounded, and preserves real graph edges", () => {
  const nodes = [
    node("project:loci", "project", true),
    node("work:virtualnyy-ofis-advokata", "work", true),
    node("experiment:reality-field", "experiment"),
    node("topic:xr", "topic", true),
    ...Array.from({ length: 180 }, (_, index) => node(`publication:${index}`, "telegram-post")),
  ];
  const edges: GraphEdge[] = [{ source: "project:loci", target: "topic:xr", type: "part-of", evidence: "topic", confidence: 1 }];
  const first = getCardPortalGraph({ nodes, edges });
  const second = getCardPortalGraph({ nodes, edges });

  assert.deepEqual(first, second);
  assert.ok(first.nodes.length <= 5 + 14 + 6 + 120);
  assert.ok(first.nodes.some((item) => item.id === "card:core"));
  assert.ok(first.nodes.some((item) => item.id === "project:loci" && item.title === "project:loci"));
  assert.deepEqual(first.semanticEdges, edges);
  assert.ok(first.syntheticEdges.every((edge) => edge.source.startsWith("card:hub:")));
});

test("card portal carries experiment launch URLs from the source graph", () => {
  const experiment = { ...node("experiment:reality-field", "experiment"), launch: "https://example.org/reality-field/" };
  const portal = getCardPortalGraph({ nodes: [experiment, node("work:other", "work")], edges: [] });
  assert.equal(portal.nodes.find((item) => item.id === "experiment:reality-field")?.launch, "https://example.org/reality-field/");
});
