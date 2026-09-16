import type { AnyEntry } from "./content";
import { getTopicDefinition, normalizeTopics, topicRelations } from "./taxonomy";

const transliteration: Record<string, string> = {
  а:"a", б:"b", в:"v", г:"g", д:"d", е:"e", ё:"e", ж:"zh", з:"z", и:"i", й:"i", к:"k", л:"l", м:"m",
  н:"n", о:"o", п:"p", р:"r", с:"s", т:"t", у:"u", ф:"f", х:"h", ц:"ts", ч:"ch", ш:"sh", щ:"sch", ъ:"", ы:"y", ь:"", э:"e", ю:"yu", я:"ya",
};

export function topicSlug(topic: string) {
  const transliterated = [...topic.toLocaleLowerCase("ru-RU")].map((letter) => transliteration[letter] ?? letter).join("");
  return transliterated.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "topic";
}

/**
 * Topic route for a canonical ID, a stored tag or a display label — or undefined when
 * the value is not part of the vocabulary and therefore has no `/topics/` page.
 * Callers must not build the path with `topicSlug(value)` themselves: routes are keyed
 * by the canonical label, while stored values are IDs and aliases.
 */
export function topicRoute(topicIdOrAlias: string) {
  const definition = getTopicDefinition(topicIdOrAlias);
  return definition ? `/topics/${topicSlug(definition.label)}/` : undefined;
}

export interface TopicGroup {
  /** Stable canonical ID (or a normalized legacy label for unknown tags). */
  id: string;
  /** Display label retained for compatibility with existing topic routes. */
  name: string;
  slug: string;
  entries: AnyEntry[];
  catalog: boolean;
  family?: string;
  related: string[];
  companions: string[];
}

export function collectTopics(entries: AnyEntry[], catalogOnly = false): TopicGroup[] {
  const groups = new Map<string, AnyEntry[]>();
  for (const entry of entries) {
    const values = entry.collection === "publications"
      ? entry.data.topics ?? []
      : [...entry.data.tags, ...(entry.data.topics ?? [])];
    for (const value of values) {
      const ids = normalizeTopics([value]);
      for (const id of ids) {
        if (!getTopicDefinition(id)) continue;
        const topicEntries = groups.get(id) ?? [];
        if (!topicEntries.includes(entry)) groups.set(id, [...topicEntries, entry]);
      }
    }
  }
  const blocked = new Set(["instructions", "answering"]);
  const topics = [...groups].map(([id, topicEntries]) => {
    const definition = getTopicDefinition(id);
    const name = definition?.label ?? id;
    const relations = topicRelations(id);
    return {
      id,
      name,
      slug: topicSlug(name),
      entries: topicEntries,
      family: definition?.family,
      related: relations.related,
      companions: relations.companions,
      catalog: Boolean(definition) && !blocked.has(id) && /[a-zа-яё]/iu.test(name),
    };
  });
  return topics.filter((topic) => !catalogOnly || topic.catalog)
    .sort((a, b) => b.entries.length - a.entries.length || a.name.localeCompare(b.name, "ru"));
}
