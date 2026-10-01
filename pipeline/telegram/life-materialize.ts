/** Materializes the life channel into garden pages. The committed page is the
 * reviewed truth for curation fields: a re-run keeps a hand-set `hidden` and
 * hand-curated `topics`/`title`/`summary`, exactly like hand-curated pages of
 * the main channel survive its nightly sync. Body, media and relations always
 * follow the canonical export. No source link is written and no `sourceUrl`
 * lands in the frontmatter: the channel is private, and no public URL may
 * name it. Curation defaults come from the machine-local Jev labels bundle
 * (review/life-labels.json, git-ignored); flipping `hidden` in the page
 * overrides them permanently. */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import YAML from "yaml";
import { publicationDisplay } from "./display";
import { inlineTelegramMedia } from "./inline-media";
import { enrichLocally } from "../enrichment/catalog";
import { mergeEnrichment } from "../enrichment/merge";
import type { CanonicalPublication } from "./types";

const [input = "pipeline/telegram/archive/life/canonical.json", labelsPath = "pipeline/enrichment/review/life-labels.json", output = "src/content/publications/telegram-life"] = process.argv.slice(2);
const { publications } = JSON.parse(await readFile(resolve(input), "utf8")) as { publications: CanonicalPublication[] };

interface LifeLabel { id: string; textHash: string; topics: string[]; flags: string[]; hiddenByDefault: boolean }
const labels = new Map<string, LifeLabel>();
try {
  const bundle = JSON.parse(await readFile(resolve(labelsPath), "utf8")) as { results: LifeLabel[] };
  for (const label of bundle.results) labels.set(label.id, label);
} catch { /* labeling has not run yet: everything materializes visible */ }

const destination = resolve(output);
const bodyHash = (body: string) => createHash("sha256").update(body).digest("hex");
// Hand curation carried across re-materialization: the committed page wins over
// both the canonical render and the label defaults.
const carried = new Map<string, Record<string, unknown>>();
for (const name of await readdir(destination).catch(() => [] as string[])) {
  if (!name.endsWith(".md")) continue;
  const frontmatter = (await readFile(resolve(destination, name), "utf8")).match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter) continue;
  const data = YAML.parse(frontmatter[1]) as { id?: string };
  if (typeof data.id === "string") carried.set(data.id, data);
}

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

const yaml = (value: unknown) => JSON.stringify(value);
let hiddenCount = 0;
for (const publication of publications) {
  const local = enrichLocally(publication);
  const enriched = mergeEnrichment(publication, undefined, [], local);
  const label = labels.get(publication.id);
  const fresh = label?.textHash === bodyHash(publication.body) ? label : undefined;
  const prior = carried.get(publication.id);
  const priorHidden = typeof prior?.hidden === "boolean" ? prior.hidden : undefined;
  const { title, summary, body: displayBody } = publicationDisplay(publication);
  const hidden = priorHidden ?? fresh?.hiddenByDefault ?? false;
  const media = publication.media.map(({ sourcePath, publicPath, type, messageId }) => ({ sourcePath, ...(publicPath ? { publicPath } : {}), type, messageId }));
  const frontmatter = [
    "---",
    `id: ${yaml(publication.id)}`,
    `kind: ${publication.kind}`,
    `title: ${yaml(typeof prior?.title === "string" ? prior.title : title)}`,
    `summary: ${yaml(typeof prior?.summary === "string" ? prior.summary : summary)}`,
    publication.date ? `date: ${yaml(publication.date)}` : undefined,
    publication.editedDate ? `updated: ${yaml(publication.editedDate)}` : undefined,
    `tags: ${yaml(enriched.tags)}`,
    `sourceTags: ${yaml(enriched.sourceTags)}`,
    `topics: ${yaml((Array.isArray(prior?.topics) ? (prior.topics as string[]) : undefined) ?? fresh?.topics ?? enriched.topics)}`,
    `entities: ${yaml(enriched.entities)}`,
    `sourceId: ${yaml(publication.sourceId)}`,
    `threadIds: ${yaml(publication.threadIds)}`,
    `media: ${yaml(media)}`,
    "featured: false",
    `hidden: ${hidden}`,
    `channel: ${yaml({ key: "life", platform: "telegram" })}`,
    `relations: ${yaml(enriched.relations)}`,
    "---",
    "",
  ].filter((line): line is string => line !== undefined).join("\n");
  const body = inlineTelegramMedia(displayBody, publication).replace(/[ \t]+$/gm, "");
  await writeFile(resolve(destination, `tg-life-${publication.sourceId}.md`),`${frontmatter}${body ? `${body}\n` : ""}`,"utf8");
}

console.log(JSON.stringify({ written: publications.length, hiddenByDefault: hiddenCount, visible: publications.length - hiddenCount, carried: carried.size, output: destination }));
