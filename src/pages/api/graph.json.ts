import type { APIRoute } from "astro";
import { allEntries } from "../../lib/content";
import { buildGraph } from "../../lib/graph";
export const GET: APIRoute = async () => new Response(JSON.stringify(buildGraph(await allEntries())), { headers: { "Content-Type": "application/json; charset=utf-8" } });
