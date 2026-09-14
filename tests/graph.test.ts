import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
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

test("filters unreviewed legacy relations before validating targets", () => {
  const source = entry("project:a", "project", [], [
    {target:"work:missing", type:"related", evidence:"editorial", confidence:1, status:"pending"},
    {target:"work:missing", type:"related", evidence:"editorial", confidence:1, reviewStatus:"rejected"},
    {target:"work:missing", type:"related", evidence:"editorial", confidence:1, reviewStatus:"proposed"},
    {target:"work:missing", type:"related", evidence:"editorial", confidence:1, reviewStatus:"needs-review"},
    {target:"work:b", type:"related", evidence:"editorial", confidence:1},
  ]);
  const graph = buildGraph([source, entry("work:b", "work", [])]);
  assert.equal(graph.edges.filter((edge) => edge.type === "related").length, 1);
});

test("rejected legacy status wins over accepted review status", () => {
  const source = entry("project:a", "project", [], [{target:"work:missing", type:"related", evidence:"editorial", confidence:1, status:"rejected", reviewStatus:"accepted"}]);
  assert.doesNotThrow(() => buildGraph([source]));
});

test("uses stable topic IDs and normalizes source tag aliases", () => {
  const source = entry("project:a", "project", ["AI"]);
  source.data.sourceTags = ["AI"];
  const graph = buildGraph([source]);
  assert.deepEqual(graph.nodes.filter((node) => node.kind === "topic").map((node) => node.id), ["topic:ai"]);
  assert.equal(graph.edges[0].target, "topic:ai");
  assert.equal(graph.edges[0].reviewStatus, "confirmed");
});

test("uses curated work tags as source membership when sourceTags are absent", () => {
  const graph = buildGraph([entry("project:a", "project", ["AI"])]);
  assert.equal(graph.edges[0].reviewStatus, "confirmed");
});

test("creates stable readable slugs for Russian topic routes",()=>{
  assert.equal(topicSlug("Искусственный интеллект"),"iskusstvennyi-intellekt");
  assert.equal(topicSlug("3D и пространственные медиа"),"3d-i-prostranstvennye-media");
});

test("normalizes aliases into canonical multi-label topics", () => {
  assert.deepEqual(normalizeTopics(["AI/LLM", "WebXR", "Gaussian Splats", "IoT", "opensource"]), ["ai", "llm", "xr", "gaussian-splatting", "iot", "open-source"]);
});

test("keeps IoT, XR and open source as coexisting labels", () => {
  const topics = collectTopics([entry("project:lab", "project", ["WebXR", "IoT", "open source"])]);
  assert.deepEqual(topics.filter((topic) => topic.catalog).map((topic) => topic.id).sort(), ["iot", "open-source", "xr"]);
  assert.equal(topics.find((topic) => topic.id === "xr")?.family, "xr");
});

test("exposes curated closeness and companion routes", () => {
  assert.equal(topicCloseness("xr", "IoT"), 0.64);
  assert.equal(topicCloseness("video", "place-heritage"), 0.64);
  assert.ok(topicRelations("xr").companions.includes("iot"));
  assert.equal(topicCloseness("gaussian splatting", "place-heritage"), 0.82);
  assert.ok(topicRelations("companions").related.includes("ai"));
  assert.equal(topicCloseness("unknown-one", "unknown-two"), 0);
  assert.equal(normalizeTopics(["place"])[0], "place-heritage");
});

test("keeps compact taxonomy additions distinct and preserves unknown legacy labels", () => {
  assert.deepEqual(normalizeTopics(["embodied AI", "social VR", "intimate tech", "самохостинг", "этика"]), ["embodied-ai", "social-vr", "intimate-tech", "самохостинг", "этика"]);
});

interface ContentRelation { target: string }
interface ContentEntry { id: string; relations: ContentRelation[] }

function readContentFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((item) => {
    const path = join(root, item.name);
    return item.isDirectory() ? readContentFiles(path) : item.name.endsWith(".md") ? [path] : [];
  });
}

function readContentEntries(root = "src/content"): ContentEntry[] {
  return readContentFiles(root).flatMap((file) => {
    const frontmatter = readFileSync(file, "utf8").replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
    if (!frontmatter) return [];
    const data = parseYaml(frontmatter) as { id?: string; relations?: ContentRelation[] };
    return data.id ? [{ id: data.id, relations: data.relations ?? [] }] : [];
  });
}

test("content graph keeps every relation target resolvable", () => {
  const entries = readContentEntries();
  const ids = new Set(entries.map((entry) => entry.id));
  const missing = entries.flatMap((entry) => entry.relations.filter((relation) => !ids.has(relation.target)).map((relation) => `${entry.id} -> ${relation.target}`));
  assert.deepEqual(missing, []);
});

test("content graph keeps every relation off its own source", () => {
  const selfReferencing = readContentEntries().filter((entry) => entry.relations.some((relation) => relation.target === entry.id)).map((entry) => entry.id);
  assert.deepEqual(selfReferencing, []);
});

test("canonical owners of merged works carry no duplicate or removed relations", () => {
  const entries = readContentEntries();
  const removed = ["work:avtomaticheskiy-kanal-dlya-proekta-chertezhi", "work:prodakshn-dlya-staniverse"];
  const ids = new Set(entries.map((entry) => entry.id));
  assert.deepEqual(removed.filter((id) => ids.has(id)), []);
  const stillReferenced = entries.flatMap((entry) => entry.relations.filter((relation) => removed.includes(relation.target)).map((relation) => entry.id));
  assert.deepEqual(stillReferenced, []);
  for (const id of ["work:chertezhi-tekhdiplomy", "project:staniverse"]) {
    const targets = entries.find((entry) => entry.id === id)?.relations.map((relation) => relation.target) ?? [];
    assert.ok(targets.length > 0, id);
    assert.equal(new Set(targets).size, targets.length, id);
  }
});
