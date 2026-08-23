import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CanonicalPublication } from "./types";

interface Archive { version: number; channel: string; publications: CanonicalPublication[] }

const [input = "pipeline/telegram/archive/canonical.json", output = "src/content/publications/telegram"] = process.argv.slice(2);
const archive = JSON.parse(await readFile(resolve(input), "utf8")) as Archive;
const destination = resolve(output);

const plain = (value: string) => value
  .replace(/```[\s\S]*?```/g, " ")
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/[*_`>#]/g, "")
  .replace(/\s+/g, " ")
  .trim();
const shortened = (value: string, length: number) => value.length <= length ? value : `${value.slice(0,length-1).trimEnd()}…`;
const yaml = (value: unknown) => JSON.stringify(value);

await rm(destination, {recursive:true,force:true});
await mkdir(destination, {recursive:true});

for (const publication of archive.publications) {
  const clean = plain(publication.body);
  const dateLabel = publication.date ? new Intl.DateTimeFormat("ru-RU",{dateStyle:"medium"}).format(new Date(publication.date)) : publication.sourceId;
  const title = clean ? shortened(clean.split(/[.!?\n]/,1)[0],90) : `Медиапубликация · ${dateLabel}`;
  const summary = clean ? shortened(clean,220) : `Публикация без текстовой подписи; в архиве сохранено медиафайлов: ${publication.media.length}.`;
  const relations = publication.relations.map((relation) => ({target:relation.targetId,type:"mentions",evidence:"hyperlink",confidence:relation.confidence}));
  const media = publication.media.map(({sourcePath,type,messageId}) => ({sourcePath,type,messageId}));
  const frontmatter = [
    "---",
    `id: ${yaml(publication.id)}`,
    "kind: telegram-post",
    `title: ${yaml(title)}`,
    `summary: ${yaml(summary)}`,
    publication.date ? `date: ${yaml(publication.date)}` : undefined,
    publication.editedDate ? `updated: ${yaml(publication.editedDate)}` : undefined,
    `tags: ${yaml(publication.tags)}`,
    "entities: []",
    `sourceUrl: ${yaml(publication.sourceUrl)}`,
    `sourceId: ${yaml(publication.sourceId)}`,
    `threadIds: ${yaml(publication.threadIds)}`,
    `media: ${yaml(media)}`,
    "featured: false",
    `relations: ${yaml(relations)}`,
    "---",
    "",
  ].filter((line): line is string => line !== undefined).join("\n");
  const sourceLink = `[Оригинал в Telegram](${publication.sourceUrl})`;
  await writeFile(resolve(destination,`tg-${publication.sourceId}.md`),`${frontmatter}${publication.body ? `${publication.body}\n\n` : ""}${sourceLink}\n`,"utf8");
}

console.log(JSON.stringify({written:archive.publications.length,output:destination}));
