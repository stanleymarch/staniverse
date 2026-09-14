import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { EnrichmentBundle } from "./types";

/** Applies combined tagging results to already-materialized publications by
 * rewriting only the `topics:` and `entities:` frontmatter lines. Bodies,
 * media, relations and source tags stay untouched, so no re-materialization
 * (and no archive rewrite) is needed for a retag. */
const [bundlePath = "pipeline/enrichment/generated/full.json", folder = "src/content/publications/telegram"] = process.argv.slice(2);

const bundle = JSON.parse(await readFile(resolve(bundlePath), "utf8")) as EnrichmentBundle;
const byId = new Map(bundle.results.map((result) => [result.id, result]));
const yaml = (value: unknown) => JSON.stringify(value);

let updated = 0;
let untouched = 0;
const missing: string[] = [];
for (const file of (await readdir(resolve(folder))).filter((name) => name.endsWith(".md")).sort()) {
  const raw = await readFile(resolve(folder, file), "utf8");
  const idMatch = raw.match(/^id:\s*"([^"]+)"$/m);
  const id = idMatch?.[1];
  if (!id) { missing.push(file + " (no id)"); continue; }
  const result = byId.get(id);
  if (!result) { untouched += 1; continue; }
  const next = raw
    .replace(/^topics: .*/m, `topics: ${yaml(result.topics)}`)
    .replace(/^entities: .*/m, `entities: ${yaml(result.entities)}`);
  if (next === raw) { untouched += 1; continue; }
  await writeFile(resolve(folder, file), next, "utf8");
  updated += 1;
}

console.log(JSON.stringify({ updated, untouched, missing: missing.length, folder: resolve(folder) }));
