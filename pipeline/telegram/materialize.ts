import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { EnrichmentBundle, ReviewBundle, ReviewDecision } from "../enrichment/types";
import { publicationDisplay } from "./display";
import { mergeEnrichment } from "../enrichment/merge";
import { readPublications } from "../enrichment/prepare";
import { inlineTelegramMedia } from "./inline-media";

const [input = "pipeline/telegram/archive/canonical.json", output = "src/content/publications/telegram", enrichmentInput = "pipeline/enrichment/generated/telegram.json",reviewInput="pipeline/enrichment/review/decisions.json"] = process.argv.slice(2);
const publications = await readPublications(input);
let enrichment = new Map<string, EnrichmentBundle["results"][number]>();
try {
  const bundle = JSON.parse(await readFile(resolve(enrichmentInput), "utf8")) as EnrichmentBundle;
  enrichment = new Map(bundle.results.map((result) => [result.id, result]));
} catch {}
let reviews:ReviewDecision[]=[];try{const bundle=JSON.parse(await readFile(resolve(reviewInput),"utf8")) as ReviewBundle;reviews=bundle.decisions}catch{}
const destination = resolve(output);

const yaml = (value: unknown) => JSON.stringify(value);


await rm(destination, {recursive:true,force:true});
await mkdir(destination, {recursive:true});

for (const publication of publications) {
  const enriched = mergeEnrichment(publication, enrichment.get(publication.id),reviews);
  const { title, summary, body: displayBody } = publicationDisplay(publication);
  const relations = enriched.relations;
  const media = publication.media.map(({sourcePath,publicPath,type,messageId}) => ({sourcePath,...publicPath?{publicPath}:{},type,messageId}));
  const frontmatter = [
    "---",
    `id: ${yaml(publication.id)}`,
    `kind: ${publication.kind}`,
    `title: ${yaml(title)}`,
    `summary: ${yaml(summary)}`,
    publication.date ? `date: ${yaml(publication.date)}` : undefined,
    publication.editedDate ? `updated: ${yaml(publication.editedDate)}` : undefined,
    `tags: ${yaml(enriched.tags)}`,
    `sourceTags: ${yaml(enriched.sourceTags)}`,
    `topics: ${yaml(enriched.topics)}`,
    `entities: ${yaml(enriched.entities)}`,
    `sourceUrl: ${yaml(publication.sourceUrl)}`,
    `sourceId: ${yaml(publication.sourceId)}`,
    publication.forwardFrom ? `forwardFrom: ${yaml(publication.forwardFrom)}` : undefined,
    `threadIds: ${yaml(publication.threadIds)}`,
    `media: ${yaml(media)}`,
    "featured: false",
    `relations: ${yaml(relations)}`,
    "---",
    "",
  ].filter((line): line is string => line !== undefined).join("\n");
  const sourceLink = `[Оригинал в Telegram](${publication.sourceUrl})`;
  const body=inlineTelegramMedia(displayBody,publication).replace(/[ \t]+$/gm,"");
  await writeFile(resolve(destination,`tg-${publication.sourceId}.md`),`${frontmatter}${body ? `${body}\n\n` : ""}${sourceLink}\n`,"utf8");
}

console.log(JSON.stringify({written:publications.length,output:destination}));
