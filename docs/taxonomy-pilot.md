# Таксономический пилот

Дата: 2026-09-06. Основание: `docs/refresh-architecture.md`, локальные Markdown публикации Telegram и `src/lib/taxonomy.ts`. Это ручной bounded-пилот; полный массив LLM/API запрещён до его ревью и успешного gate.

## Факты корпуса

Локальный корпус содержит 744 публикации: 2023 — 16, 2024 — 269, 2025 — 340, 2026 — 119. У 733 постов нет `tags`, у 338 нет `topics`. Частоты исходных `tags`/`sourceTags` считаются по уникальным значениям внутри документа; повтор исходного тега не должен удваивать частоту. Наблюдаемые tags: `1` (4), `answering` (4), `instructions` (4), `vr` (2), `5` (2), `-скриптами` (2), `исследования` (2), `ии` (2), `метавселенная` (2), `пример` (2), `китай` (2), `freedurov` (2), `madebygoogle` (2), `эмоциональныекомпаньоны` (2), `genai` (2), `хищныевещивека` (2). Остальные встречаются по одному разу.

Наблюдаемые `topics`: искусственный интеллект (200), видео и продакшн (189), технологии (139), город и наследие (133), llm (113), общество (112), игры (96), xr (94), 3d и пространственные медиа (80), музыка и звук (78), образование (65), open source (61), агенты и автоматизация (38), путешествия (36), близость, отношения и компаньоны (33), цифровая культура (17), iot (16), веб-разработка (11). Это частоты источника, не ground truth разметки.

## Кандидатный словарь

Стабильные IDs должны оставаться машинными; aliases не стирают исходный hashtag. Пилот использует существующие 21 тему:

| ID | Определение и граница |
|---|---|
| `ai` | Общие методы/применения искусственного интеллекта; конкретная языковая модель получает также `llm`. |
| `llm` | Языковые модели, обучение, prompting, inference и их продукты; не любой автоматический скрипт. |
| `agents-automation` | Агент, workflow или автоматизация, выполняющая цепочку действий; чат без действия не достаточен. |
| `embodied-ai` | Воплощённый ИИ: situated perception/action в виртуальной или физической среде; пересекается с XR/IoT. `Albina` подтверждает эту тему описанием embodied AI-персона и имеет planned prototype status. |
| `xr` | XR/WebXR/VR/AR/MR и пространственные интерфейсы; social VR — отдельная уточняющая тема. |
| `metaverse` | Метавселенные как платформы/миры/инфраструктура; не синоним любого 3D или XR. |
| `social-vr` | Социальное взаимодействие и события внутри VR; не каждый VR-игровой или технический пост. |
| `iot` | Сенсоры, устройства и физические интерфейсы, связанные с данными/сетью. |
| `intimate-tech` | Интим и близость в цифровых средах и технологиях: человеческое ERP в Social VR, теледильдоника, интимные устройства и отношения с AI-компаньонами. `companions` добавляется только для участника-машины, `social-vr` — для человеческого взаимодействия в VR, `iot` — для предметного разбора устройств. |
| `open-source` | Открытая лицензия/код/модель или self-hosting с явным открытым доступом; self-hosting не автоматически open source. |
| `web` | Веб-разработка и цифровые продукты; ссылка на сайт сама по себе недостаточна. |
| `video` | Видео, съёмка, монтаж и продакшн; короткое упоминание ролика без обсуждения может быть media evidence, но не обязательно topic. |
| `sound` | Музыка, аудио и звук как предмет поста; AI-генерация музыки получает также `ai`. |
| `place-heritage` | Город, территория, локальная история и культурное наследие; не любое путешествие. |
| `culture` | Цифровая культура, общественные и исследовательские практики; `общество` не alias ко всем темам. |
| `education` | Обучение, курс, исследование учащегося или педагогическая практика. |
| `travel` | Поездка/туризм/маршрут; локальный пост о городе остаётся `place-heritage`, если это его предмет. |
| `games` | Игры, геймдев и игровые культуры; social VR без игровой механики не обязан быть games. |
| `companions` | AI-компаньоны и отношения человек-машина; не всякая близость и не всякий social VR. |

Open questions: нужны ли отдельные `digital-characters`, `agent-memory` и `voice` как уточнения; где проходит порог между `intimate-tech` и `companions`; считать ли пост с несколькими доменами несколькими topics. Не превращать entity/project в topic автоматически.

## Детерминированная выборка

Единственный manifest содержит 29 публикаций и один project-source: tuning — 15 публикаций и `project:metavyatka`, holdout — 14 публикаций. Три длинных источника (`423`, `518`, `743`) разбиты на два segment jobs каждый, поэтому 30 источникам соответствуют 33 задания. Holdout не использовался для настройки aliases или prompt.

| Источник | Split | Роль в пилоте и ожидаемая ручная граница |
|---|---|---|
| `publication:telegram:staniverse:3` | tuning | короткий личный запуск канала; отсутствие содержательной темы |
| `publication:telegram:staniverse:4` | tuning | Unity fee policy; games и named products |
| `publication:telegram:staniverse:7` | tuning | короткая Meta Connect ссылка; entities без содержательной XR-темы |
| `publication:telegram:staniverse:8` | tuning | три слова; отсутствие содержательной темы |
| `publication:telegram:staniverse:11` | tuning | поездка Москва/Киров; travel, place-heritage, lifestyle |
| `publication:telegram:staniverse:24` | tuning | AI-переозвучка стихов; ai, sound, place-heritage |
| `publication:telegram:staniverse:76` | tuning | prompt engineering; ai, llm, education; sourceTag contamination |
| `publication:telegram:staniverse:91` | tuning | AI-музыкальный подарок Вятке; credit не равен самостоятельной LLM-теме |
| `publication:telegram:staniverse:167` | tuning | больничный технологический дневник; IoT, AI companion и lifestyle |
| `publication:telegram:staniverse:367` | tuning | фотограмметрия и социальное использование Resonite |
| `publication:telegram:staniverse:382` | tuning | учебное исследование с LLM, XR-данными и generated audio |
| `publication:telegram:staniverse:414` | tuning | VRConf, metaverse/open-source и AI-agent workflow |
| `publication:telegram:staniverse:423` | tuning | курс VR-игр и scenography; два segment jobs |
| `publication:telegram:staniverse:425` | tuning | выпускной и разработка MetaVyatka; non-intimacy control |
| `publication:telegram:staniverse:1008` | tuning | digital garden, heritage, companions и open framework |
| `project:metavyatka` | tuning | отдельный editorial project-source; project→work/project evidence |
| `publication:telegram:staniverse:416` | holdout | AI-романтика; ai, companions, intimate-tech |
| `publication:telegram:staniverse:451` | holdout | руководство AI-waifu; topics и слабая project membership relation |
| `publication:telegram:staniverse:518` | holdout | agent workflow, web stack и обучение; два segment jobs |
| `publication:telegram:staniverse:593` | holdout | lifestyle, sound, place; non-intimacy control |
| `publication:telegram:staniverse:690` | holdout | EEG/game interfaces; iot/games, non-intimacy control |
| `publication:telegram:staniverse:710` | holdout | Social VR и персонализированный lap dance; social-vr/xr/intimate-tech, не companions |
| `publication:telegram:staniverse:743` | holdout | production diary и проекты; два segment jobs |
| `publication:telegram:staniverse:974` | holdout | AI/LLM agents, IoT и open-source; sourceTag contamination |
| `publication:telegram:staniverse:979` | holdout | coding agents и web-app implementation |
| `publication:telegram:staniverse:985` | holdout | Lovense API и VR feedback; intimate-tech/iot/xr |
| `publication:telegram:staniverse:1000` | holdout | AI/open-model legal critique; qualified claims |
| `publication:telegram:staniverse:1001` | holdout | продолжение об open models; video product не обязательно video topic |
| `publication:telegram:staniverse:1031` | holdout | portfolio/interview guide и Somnium; mixed source |
| `publication:telegram:staniverse:1115` | holdout | Nearventure development, open data, citizen science и planned XR/agent workflow |

Heuristic fields и model confidence не являются ground truth. Значения `1`, `5`, `instructions`, `answering` и `-скриптами` сохраняются как raw sourceTags, но рассматриваются как contamination до проверки исходного span.

## Gate

Gate закрывается только после slow review всех 30 стабильных источников, исправления принятых topics/entities/relations и проверки incremental apply. Успех обработки API не равен семантической приёмке. Полный LLM/API массив требует отдельного разрешения даже после принятого pilot.
