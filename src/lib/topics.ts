import type { AnyEntry } from "./content";

const transliteration: Record<string, string> = {
  а:"a", б:"b", в:"v", г:"g", д:"d", е:"e", ё:"e", ж:"zh", з:"z", и:"i", й:"i", к:"k", л:"l", м:"m",
  н:"n", о:"o", п:"p", р:"r", с:"s", т:"t", у:"u", ф:"f", х:"h", ц:"ts", ч:"ch", ш:"sh", щ:"sch", ъ:"", ы:"y", ь:"", э:"e", ю:"yu", я:"ya",
};

export function topicSlug(topic: string) {
  const transliterated = [...topic.toLocaleLowerCase("ru-RU")].map((letter) => transliteration[letter] ?? letter).join("");
  return transliterated.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "topic";
}

export interface TopicGroup { name: string; slug: string; entries: AnyEntry[]; catalog: boolean }

export function collectTopics(entries: AnyEntry[], catalogOnly = false): TopicGroup[] {
  const groups = new Map<string, AnyEntry[]>();
  for (const entry of entries) for (const tag of entry.data.tags) {
    const name = tag.trim().toLocaleLowerCase("ru-RU");
    if (!name) continue;
    groups.set(name, [...(groups.get(name) ?? []), entry]);
  }
  const blocked = new Set(["instructions", "answering"]);
  const topics = [...groups].map(([name, topicEntries]) => ({
    name,
    slug: topicSlug(name),
    entries: topicEntries,
    catalog: !blocked.has(name) && /[a-zа-яё]/iu.test(name) && (topicEntries.length >= 3 || topicEntries.some((entry) => entry.collection !== "publications")),
  }));
  return topics.filter((topic) => !catalogOnly || topic.catalog)
    .sort((a, b) => b.entries.length - a.entries.length || a.name.localeCompare(b.name, "ru"));
}
