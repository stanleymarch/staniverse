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

## Корпус сайта

Контент хранится в этом же репозитории в типизированных коллекциях Astro. Сейчас миграция включает 26 канонических описаний работ и проектных глав, 9 собственных проектов с живыми статусами, 2 полноформатные статьи, 19 подтверждённых авторских YouTube-видео и 744 Telegram-публикации. Работы для других и собственные проекты намеренно остаются разными сущностями графа; проектные главы отображаются внутри проекта, а не в заказном портфолио.

Повторный перенос старых описаний и обновление видеокаталога:

```powershell
npm run migrate:legacy
npm run videos:materialize
```

Исходные Markdown старого сайта нужны только мигратору; опубликованный сайт от Obsidian и Quartz не зависит.

## Telegram

Источник — JSON-экспорт Telegram Desktop или совместимый результат API. Текст, entities, цепочки reply, альбомы, ссылки и медиа сначала приводятся к нейтральной модели, затем генерируются страницы Astro:

```powershell
npm run telegram:import -- path\to\result.json pipeline\telegram\archive\canonical.json staniverse
npm run audit:content -- pipeline\telegram\archive\canonical.json path\to\export-folder
npm run telegram:materialize
```

Первая полная выгрузка становится локальным baseline. Следующие полные или частичные выгрузки можно накатывать той же командой: сообщения объединяются по Telegram `message_id`, новые добавляются, отредактированные заменяются, неизменные не дублируются. Структурные Telegram Articles разбираются из `rich_message` без LLM.

После baseline Desktop больше не нужен для обычных обновлений. Однократно установите Telethon, задайте ключи приложения с `my.telegram.org` и авторизуйте локальную сессию:

```powershell
python -m pip install -r requirements-telegram.txt
$env:TELEGRAM_API_ID="..."
$env:TELEGRAM_API_HASH="..."
npm run telegram:update
```

Команда читает `lastMessageId` из baseline, забирает через MTProto только более новые сообщения, скачивает их медиа, объединяет архив, оптимизирует изображения, заново применяет автоматическую разметку и материализует страницы. Сессия хранится в `pipeline/telegram/private/` и исключена из Git. Cached-page блоки Telegram Articles преобразуются в заголовки, абзацы, ссылки и галереи; исходный текст не рерайтится.

```powershell
npm run telegram:sync -- path\to\ChatExport
npm run telegram:publish-media
npm run telegram:materialize
```

Сырой архив остаётся в игнорируемой `pipeline/telegram/archive/source`. Для Pages изображения преобразуются в WebP, видео — в H.264 MP4 до 960 px, аудио — в MP3 96 кбит/с; документы копируются без изменения. `npm run audit:media` не допускает файл тяжелее 9,5 МБ и витрину тяжелее 250 МБ. Поэтому Git хранит готовую оптимизированную медиавитрину, а не исходный экспорт.

Обычная ссылка на Telegram становится ребром графа, но не склеивает посты. Цепочки объединяются только по `reply_to`, `grouped_id` или явному маркеру продолжения.

## LLM-разметка

LLM не переписывает Telegram-текст. `npm run enrichment:prepare` создаёт задания с SHA-256 исходника. Темы, сущности, summary и предполагаемые связи возвращаются отдельными результатами с моделью, версией промпта, confidence и флагом ручной проверки. В качестве дешёвого bulk-профиля предусмотрен текущий небольшой model tier через Responses API + Structured Outputs; длинные и неоднозначные цепочки можно отправлять более сильной модели. Провайдер остаётся заменяемым.
