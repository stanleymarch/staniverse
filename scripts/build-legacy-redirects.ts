/**
 * Generates the legacy URL map for the Quartz site that staniverse.xyz used
 * before this rebuild.
 *
 * Input is the published Quartz search index (https://staniverse.xyz/static/contentIndex.json).
 * Every note in it is keyed by its old slug, and every garden post ends with the
 * source footer `t.me/staniverse/<message id> · <date>`, so the mapping from an old
 * post URL to a materialized publication is exact: the footer id is either the
 * publication's own `sourceId` or a member of its `threadIds` (the Telegram pipeline
 * merges replies into the thread head).
 *
 * Snapshot mode trims the published index to the fields this generator needs and
 * writes pipeline/legacy/content-index.json. The trimmed snapshot is what the
 * repository keeps, so regenerating the redirect file later needs no network access.
 *
 * Usage (from the repository root):
 *   tsx scripts/build-legacy-redirects.ts --snapshot path/to/contentIndex.json --write-snapshot
 *   tsx scripts/build-legacy-redirects.ts --out src/lib/legacy-post-redirects.ts
 *   tsx scripts/build-legacy-redirects.ts --check
 *
 * `--check` recomputes the map and fails when the committed file is stale.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { getTopicDefinition, normalizeTopics } from "../src/lib/taxonomy";
import { topicSlug } from "../src/lib/topics";

interface SnapshotPost { slug: string; messageId: number | null; title: string }
interface Snapshot { source: string; capturedAt: string; entries: number; tags: string[]; posts: SnapshotPost[] }
interface Publication { sourceId: string; threads: string[] }

const args = process.argv.slice(2);
const arg = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);

const snapshotArgument = arg("snapshot");
const snapshotPath = resolve(arg("write-snapshot") ?? "pipeline/legacy/content-index.json");
const writeSnapshot = has("write-snapshot") || arg("write-snapshot") !== undefined;
const output = resolve(arg("out") ?? "src/lib/legacy-post-redirects.ts");
const capturedAt = arg("captured-at") ?? new Date().toISOString().slice(0, 10);
const contentRoot = resolve(arg("content") ?? "src/content/publications/telegram");

const asText = (value: unknown) => (typeof value === "string" ? value : undefined);
const asTags = (value: unknown) => (Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string") : []);

/** The published footer `t.me/staniverse/<id> …` is always the last such link in a note. */
function sourceMessageId(content: string) {
  const tail = [...content.matchAll(/t\.me\/staniverse\/(\d+)/g)].at(-1)?.[1];
  const id = tail === undefined ? Number.NaN : Number(tail);
  return Number.isFinite(id) ? id : null;
}

interface LegacyIndex { notes: number; tags: string[]; posts: SnapshotPost[] }

/** Quartz stores its search index as one object keyed by slug; the snapshot is a trimmed variant. */
function readLegacyIndex(path: string): LegacyIndex {
  const raw: unknown = JSON.parse(readFileSync(resolve(path), "utf8"));
  if (raw && typeof raw === "object" && "posts" in raw && Array.isArray((raw as Snapshot).posts)) {
    const snapshot = raw as Snapshot;
    return { notes: snapshot.entries, tags: [...snapshot.tags].sort(), posts: snapshot.posts };
  }
  if (!raw || typeof raw !== "object") throw new Error(`${path} is not a Quartz content index.`);
  const notes = Object.values(raw as Record<string, unknown>);
  const tags = new Set<string>();
  const posts: SnapshotPost[] = [];
  for (const note of notes) {
    if (!note || typeof note !== "object") continue;
    const record = note as Record<string, unknown>;
    for (const tag of asTags(record.tags)) tags.add(tag);
    const slug = asText(record.slug);
    if (!slug?.startsWith("garden/posts/")) continue;
    posts.push({ slug, messageId: sourceMessageId(asText(record.content) ?? ""), title: asText(record.title) ?? "" });
  }
  return { notes: notes.length, tags: [...tags].sort(), posts: posts.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)) };
}

function readPublications(): Map<string, Publication> {
  const publications = new Map<string, Publication>();
  for (const name of readdirSync(contentRoot)) {
    if (!name.endsWith(".md")) continue;
    const frontmatter = readFileSync(join(contentRoot, name), "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
    if (!frontmatter) throw new Error(`Publication ${name} has no frontmatter.`);
    const data = parseYaml(frontmatter) as { sourceId: string; threadIds?: string[] };
    publications.set(String(data.sourceId), { sourceId: String(data.sourceId), threads: (data.threadIds ?? []).map(String) });
  }
  return publications;
}

const index = readLegacyIndex(snapshotArgument ?? snapshotPath);
const publications = readPublications();
const threadOwner = new Map<string, string>();
for (const publication of publications.values()) for (const id of publication.threads) threadOwner.set(id, publication.sourceId);

const posts = new Map<string, string>();
const unresolved: string[] = [];
const targets = new Set<string>();
for (const post of index.posts) {
  const id = post.messageId === null ? undefined : String(post.messageId);
  const owner = id ? publications.get(id)?.sourceId ?? threadOwner.get(id) : undefined;
  if (!owner) { unresolved.push(`${post.slug} (message id ${post.messageId ?? "none"})`); continue; }
  posts.set(post.slug, `/garden/telegram/tg-${owner}/`);
  targets.add(owner);
}

const tags = new Map<string, string>();
for (const tag of index.tags) {
  const [topicId] = normalizeTopics([tag]);
  const definition = topicId ? getTopicDefinition(topicId) : undefined;
  // The old index links e.g. /tags/GenAI while Quartz published /tags/genai; cover both forms.
  for (const form of new Set([tag, tag.toLowerCase()])) {
    tags.set(`tags/${form}`, definition ? `/topics/${topicSlug(definition.label)}/` : `/garden/?q=${encodeURIComponent(form)}`);
  }
}

const sortedPosts = Object.fromEntries([...posts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const sortedTags = Object.fromEntries([...tags].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

const generated = `/**
 * Generated by scripts/build-legacy-redirects.ts — do not edit by hand.
 *
 * Sources: ${index.notes} notes of the published Quartz index
 * (https://staniverse.xyz/static/contentIndex.json), snapshot kept at
 * pipeline/legacy/content-index.json (captured ${capturedAt}).
 * Posts: ${Object.keys(sortedPosts).length} mapped, ${unresolved.length} unresolved.
 * Tags: ${Object.keys(sortedTags).length} (${[...tags.values()].filter((value) => value.startsWith("/topics/")).length} canonical topics, the rest fall back to the garden query).
 */
export const legacyPostRedirects: Record<string, string> = ${JSON.stringify(sortedPosts, null, 2)};

export const legacyTagRedirects: Record<string, string> = ${JSON.stringify(sortedTags, null, 2)};
`;

if (writeSnapshot) {
  const snapshot: Snapshot = { source: "https://staniverse.xyz/static/contentIndex.json", capturedAt, entries: index.notes, tags: index.tags, posts: index.posts };
  mkdirSync(dirname(snapshotPath), { recursive: true });
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 1)}\n`, "utf8");
}

if (has("check")) {
  if (!existsSync(output) || readFileSync(output, "utf8") !== generated) {
    console.error(JSON.stringify({ stale: output, posts: sortedPosts, tags: sortedTags }));
    process.exitCode = 1;
  }
} else {
  writeFileSync(output, generated, "utf8");
}

console.log(JSON.stringify({
  output,
  snapshot: writeSnapshot ? snapshotPath : undefined,
  notes: index.notes,
  posts: Object.keys(sortedPosts).length,
  unresolved: unresolved.length,
  targets: targets.size,
  tags: Object.keys(sortedTags).length,
  tagsToTopic: [...tags.values()].filter((value) => value.startsWith("/topics/")).length,
  tagsToGarden: [...tags.values()].filter((value) => !value.startsWith("/topics/")).length,
  unresolvedSample: unresolved.slice(0, 20),
}, null, 2));
