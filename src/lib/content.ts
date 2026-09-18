import { getCollection, type CollectionEntry } from "astro:content";

export type AnyEntry =
  | CollectionEntry<"works">
  | CollectionEntry<"projects">
  | CollectionEntry<"articles">
  | CollectionEntry<"publications">;

export const kindLabel: Record<string, string> = {
  work: "Работа",
  project: "Собственный проект",
  article: "Статья",
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

export function hrefFor(entry: AnyEntry) {
  /* The manifesto keeps its article data (graph, relations) but lives at its own
     address: it is the site's foundation text, not one article among articles. */
  if (entry.collection === "articles" && entry.id === "manifesto") return "/manifesto/";
  const base = entry.collection === "works" ? "works" : entry.collection === "projects" ? "projects" : entry.collection === "articles" ? "articles" : "garden";
  return `/${base}/${entry.id}/`;
}

export async function allEntries(): Promise<AnyEntry[]> {
  const groups = await Promise.all([
    getCollection("works"),
    getCollection("projects"),
    getCollection("articles"),
    getCollection("publications"),
  ]);
  return groups.flat() as AnyEntry[];
}

export function byStableId(entries: AnyEntry[]) {
  return new Map(entries.map((entry) => [entry.data.id, entry]));
}
