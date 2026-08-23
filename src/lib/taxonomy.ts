/**
 * The public vocabulary used by the site.
 *
 * Content is deliberately allowed to keep old, free-form tags.  The registry
 * is the compatibility layer between those tags and the canonical vocabulary:
 * aliases are resolved at read time and no source document needs rewriting.
 */

export const topicFamilies = [
  "ai",
  "xr",
  "iot",
  "open-source",
  "web",
  "media",
  "place",
  "culture",
  "learning",
  "life",
] as const;

export type TopicFamily = (typeof topicFamilies)[number];

export interface TopicDefinition {
  /** Stable machine-readable identifier. */
  id: string;
  /** Existing public-facing name where one already exists. */
  label: string;
  family: TopicFamily;
  aliases: readonly string[];
  /** Weighted neighbours used by recommendations and graph consumers. */
  closeness: Readonly<Record<string, number>>;
  /** Human-curated nearby routes, independent of co-occurrence. */
  related: readonly string[];
  /** Routes that commonly appear alongside this topic in one material. */
  companions: readonly string[];
}

const topic = (
  definition: Omit<TopicDefinition, "closeness" | "related" | "companions"> & {
    closeness?: Readonly<Record<string, number>>;
    related?: readonly string[];
    companions?: readonly string[];
  },
): TopicDefinition => ({
  closeness: {},
  related: [],
  companions: [],
  ...definition,
});

/**
 * Canonical topics.  Keep IDs stable even when their Russian labels change:
 * URLs and stored graph edges should use IDs, not display copy.
 */
export const topicRegistry = [
  topic({
    id: "ai",
    label: "искусственный интеллект",
    family: "ai",
    aliases: ["ai", "ии", "искусственный интеллект", "генеративный ии", "genai", "ai/llm", "ai/agents"],
    closeness: { llm: 0.96, "agents-automation": 0.9, "open-source": 0.72, companions: 0.78, xr: 0.62 },
    related: ["llm", "agents-automation", "companions", "open-source"],
    companions: ["llm", "agents-automation", "xr", "iot", "open-source"],
  }),
  topic({
    id: "llm",
    label: "llm",
    family: "ai",
    aliases: ["llm", "large language model", "языковые модели", "языковая модель"],
    closeness: { ai: 0.96, "agents-automation": 0.86, "open-source": 0.76, companions: 0.72 },
    related: ["ai", "agents-automation", "open-source"],
    companions: ["ai", "agents-automation", "open-source", "companions"],
  }),
  topic({
    id: "agents-automation",
    label: "агенты и автоматизация",
    family: "ai",
    aliases: ["агенты и автоматизация", "агенты", "automation", "автоматизация", "workflows", "workflow"],
    closeness: { ai: 0.9, llm: 0.86, web: 0.74, "open-source": 0.72 },
    related: ["ai", "llm", "web", "open-source"],
    companions: ["ai", "llm", "web", "open-source", "iot"],
  }),
  topic({
    id: "xr",
    label: "xr",
    family: "xr",
    aliases: ["xr", "webxr", "vr", "ar", "mr", "метавселенная", "3d и пространственные медиа", "пространственные медиа", "xr/avatars"],
    closeness: { "ai": 0.62, companions: 0.86, iot: 0.64, web: 0.72, culture: 0.68 },
    related: ["web", "companions", "iot", "culture"],
    companions: ["ai", "iot", "web", "companions", "video", "open-source"],
  }),
  topic({
    id: "iot",
    label: "iot",
    family: "iot",
    aliases: ["iot", "internet of things", "интернет вещей", "физические интерфейсы", "телесные интерфейсы", "sensors", "сенсоры"],
    closeness: { xr: 0.64, "agents-automation": 0.78, "open-source": 0.76, companions: 0.82, ai: 0.56 },
    related: ["xr", "agents-automation", "open-source", "companions"],
    companions: ["xr", "ai", "agents-automation", "open-source", "companions"],
  }),
  topic({
    id: "open-source",
    label: "open source",
    family: "open-source",
    aliases: ["open source", "open-source", "opensource", "oss", "открытый код", "с открытым исходным кодом", "самохостинг", "self-hosting"],
    closeness: { ai: 0.72, llm: 0.76, iot: 0.76, xr: 0.72, web: 0.8 },
    related: ["ai", "iot", "xr", "web"],
    companions: ["ai", "llm", "iot", "xr", "web", "agents-automation"],
  }),
  topic({
    id: "web",
    label: "веб-разработка",
    family: "web",
    aliases: ["web", "веб-разработка", "веб разработка", "веб", "web development", "digital products", "цифровые продукты"],
    closeness: { "agents-automation": 0.74, "open-source": 0.8, xr: 0.72, culture: 0.58 },
    related: ["agents-automation", "open-source", "xr"],
    companions: ["ai", "agents-automation", "open-source", "xr"],
  }),
  topic({
    id: "video",
    label: "видео и продакшн",
    family: "media",
    aliases: ["video", "видео", "видео и продакшн", "видеопродакшн", "медиапроизводство", "documentary"],
    closeness: { sound: 0.82, xr: 0.72, culture: 0.68, place: 0.64 },
    related: ["sound", "xr", "culture", "place"],
    companions: ["xr", "sound", "culture", "place", "web"],
  }),
  topic({
    id: "sound",
    label: "музыка и звук",
    family: "media",
    aliases: ["sound", "audio", "музыка и звук", "музыка", "звук", "саунд"],
    closeness: { video: 0.82, xr: 0.64, culture: 0.72 },
    related: ["video", "xr", "culture"],
    companions: ["video", "xr", "ai", "culture"],
  }),
  topic({
    id: "place-heritage",
    label: "город и наследие",
    family: "place",
    aliases: ["город и наследие", "город", "территория", "heritage", "cultural-memory", "киров", "вятка"],
    closeness: { culture: 0.86, travel: 0.78, xr: 0.66, video: 0.64 },
    related: ["culture", "travel", "xr", "video"],
    companions: ["culture", "travel", "xr", "video", "web"],
  }),
  topic({
    id: "culture",
    label: "цифровая культура",
    family: "culture",
    aliases: ["цифровая культура", "culture", "культура", "исследования", "research", "общество", "social", "community"],
    closeness: { "place-heritage": 0.86, education: 0.7, video: 0.68, companions: 0.62 },
    related: ["place-heritage", "education", "video", "companions"],
    companions: ["place-heritage", "video", "sound", "xr", "web", "education"],
  }),
  topic({
    id: "education",
    label: "образование",
    family: "learning",
    aliases: ["education", "образование", "обучение", "учёба", "учеба"],
    closeness: { culture: 0.7, "place-heritage": 0.58, ai: 0.64, xr: 0.66 },
    related: ["culture", "ai", "xr"],
    companions: ["ai", "xr", "culture", "video", "place-heritage"],
  }),
  topic({
    id: "travel",
    label: "путешествия",
    family: "place",
    aliases: ["travel", "путешествия", "путешествие", "туризм"],
    closeness: { "place-heritage": 0.78, culture: 0.7, video: 0.66 },
    related: ["place-heritage", "culture", "video"],
    companions: ["place-heritage", "culture", "video", "xr"],
  }),
  topic({
    id: "games",
    label: "игры и виртуальные культуры",
    family: "culture",
    aliases: ["games", "игры", "геймдев", "виртуальные культуры", "virtual cultures"],
    closeness: { xr: 0.82, companions: 0.7, video: 0.62, culture: 0.68 },
    related: ["xr", "companions", "culture"],
    companions: ["xr", "companions", "video", "sound", "culture"],
  }),
  topic({
    id: "companions",
    label: "близость, отношения и компаньоны",
    family: "life",
    aliases: ["ai/companions", "компаньоны", "компаньон", "ai companions", "эмоциональные компаньоны", "близость", "отношения", "виртуальные персонажи", "intimacy", "sexuality", "интимность", "сексуальность", "этика"],
    closeness: { ai: 0.78, xr: 0.86, iot: 0.82, games: 0.7, culture: 0.62 },
    related: ["ai", "xr", "iot", "games", "culture"],
    companions: ["ai", "xr", "iot", "open-source", "games", "culture"],
  }),
] as const satisfies readonly TopicDefinition[];

export const TOPIC_REGISTRY = topicRegistry;

const definitions = new Map(topicRegistry.map((definition) => [definition.id, definition]));
const aliases = new Map<string, string[]>(
  topicRegistry.flatMap((definition) => definition.aliases.map((alias) => [normalizeAlias(alias), [definition.id]] as const)),
);

// Slash aliases carry more than one controlled label.  This is what lets a
// single old tag such as `ai/llm` retain both dimensions after normalization.
const multiAliases: Record<string, readonly string[]> = {
  "ai/llm": ["ai", "llm"],
  "ai/agents": ["ai", "agents-automation"],
  "ai/companions": ["ai", "companions"],
  "xr/avatars": ["xr", "companions"],
};

function normalizeAlias(value: string) {
  return value.trim().toLocaleLowerCase("ru-RU").normalize("NFKC").replace(/ё/g, "е").replace(/[\s_]+/g, " ");
}

export function getTopicDefinition(topicIdOrAlias: string) {
  const normalized = normalizeAlias(topicIdOrAlias);
  const id = definitions.has(normalized) ? normalized : aliases.get(normalized)?.[0];
  return id ? definitions.get(id) : undefined;
}

/** Resolve one tag to its primary stable topic ID. */
export function normalizeTopic(topic: string) {
  const normalized = normalizeAlias(topic);
  return multiAliases[normalized]?.[0] ?? (definitions.has(normalized) ? normalized : aliases.get(normalized)?.[0]);
}

/** Resolve tags, preserving unknown legacy labels and removing duplicates. */
export function normalizeTopics(tags: readonly string[]) {
  const normalized: string[] = [];
  for (const tag of tags) {
    const alias = normalizeAlias(tag);
    const resolved = multiAliases[alias] ?? (normalizeTopic(tag) ? [normalizeTopic(tag)!] : []);
    for (const id of resolved) if (!normalized.includes(id)) normalized.push(id);
    if (!resolved.length && alias) normalized.push(alias);
  }
  return normalized;
}

export function topicCloseness(first: string, second: string) {
  const a = normalizeTopic(first) ?? normalizeAlias(first);
  const b = normalizeTopic(second) ?? normalizeAlias(second);
  if (a === b) return 1;
  const firstDefinition = definitions.get(a);
  const secondDefinition = definitions.get(b);
  return firstDefinition?.closeness[b] ?? secondDefinition?.closeness[a] ?? (firstDefinition?.family === secondDefinition?.family ? 0.5 : 0);
}

export function topicRelations(topicIdOrAlias: string) {
  const definition = getTopicDefinition(topicIdOrAlias);
  return definition ? { related: [...definition.related], companions: [...definition.companions] } : { related: [], companions: [] };
}
