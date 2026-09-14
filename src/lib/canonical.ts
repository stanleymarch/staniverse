import type { CollectionEntry } from "astro:content";


const projectByClient = new Map([
  ["проект: albina", "project:albina"],
  ["проект: metavyatka", "project:metavyatka"],
  ["проект: omnipub", "project:omnipub"],
  ["проект: staniverse", "project:staniverse"],
  ["проект: я.ты.город", "project:ya-ty-gorod"],
]);


export function ownedProjectId(entry: CollectionEntry<"works">) {
  const client = entry.data.client?.trim().toLocaleLowerCase("ru-RU") ?? "";
  return projectByClient.get(client);
}
