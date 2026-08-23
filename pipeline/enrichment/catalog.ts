import { createHash } from "node:crypto";
import type { CanonicalPublication } from "../telegram/types";
import type { EnrichmentResult } from "./types";

type Rule = { label: string; patterns: RegExp[]; targetId?: string };

export const topicRules: Rule[] = [
  { label: "искусственный интеллект", patterns: [/\bии\b/iu, /нейросет/iu, /\bai\b/iu, /machine learning/iu, /deepseek/iu, /openai/iu, /anthropic/iu, /gemini/iu] },
  { label: "llm", patterns: [/\bllm/iu, /языков\w* модел/iu, /chatgpt/iu, /claude/iu, /qwen/iu] },
  { label: "агенты и автоматизация", patterns: [/агентн/iu, /автоматизац/iu, /n8n/iu, /workflow/iu, /воркфлоу/iu, /mcp\b/iu] },
  { label: "xr", patterns: [/\bwebxr\b/iu, /\bvr\b/iu, /\bar\b/iu, /виртуальн\w* реальност/iu, /дополненн\w* реальност/iu, /quest\b/iu] },
  { label: "3d и пространственные медиа", patterns: [/\b3d\b/iu, /three\.js/iu, /gaussian splat/iu, /фотограмметр/iu, /панорам/iu, /пространственн/iu] },
  { label: "веб-разработка", patterns: [/сайт/iu, /лендинг/iu, /frontend/iu, /astro\b/iu, /next\.js/iu, /javascript/iu, /typescript/iu] },
  { label: "цифровая культура", patterns: [/цифров\w* культур/iu, /интернет/iu, /медиаарт/iu, /кибер/iu, /виртуальн\w* мир/iu] },
  { label: "видео и продакшн", patterns: [/видео/iu, /съ[её]м/iu, /монтаж/iu, /продакшн/iu, /youtube/iu, /документальн/iu] },
  { label: "образование", patterns: [/образован/iu, /преподав/iu, /студент/iu, /школьник/iu, /университет/iu, /диплом/iu, /курс/iu] },
  { label: "город и наследие", patterns: [/киров/iu, /вятк/iu, /наследи/iu, /архитектур/iu, /краевед/iu, /туризм/iu, /музе/iu, /памятник/iu] },
  { label: "путешествия", patterns: [/путешеств/iu, /поездк/iu, /экспедиц/iu, /турист/iu, /маршрут/iu] },
  { label: "игры", patterns: [/\bигр/iu, /гейм/iu, /steam/iu, /playstation/iu, /xbox/iu] },
  { label: "музыка и звук", patterns: [/музык/iu, /звук/iu, /аудио/iu, /саунд/iu, /голос/iu] },
  { label: "технологии", patterns: [/технолог/iu, /гаджет/iu, /устройств/iu, /желез/iu, /приложен/iu] },
  { label: "общество", patterns: [/обществ/iu, /полит/iu, /эконом/iu, /государств/iu, /социальн/iu] },
];

export const entityRules: Rule[] = [
  { label: "Staniverse", targetId: "project:staniverse", patterns: [/staniverse/iu, /станив[её]рс/iu] },
  { label: "Nearventure", targetId: "project:nearventure", patterns: [/nearventure/iu, /нирвентур/iu] },
  { label: "Я, ты, город", targetId: "project:ya-ty-gorod", patterns: [/я[,.]?\s*ты[,.]?\s*город/iu, /yatygorod/iu] },
  { label: "Метавятка", targetId: "project:metavyatka", patterns: [/метавятк/iu, /metavyatka/iu] },
  { label: "Заповедная Вятка", targetId: "project:zapovednaya-vyatka-360", patterns: [/заповедн\w* вятк/iu] },
  { label: "Альбина", targetId: "project:albina", patterns: [/\bальбин/iu] },
  { label: "Omnipub", targetId: "project:omnipub", patterns: [/omnipub/iu, /омнипаб/iu] },
  { label: "OpenAI", patterns: [/openai/iu, /chatgpt/iu, /\bcodex\b/iu] },
  { label: "Anthropic", patterns: [/anthropic/iu, /\bclaude\b/iu] },
  { label: "Telegram", patterns: [/telegram/iu, /телеграм/iu] },
  { label: "YouTube", patterns: [/youtube/iu, /ют[уy]б/iu] },
  { label: "ВятГУ", patterns: [/вятгу/iu, /вятск\w* государственн\w* университет/iu] },
];

const matches = (text: string, rule: Rule) => rule.patterns.some((pattern) => pattern.test(text));
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

export function enrichLocally(publication: CanonicalPublication, knownTargets = new Set<string>()): EnrichmentResult {
  const text = publication.body;
  const topics = topicRules.filter((rule) => matches(text, rule)).map((rule) => rule.label);
  const matchedEntities = entityRules.filter((rule) => matches(text, rule));
  const relations = matchedEntities.flatMap((rule) => rule.targetId && knownTargets.has(rule.targetId)
    ? [{ targetId: rule.targetId, type: "mentions" as const, explanation: `Точное упоминание «${rule.label}» в исходном тексте.`, confidence: 0.98 }]
    : []);
  return {
    id: publication.id,
    textHash: hash(text),
    promptVersion: "staniverse-local-topology-v1",
    provider: "local-rules",
    model: "deterministic-v1",
    createdAt: new Date(0).toISOString(),
    summary: "",
    topics,
    entities: matchedEntities.map((rule) => rule.label),
    relations: [...new Map(relations.map((relation) => [relation.targetId, relation])).values()],
    needsReview: false,
  };
}

export function isFresh(result: EnrichmentResult, sourceText: string) {
  return result.textHash === hash(sourceText);
}
