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
    id: "embodied-ai",
    label: "воплощённый интеллект",
    family: "ai",
    aliases: ["embodied-ai", "embodied ai", "воплощённый интеллект", "воплощенный интеллект", "роботы и интеллект"],
    closeness: { ai: 0.86, iot: 0.78, xr: 0.68, "agents-automation": 0.76 },
    related: ["ai", "iot", "agents-automation", "xr"],
    companions: ["ai", "iot", "xr", "open-source"],
  }),
  topic({
    id: "xr",
    label: "xr",
    family: "xr",
    aliases: ["xr", "webxr", "vr", "ar", "mr", "3d и пространственные медиа", "пространственные медиа", "xr/avatars"],
    closeness: { "ai": 0.62, companions: 0.86, iot: 0.64, web: 0.72, culture: 0.68, "gaussian-splatting": 0.88 },
    related: ["web", "companions", "iot", "culture", "gaussian-splatting"],
    companions: ["ai", "iot", "web", "companions", "video", "open-source", "gaussian-splatting"],
  }),
  topic({
    id: "gaussian-splatting",
    label: "Gaussian Splatting",
    family: "xr",
    aliases: ["gaussian splatting", "gaussian splat", "gaussian splats", "3d gaussian splatting", "сплаты", "гауссианы", "гауссовы сплаты"],
    closeness: { xr: 0.88, "place-heritage": 0.82, web: 0.7, "social-vr": 0.76, "open-source": 0.66 },
    related: ["xr", "place-heritage", "social-vr", "web"],
    companions: ["xr", "place-heritage", "social-vr", "web", "open-source", "video"],
  }),
  topic({
    id: "metaverse",
    label: "метавселенные",
    family: "xr",
    aliases: ["метавселенная", "метавселенные", "metaverse"],
    closeness: { xr: 0.85, "social-vr": 0.7, culture: 0.6 },
    related: ["xr", "social-vr", "culture"],
    companions: ["xr", "social-vr", "games", "culture"],
  }),
  topic({
    id: "social-vr",
    label: "социальный vr",
    family: "xr",
    aliases: ["social-vr", "social vr", "социальный vr", "социальная виртуальная реальность", "virtual social worlds"],
    closeness: { xr: 0.9, culture: 0.74, companions: 0.72, "place-heritage": 0.58 },
    related: ["xr", "culture", "companions"],
    companions: ["xr", "culture", "companions", "video"],
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
    aliases: ["open source", "open-source", "opensource", "oss", "открытый код", "с открытым исходным кодом"],
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
    aliases: ["video", "видео", "видео и продакшн", "видеопродакшн", "медиапроизводство", "documentary", "animation", "анимация", "motion"],
    closeness: { sound: 0.82, xr: 0.72, culture: 0.68, "place-heritage": 0.64 },
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
    aliases: ["город и наследие", "город", "place", "территория", "heritage", "cultural-memory", "киров", "вятка"],
    closeness: { culture: 0.86, travel: 0.78, xr: 0.66, video: 0.64 },
    related: ["culture", "travel", "xr", "video"],
    companions: ["culture", "travel", "xr", "video", "web"],
  }),
  topic({
    id: "culture",
    label: "цифровая культура",
    family: "culture",
    aliases: ["цифровая культура", "culture", "культура", "исследования", "research", "community"],
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
    label: "ai-компаньоны",
    family: "life",
    // Human intimacy belongs to intimate-tech; companions is machine-companionship only.
    aliases: ["ai/companions", "компаньоны", "компаньон", "ai companions", "эмоциональные компаньоны", "ии-компаньон", "ии-вайфу", "близость, отношения и компаньоны"],
    closeness: { ai: 0.78, xr: 0.86, iot: 0.82, games: 0.7, culture: 0.62 },
    related: ["ai", "xr", "iot", "games", "culture"],
    companions: ["ai", "xr", "iot", "open-source", "games", "culture"],
  }),
  topic({
    id: "intimate-tech",
    label: "интим и близость",
    family: "life",
    // One intimacy theme for every medium: ERP in social VR, teledildonics, human or AI closeness.
    aliases: ["intimate-tech", "intimate tech", "интимные технологии", "интимные устройства", "sexual technology", "близость", "отношения", "интимность", "сексуальность", "intimacy", "sexuality", "erp"],
    closeness: { companions: 0.84, iot: 0.74, xr: 0.7, "social-vr": 0.78, culture: 0.6 },
    related: ["companions", "iot", "xr", "social-vr", "culture"],
    companions: ["companions", "iot", "xr", "social-vr", "ai"],
  }),
  topic({
    id: "vtubing",
    label: "втюбинг и виртуальные персонажи",
    family: "media",
    aliases: ["vtubing", "vtuber", "втюбер", "втюбинг", "витюбер", "виртуальный ютубер", "virtual youtuber", "виртуальные персонажи"],
    closeness: { xr: 0.8, ai: 0.68, companions: 0.66, video: 0.72, culture: 0.62 },
    related: ["xr", "ai", "companions", "video"],
    companions: ["xr", "ai", "companions", "video", "sound"],
  }),
  topic({
    id: "lifestyle",
    label: "повседневность и личный опыт",
    family: "life",
    aliases: ["lifestyle", "лайфстайл", "быт", "повседневность", "личное", "личный опыт", "личный дневник"],
    closeness: { travel: 0.64, "place-heritage": 0.6, culture: 0.62, companions: 0.5 },
    related: ["place-heritage", "culture", "travel"],
    companions: ["place-heritage", "culture", "travel", "sound"],
  }),
  topic({
    id: "writing",
    label: "тексты и письмо",
    family: "media",
    aliases: ["writing", "тексты", "письмо", "копирайтинг", "журналистика"],
    closeness: { media: 0.8, culture: 0.66, "agents-automation": 0.6 },
    related: ["media", "culture", "education"],
    companions: ["media", "video", "culture", "education"],
  }),
  topic({
    id: "art",
    label: "арт и сценография",
    family: "culture",
    aliases: ["art", "арт", "сценография", "искусство", "digital art"],
    closeness: { culture: 0.82, xr: 0.7, video: 0.6 },
    related: ["culture", "xr", "video"],
    companions: ["culture", "xr", "video", "sound"],
  }),
  topic({
    id: "kirov",
    label: "киров",
    family: "place",
    aliases: ["kirov", "киров", "вятка", "vyatka", "слободской", "slobodskoy"],
    closeness: { "place-heritage": 0.9, culture: 0.64, travel: 0.6 },
    related: ["place-heritage", "culture", "travel"],
    companions: ["place-heritage", "culture", "video", "travel"],
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
  "xr/avatars": ["xr", "vtubing"],
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
  return firstDefinition?.closeness[b] ?? secondDefinition?.closeness[a] ?? (firstDefinition && secondDefinition && firstDefinition.family === secondDefinition.family ? 0.5 : 0);
}

export function topicRelations(topicIdOrAlias: string) {
  const definition = getTopicDefinition(topicIdOrAlias);
  return definition ? { related: [...definition.related], companions: [...definition.companions] } : { related: [], companions: [] };
}
