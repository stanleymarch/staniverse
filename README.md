# Staniverse

Новый самостоятельный `staniverse.xyz`: портфолио работ, собственные живые проекты и каталог опыта из Telegram, статей и видео. Astro строит статический сайт для GitLab Pages; Obsidian и Quartz не участвуют в публикации.

## Локальная работа

```powershell
npm install
npm run dev
```

Проверка перед публикацией:

```powershell
npm test
npm run check
npm run build
npm run test:e2e
```

## Telegram

Источник — JSON-экспорт Telegram Desktop или совместимый результат API. Текст, entities, цепочки reply, альбомы, ссылки и медиа сначала приводятся к нейтральной модели, затем генерируются страницы Astro:

```powershell
npm run telegram:import -- path\to\result.json pipeline\telegram\archive\canonical.json staniverse
npm run audit:content -- pipeline\telegram\archive\canonical.json path\to\export-folder
npm run telegram:materialize
```

Обычная ссылка на Telegram становится ребром графа, но не склеивает посты. Цепочки объединяются только по `reply_to`, `grouped_id` или явному маркеру продолжения.

## LLM-разметка

LLM не переписывает Telegram-текст. `npm run enrichment:prepare` создаёт задания с SHA-256 исходника. Темы, сущности, summary и предполагаемые связи возвращаются отдельными результатами с моделью, версией промпта, confidence и флагом ручной проверки. В качестве дешёвого bulk-профиля предусмотрен текущий небольшой model tier через Responses API + Structured Outputs; длинные и неоднозначные цепочки можно отправлять более сильной модели. Провайдер остаётся заменяемым.
