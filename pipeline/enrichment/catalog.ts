import { createHash } from "node:crypto";
import type { CanonicalPublication } from "../telegram/types";
import type { EnrichmentResult } from "./types";

type Rule = { label: string; patterns: RegExp[]; targetId?: string };

export const topicRules: Rule[] = [
  { label: "iot", patterns: [/\biot\b/iu, /internet of things/iu, /интернет\s+вещей/iu, /esp(?:32|8266)/iu, /zigbee/iu, /умн(?:ый|ого|ом)\s+дом/iu] },
  { label: "open source", patterns: [/open[ -]?source/iu, /открыт(?:ый|ого|ым)\s+(?:исходн(?:ый|ого|ым)\s+)?код/iu, /github\.com/iu, /gitlab\.com/iu, /\bfoss\b/iu] },
  { label: "ai-компаньоны", patterns: [/ии[- ]?(?:вайфу|компаньон)/iu, /ai[- ]?(?:waifu|companion)/iu, /виртуальн(?:ый|ого|ым)\s+(?:партн[её]р|компаньон)/iu, /character\.ai/iu, /replika\b/iu, /sillytavern/iu, /эмоциональн(?:ый|ого|ым)\s+компаньон/iu] },
  { label: "втюбинг и виртуальные персонажи", patterns: [/\bvtub(?:er|ing)s?\b/iu, /в[и]?т[ьюу]бер/iu, /виртуальн(?:ый|ого|ые)\s+ютубер/iu] },
  { label: "интим и близость", patterns: [/интим/iu, /близост/iu, /одиночеств/iu, /(?:романтическ|любовн)\w*\s+отношен/iu, /отношен\w*\s+с\s+(?:ии|ai)[- ]?(?:компаньон|вайфу)/iu, /дейтинг/iu, /свидани/iu] },
  { label: "искусственный интеллект", patterns: [/(?:^|[^\p{L}])ии(?:$|[^\p{L}])/iu, /нейросет/iu, /\bai\b/iu, /machine learning/iu, /deepseek/iu, /openai/iu, /anthropic/iu, /gemini/iu] },
  { label: "llm", patterns: [/\bllm/iu, /языков[\p{L}-]*\s+модел/iu, /chatgpt/iu, /claude/iu, /qwen/iu] },
  { label: "агенты и автоматизация", patterns: [/агентн/iu, /автоматизац/iu, /n8n/iu, /workflow/iu, /воркфлоу/iu, /mcp\b/iu] },
  { label: "xr", patterns: [/\bwebxr\b/iu, /\bvrchat\b/iu, /\bvr\b/iu, /\bar\b/iu, /виртуальн\w* реальност/iu, /дополненн\w* реальност/iu, /quest\b/iu] },
  { label: "Gaussian Splatting", patterns: [/gaussian splat/iu, /гауссиан/iu, /гауссов\w*\s+сплат/iu] },
  { label: "3d и пространственные медиа", patterns: [/\b3d\b/iu, /three\.js/iu, /gaussian splat/iu, /фотограмметр/iu, /панорам/iu, /пространственн/iu] },
  { label: "веб-разработка", patterns: [/разработ(?:ал|ать|ка|ке|ки)[\p{L}\s-]{0,24}(?:сайт|веб)/iu, /лендинг/iu, /frontend/iu, /astro\b/iu, /next\.js/iu, /javascript/iu, /typescript/iu] },
  { label: "цифровая культура", patterns: [/цифров[\p{L}-]*\s+культур/iu, /интернет[- ]культур/iu, /медиаарт/iu, /киберкультур/iu, /виртуальн[\p{L}-]*\s+мир/iu] },
  { label: "арт и сценография", patterns: [/(?:^|[^\p{L}])(?:art|арт)(?:$|[^\p{L}])/iu, /искусств(?!енн)/iu, /галере/iu, /выставк/iu, /худож(?:ник|ниц|еств)/iu, /инсталляц/iu, /биеннал/iu, /сценограф/iu, /экспозици/iu, /экспонат/iu, /вернисаж/iu] },
  { label: "видео и продакшн", patterns: [/видео/iu, /съ[её]м/iu, /монтаж/iu, /продакшн/iu, /youtube/iu, /документальн/iu] },
  { label: "образование", patterns: [/образован/iu, /преподав/iu, /студент/iu, /школьник/iu, /университет/iu, /диплом/iu, /(?:^|[^\p{L}])курс(?:ы|а|е|ом|ов)?(?:$|[^\p{L}])/iu] },
  /* Киров and Слободской need a word start: "заблокированный"/"разблокировать"
     contain киров, "Новослободской" contains слободск, and neither is the region.
     Вятка stays unguarded on purpose — it also lives inside «МетаВятка». */
  { label: "город и наследие", patterns: [/(?:^|[^\p{L}])киров/iu, /вятк/iu, /наследи/iu, /архитектур/iu, /краевед/iu, /туризм/iu, /музе/iu, /памятник/iu] },
  { label: "киров/вятка", patterns: [/(?:^|[^\p{L}])киров/iu, /вятк/iu, /(?:^|[^\p{L}])слободск/iu, /котельнич/iu, /нолинск/iu, /яранск/iu, /омутнинск/iu, /\bkirov/iu, /vyatka/iu] },
  { label: "путешествия", patterns: [/путешеств/iu, /поездк/iu, /экспедиц/iu, /турист/iu, /маршрут/iu] },
  { label: "игры", patterns: [/(?:^|[^\p{L}])игр(?:а|ы|е|у|ой|ами|ать|аю|овой|овый|ового)/iu, /гейм/iu, /steam/iu, /playstation/iu, /xbox/iu] },
  { label: "музыка и звук", patterns: [/музык/iu, /звук/iu, /аудио/iu, /саунд/iu, /озвуч/iu, /синтез\s+голос/iu] },
  { label: "технологии", patterns: [/технолог/iu, /гаджет/iu, /устройств/iu, /желез/iu, /приложен/iu] },
  { label: "общество", patterns: [/обществ/iu, /полит/iu, /эконом/iu, /государств/iu, /социальн/iu] },
];

export const entityRules: Rule[] = [
  { label: "Staniverse", targetId: "project:staniverse", patterns: [/staniverse/iu, /станив[её]рс/iu] },
  { label: "Nearventure", targetId: "project:nearventure", patterns: [/nearventure/iu, /нирвентур/iu] },
  { label: "Я, ты, город", targetId: "project:ya-ty-gorod", patterns: [/я[,.]?\s*ты[,.]?\s*город/iu, /yatygorod/iu] },
  { label: "Метавятка", targetId: "project:metavyatka", patterns: [/метавятк/iu, /metavyatka/iu] },
  { label: "Заповедная Вятка", targetId: "project:zapovednaya-vyatka-360", patterns: [/заповедн[\p{L}-]*\s+вятк/iu] },
  { label: "Альбина", targetId: "project:albina", patterns: [/(?:^|[^\p{L}])альбин/iu] },
  { label: "Omnipub", targetId: "project:omnipub", patterns: [/omnipub/iu, /омнипаб/iu] },
  { label: "OpenAI", patterns: [/openai/iu, /chatgpt/iu, /\bcodex\b/iu] },
  { label: "Anthropic", patterns: [/anthropic/iu, /\bclaude\b/iu] },
  { label: "Telegram", patterns: [/telegram/iu, /телеграм/iu] },
  { label: "YouTube", patterns: [/youtube/iu, /ют[уy]б/iu] },
  { label: "VRChat", patterns: [/vrchat/iu] },
  { label: "ВятГУ", patterns: [/вятгу/iu, /вятск\w* государственн\w* университет/iu] },
];

const matches = (text: string, rule: Rule) => rule.patterns.some((pattern) => pattern.test(text));
const hash = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");

export function enrichLocally(publication: CanonicalPublication, knownTargets = new Set<string>()): EnrichmentResult {
  const text = publication.body;
  const classificationText = text.replace(/[\r\n ]*\[Оригинал в Telegram\]\([^)]*\)\s*$/, "");
  const topics = topicRules.filter((rule) => matches(classificationText, rule)).map((rule) => rule.label);
  const matchedEntities = entityRules.filter((rule) => matches(classificationText, rule));
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
