import { getCollection, type CollectionEntry } from "astro:content";

export type AnyEntry =
  | CollectionEntry<"works">
  | CollectionEntry<"projects">
  | CollectionEntry<"articles">
  | CollectionEntry<"experiments">
  | CollectionEntry<"publications">;

export const kindLabel: Record<string, string> = {
  work: "Работа",
  project: "Собственный проект",
  article: "Статья",
  experiment: "Эксперимент",
  "telegram-post": "Telegram-пост",
  "telegram-article": "Telegram-статья",
  "youtube-video": "YouTube-видео",
  video: "Видео",
};

export const projectStatus: Record<string, string> = {
  idea: "Идея",
  planned: "В планах",
  development: "В разработке",
  active: "Активен",
  paused: "На паузе",
  completed: "Завершён",
  archived: "Архив",
};

export const workStatus: Record<string, string> = {
  ongoing: "Продолжается",
  completed: "Завершена",
};

export const experimentStatus: Record<string, string> = {
  live: "Работает",
  soon: "В разработке",
};


export function hrefFor(entry: AnyEntry) {
  /* The manifesto keeps its article data (graph, relations) but lives at its own
     address: it is the site's foundation text, not one article among articles. */
  if (entry.collection === "articles" && entry.id === "manifesto") return "/manifesto/";
  const base = entry.collection === "works" ? "works" : entry.collection === "projects" ? "projects" : entry.collection === "articles" ? "articles" : entry.collection === "experiments" ? "experiments" : "garden";
  return `/${base}/${entry.id}/`;
}

export async function allEntries(): Promise<AnyEntry[]> {
  const groups = await Promise.all([
    getCollection("works"),
    getCollection("projects"),
    getCollection("articles"),
    getCollection("experiments"),
    getCollection("publications"),
  ]);
  // Hidden entries are absent from every public surface built on this reader:
  // listings, topics, feeds, sitemap, search, graphs. Route-level guards mirror it.
  return groups.flat().filter((entry) => !entry.data.hidden) as AnyEntry[];
}

/** Ids of entries the public surfaces never see. The graph loader uses this to
 * quietly drop relations bound for a hidden entry — a hidden post keeps its
 * file, so links to it are stale by curation, not broken by data loss. */
export async function hiddenEntryIds(): Promise<Set<string>> {
  const groups = await Promise.all([
    getCollection("works"),
    getCollection("projects"),
    getCollection("articles"),
    getCollection("experiments"),
    getCollection("publications"),
  ]);
  return new Set(groups.flat().filter((entry) => entry.data.hidden).map((entry) => entry.data.id));
}

export function byStableId(entries: AnyEntry[]) {
  return new Map(entries.map((entry) => [entry.data.id, entry]));
}
