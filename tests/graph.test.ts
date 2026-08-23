import test from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "../src/lib/graph";

const entry = (id:string, kind:string, tags:string[], relations:any[]=[]) => ({ collection: kind === "project" ? "projects" : "works", id:id.split(":").at(-1), data:{id,kind,title:id,summary:id,tags,featured:false,relations,status:kind==="project"?"active":"completed",domains:[],genres:[],role:"",year:2026}, body:"" }) as any;

test("keeps typed explicit edge provenance and confidence", () => {
  const graph = buildGraph([entry("project:a","project",["xr"],[{target:"work:b",type:"documents",evidence:"editorial",confidence:1}]),entry("work:b","work",["web"])]);
  assert.deepEqual(graph.edges[0],{source:"project:a",target:"work:b",type:"documents",evidence:"editorial",confidence:1});
});

test("infers topic edge without overwriting explicit edges", () => {
  const graph = buildGraph([entry("project:a","project",["xr"]),entry("work:b","work",["xr"])]);
  assert.equal(graph.edges.length,1); assert.equal(graph.edges[0].evidence,"topic"); assert.ok(graph.edges[0].confidence<1);
});

test("rejects relations to absent targets", () => {
  assert.throws(() => buildGraph([entry("project:a","project",[],[{target:"work:missing",type:"related",evidence:"editorial",confidence:1}])]), /missing targets/);
});
