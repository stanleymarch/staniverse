# Staniverse

Новый самостоятельный `staniverse.xyz`: портфолио работ, собственные живые проекты и каталог опыта из Telegram, статей и видео. Astro строит статический сайт; production-деплой выполняет GitHub Actions в Yandex Object Storage. GitLab Pages сохраняется только как временный rollback до завершения DNS-cutover.

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

Контент хранится в этом же репозитории в типизированных коллекциях Astro. Сейчас миграция включает 26 канонических описаний работ и проектных глав, 11 собственных проектов с живыми статусами, 2 полноформатные статьи, 19 подтверждённых авторских YouTube-видео и 678 Telegram-публикаций. Работы и собственные проекты намеренно остаются разными сущностями графа: работа — кейс с рамкой «задача → решение → результат», в том числе самостоятельный (Арка Вятского кремля), проект — живая система со статусом и следующим шагом. Каталог работ показывает все кейсы без изъятий, а страница проекта дополнительно собирает свои главы.

Повторный перенос старых описаний и обновление видеокаталога:

```powershell
npm run migrate:legacy
npm run videos:materialize
```

Исходные Markdown старого сайта нужны только мигратору; опубликованный сайт от Obsidian и Quartz не зависит.

Старые адреса Quartz (`works/cases`, `lab`, `articles`, 594 адреса `/garden/posts/*` и 190 адресов `/tags/*`) обслуживает карта `src/lib/legacy-redirects.ts`; сгенерированная часть лежит в `src/lib/legacy-post-redirects.ts`. Она привязана к снимку опубликованного индекса `pipeline/legacy/content-index.json`, поэтому пересборка не требует сети:

```powershell
npx tsx scripts/build-legacy-redirects.ts --check
npx tsx scripts/build-legacy-redirects.ts --snapshot path\to\contentIndex.json --write-snapshot
npx tsx scripts/build-legacy-redirects.ts
```

Первый запуск падает, если карта разошлась со снимком; второй обновляет снимок из живого `https://staniverse.xyz/static/contentIndex.json`; третий пересобирает карту из снимка.

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

### Автосинхронизация

Регулярная выгрузка идёт с машины, где живут локальный архив `pipeline/telegram/archive` (~3,7 ГБ, вне Git) и сессия Telethon. Наружу уходят только материализованные страницы и медиавитрина, а пуш в `master` запускает деплой.

```bash
python3 -m venv pipeline/telegram/.venv
pipeline/telegram/.venv/bin/pip install -r requirements-telegram.txt
# в .env добавляются ключи приложения с my.telegram.org:
#   TELEGRAM_API_ID=...
#   TELEGRAM_API_HASH=...
pipeline/telegram/.venv/bin/python pipeline/telegram/login.py   # интерактивный вход, сессия в pipeline/telegram/private/
mkdir -p ~/.config/systemd/user
cp ops/systemd/telegram-sync.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now telegram-sync.timer
```

`ops/systemd/telegram-sync.timer` запускает `scripts/telegram-sync.sh` в 01:00, 07:00, 13:00 и 19:00 по локальному времени; `Persistent=true` догоняет пропущенный запуск после сна. Скрипт читает ключи из `.env`, прогоняет `npm run telegram:update` и коммитит только `src/content/publications/telegram` и `public/media/telegram`, поэтому незакоммиченная работа в других путях не попадает в коммит. Пуш идёт через credential helper `gh`, токен в конфиге git не хранится.

Одна тонкость: `telegram:materialize` перезаписывает страницы **всех** публикаций из локального бандла разметки, а выверенные темы живут только в самих страницах — бандл решений лежит в игнорируемом `pipeline/enrichment/review/`. Поэтому после обновления скрипт откатывает страницы, чей `sourceId` не новее базлайна, и коммитит только принесённое этим запуском. Без этого шага ночная синхронизация тихо понижала бы разметку сотен старых постов.

Для CI тот же шаг возможен через `TELEGRAM_SESSION_STRING` (`pipeline/telegram/.venv/bin/python pipeline/telegram/login.py --string`), но только если раннер получит доступ к каноническому архиву и исходным медиа: `publish-media` кодирует недостающее из исходников архива, а сам архив сейчас вне Git.

## LLM-разметка

LLM не переписывает Telegram-текст. `npm run enrichment:prepare` создаёт задания с SHA-256 исходника. Темы, сущности, summary и предполагаемые связи возвращаются отдельными результатами с моделью, версией промпта, confidence и флагом ручной проверки. В качестве дешёвого bulk-профиля предусмотрен текущий небольшой model tier через Responses API + Structured Outputs; длинные и неоднозначные цепочки можно отправлять более сильной модели. Провайдер остаётся заменяемым.
