import type { CollectionEntry } from "astro:content";

const ownedProjectClients = new Set([
  "проект: albina",
  "проект: metavyatka",
  "проект: omnipub",
  "проект: staniverse",
  "проект: я.ты.город",
]);

/**
 * The legacy corpus stored some chapters of owned projects in `works`.
 * Keep those records addressable for old links and graph evidence, but never
 * expose them as commissioned portfolio work.
 */
export function isCommissionedWork(entry: CollectionEntry<"works">) {
  const client = entry.data.client?.trim().toLocaleLowerCase("ru-RU") ?? "";
  return client !== "проект:" && !ownedProjectClients.has(client);
}

export function isOwnedProjectChapter(entry: CollectionEntry<"works">) {
  return !isCommissionedWork(entry);
}

