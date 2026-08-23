import test from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "../src/lib/graph";
import { collectTopics, topicSlug } from "../src/lib/topics";
import { normalizeTopics, topicCloseness, topicRelations } from "../src/lib/taxonomy";

const entry = (id:string, kind:string, tags:string[], relations:any[]=[]) => ({ collection: kind === "project" ? "projects" : "works", id:id.split(":").at(-1), data:{id,kind,title:id,summary:id,tags,featured:false,relations,status:kind==="project"?"active":"completed",domains:[],genres:[],role:"",year:2026}, body:"" }) as any;

test("keeps typed explicit edge provenance and confidence", () => {
  const graph = buildGraph([entry("project:a","project",["xr"],[{target:"work:b",type:"documents",evidence:"editorial",confidence:1}]),entry("work:b","work",["web"])]);
  assert.deepEqual(graph.edges[0],{source:"project:a",target:"work:b",type:"documents",evidence:"editorial",confidence:1});
});

test("represents a shared tag as a first-class topic node instead of a dense pairwise mesh", () => {
  const graph = buildGraph([entry("project:a","project",["xr"]),entry("work:b","work",["xr"])]);
  assert.equal(graph.nodes.filter((node) => node.kind === "topic").length, 1);
  assert.equal(graph.edges.length, 2);
  assert.ok(graph.edges.every((edge) => edge.target === "topic:xr" && edge.evidence === "topic"));
});

test("rejects relations to absent targets", () => {
  assert.throws(() => buildGraph([entry("project:a","project",[],[{target:"work:missing",type:"related",evidence:"editorial",confidence:1}])]), /missing targets/);
});

test("creates stable readable slugs for Russian topic routes",()=>{
  assert.equal(topicSlug("Искусственный интеллект"),"iskusstvennyi-intellekt");
  assert.equal(topicSlug("3D и пространственные медиа"),"3d-i-prostranstvennye-media");
});

test("normalizes aliases into canonical multi-label topics", () => {
  assert.deepEqual(normalizeTopics(["AI/LLM", "WebXR", "IoT", "opensource"]), ["ai", "llm", "xr", "iot", "open-source"]);
});

test("keeps IoT, XR and open source as coexisting labels", () => {
  const topics = collectTopics([entry("project:lab", "project", ["WebXR", "IoT", "open source"])]);
  assert.deepEqual(topics.filter((topic) => topic.catalog).map((topic) => topic.id).sort(), ["iot", "open-source", "xr"]);
  assert.equal(topics.find((topic) => topic.id === "xr")?.family, "xr");
});

test("exposes curated closeness and companion routes", () => {
  assert.equal(topicCloseness("xr", "IoT"), 0.64);
  assert.ok(topicRelations("xr").companions.includes("iot"));
  assert.ok(topicRelations("companions").related.includes("ai"));
});
