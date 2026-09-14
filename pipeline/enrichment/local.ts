import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { enrichLocally } from "./catalog";
import { readPublications } from "./prepare";
import type { EnrichmentBundle } from "./types";

const [input = "pipeline/telegram/archive/canonical.json", output = "pipeline/enrichment/generated/telegram.json"] = process.argv.slice(2);
const publications = await readPublications(input);
const knownTargets = new Set([
  "project:staniverse", "project:nearventure", "project:ya-ty-gorod", "project:metavyatka",
  "project:zapovednaya-vyatka-360", "project:albina", "project:omnipub",
]);
const generatedAt = publications.map((publication) => publication.editedDate ?? publication.date).filter((value): value is string => Boolean(value)).sort().at(-1) ?? new Date(0).toISOString();
const bundle: EnrichmentBundle = {
  version: 1,
  generatedAt,
  results: publications.map((publication) => enrichLocally(publication, knownTargets)),
};
await mkdir(dirname(resolve(output)), { recursive: true });
await writeFile(resolve(output), JSON.stringify(bundle, null, 2), "utf8");
const tagged = bundle.results.filter((result) => result.topics.length > 0).length;
const related = bundle.results.filter((result) => result.relations.length > 0).length;
console.log(JSON.stringify({ publications: bundle.results.length, tagged, related, output: resolve(output) }));
