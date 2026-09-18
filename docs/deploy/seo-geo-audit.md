# SEO/GEO-аудит staniverse-site (перед прод-деплоем)

Дата: 2026-09-18. Аудит: SeoGeoScout (read-only).
Оценка в целом: **база сильная** — канонические URL, OG/Twitter, JSON-LD @graph, sitemap с lastmod, llms.txt уже есть. Критичные дыры: нет страницы 404, `/contacts/` отсутствует в sitemap, у Article-разметки нет `image`, нет хлебных крошек/BreadcrumbList, нет RSS.

---

## 1. Покрытие страниц: title / description / canonical / OG / Twitter

Единая точка — `src/layouts/Base.astro`: description (строка 109), canonical (125), og:type/site_name/locale/title/description/url/image + размеры + alt (126–135), Twitter-карточка (136–140), `<title>` (143), meta robots (108). Всё строится от `Astro.site` → абсолютные URL (33).

| Страница | title | description | OG/Twitter | JSON-LD | Замечания |
|---|---|---|---|---|---|
| `/` index.astro:144 | ✅ | ✅ | ✅ (default OG) | ProfilePage (index.astro:133–141) | — |
| `/works/` works/index.astro:9 | ✅ | ✅ | ✅ | только базовый @graph | см. P1-3 |
| `/works/[id]/` → EntryPage.astro:78 | ✅ | ✅ (summary) | ✅ | CreativeWork/VideoObject/Article (57–75) | нет image у Article (P1-2) |
| `/projects/` projects/index.astro:9 | ✅ | ✅ | ✅ | базовый | — |
| `/garden/` garden/index.astro:110 | ✅ | ✅ | ✅ | базовый | — |
| `/garden/[...id]/` | ✅ | ✅ | ✅ | как works | 301-редиректы поглощённых тредов |
| `/articles/[id]/` | ✅ | ✅ | ✅ | Article | манифест = `/articles/manifesto/` |
| `/topics/` + `/topics/[slug]/` | ✅ | ✅ | ✅ | базовый | — |
| `/videos/` videos/index.astro:53 | ✅ | ✅ | ✅ | CollectionPage + ItemList/VideoObject | образцовая |
| `/about/` | ✅ | ✅ | ✅ | AboutPage | — |
| `/contacts/` | ✅ | ✅ | ✅ | ContactPage | нет в sitemap (P0-2) |
| `/privacy/` | ✅ | ✅ | ✅ | базовый | — |
| `/donate/` | ✅ | ✅ | ✅ | базовый | — |
| `/universe/` | ✅ | ✅ | ✅ | базовый | immersive, без хедера — ок |
| legacy-редиректы | ✅ | — | — | — | canonical + meta refresh + JS — корректно |

Дубликатов title/description между страницами не обнаружено; шаблон `«Title · Staniverse»` (Base.astro:29–31) консистентен.

## 2. Структурированные данные (JSON-LD)

Всегда в `@graph` (Base.astro:36–96): `WebSite` (38–47) + `Person` (49–80, с knowsAbout, sameAs, alumniOf).

- ✅ `ProfilePage` — главная; `AboutPage`/`ContactPage` — через проп `pageType`; `CollectionPage`+`ItemList`+`VideoObject` — /videos/; `VideoObject`/`Article`/`CreativeWork` — карточки материалов.
- ❌ `BreadcrumbList` — отсутствует нигде → P1-1.
- ❌ `image` у `Article`/`CreativeWork` для works/projects/articles → P1-2 (Google требует image для article rich results).
- ❌ `CollectionPage`/`ItemList` для /works/, /projects/, /garden/, /topics/[slug]/ — нет (P2).
- `inLanguage: "ru-RU"` проставлен везде; при i18n станет захардкоженным (см. §7).

## 3. Sitemap и robots

- `src/pages/sitemap.xml.ts`: custom-endpoint, `<lastmod>` из `updated ?? date`, приоритеты не выставлены — правильно.
- ❌ **P0-2**: `/contacts/` нет в `records` — единственная индексируемая страница без sitemap.
- `/cv/` — статические PDF из public/, sitemap не нужен.
- `public/robots.txt`: `Allow: /` + Sitemap → прод-адрес; для превью переписывается `scripts/rewrite-pages-base.mjs`. Для корневого прода — no-op, корректно.
- ❌ lastmod `/privacy/` захардкожен `new Date("2026-09-18")` → P2-3.

## 4. GEO-готовность (AI-краулеры / answer engines)

- ✅ `public/llms.txt` — высокое качество: факты о персоне, разделы с абсолютными URL, правила цитирования.
- ✅ robots.txt не блокирует GPTBot/PerplexityBot/ClaudeBot/Google-Extended/CCBot — желаемое поведение.
- ✅ Семантические ориентиры: skip-link, header/nav/main/footer, aria-label у навигаций.
- ✅ Иерархия заголовков: один h1 на шаблон, карточки — h2/h3. Нарушений нет.
- ✅ Plain-language summaries: `entry.data.summary` обязателен по схеме и используется как description.
- ❌ hreflang/alternates отсутствуют полностью — см. §7.
- ❌ Нет `llms-full.txt` — опционально (P2-8).

## 5. Изображения

- OG-картинки: `scripts/gen-og.mjs` рендерит 10 PNG 1200×630 в dist/og/ на postbuild. Дыры: для публикаций og:image = YouTube-превью 480×360, но `og:image:width/height` жёстко 1200/630 → P1-4.
- Alt: осмысленные у карусели/галереи; декоративные `alt=""` у превью видео — корректный паттерн.
- ❌ Width/height нет у карусели и галереи публикаций (EntryPage.astro:107, 118) → P2-2 (CLS).
- ❌ Markdown-контент рендерится без width/height/lazy → P2-1.
- Lazy loading: последовательный `loading="lazy"` + `decoding="async"` ниже фолда; hero-постер eager — правильно.

## 6. Внутренняя перелинковка и каноническая стратегия

- Хлебных крошек нет ни визуально, ни в разметке → P1-1.
- **`/tags/` не существует** — единый словарь тем `/topics/<slug>/`, дублей topics-vs-tags нет.
- Параметрические URL сада (`?q=`, `?source=`) — canonical всегда чистый путь → дублей в индексе не будет. ✅
- Перелинковка плотная: read-next, локальный граф, главы проектов, футер, тематические страницы — сильная сторона.
- 301-поглощение тредов Telegram и legacy-редиректы с canonical — корректная стратегия.

## 7. Фундамент i18n (EN-страницы под /en/)

Сегодня: `lang="ru"` (Base.astro:103), `og:locale ru_RU` (128), `inLanguage: "ru-RU"` в 5 местах, i18n в astro.config.mjs отсутствует. План:

1. `astro.config.mjs`: `i18n: { defaultLocale: "ru", locales: ["ru", "en"], routing: { prefixDefaultLocale: false } }` — RU без префикса, EN в `/en/…`.
2. Base.astro: `lang`/`og:locale`/`inLanguage` — пропами с дефолтом ru; на EN — `lang="en"`, `og:locale en_US`, `og:locale:alternate ru_RU`.
3. hreflang-пары: `<link rel="alternate" hreflang=…>` + `x-default` в Base.astro рядом с canonical; пока EN-страницы нет у пары — не добавлять ничего (частичные hreflang вредны).
4. sitemap.xml.ts: пары URL → `xhtml:link rel="alternate" hreflang…` внутри `<url>`.

## 8. Чек-лист перед прод-деплоем

- ✅ Trailing slash: `build.format: "directory"`, все внутренние ссылки со слешем — консистентно.
- ✅ Абсолютные URL: canonical/og/JSON-LD/sitemap от `Astro.site`; прод = `SITE_URL=https://staniverse.xyz`, BASE_PATH пустой.
- ✅ Yandex-верификация: `meta yandex-verification` из env.
- ❌ 404-страница отсутствует → P0-1; для Object Storage нужен физический `404.html` (error-document).
- ❌ RSS/Atom отсутствует → P1-6.
- ⚠️ При деплое в бакет: index-документ `index.html`, error-документ `404.html`; в прод-job передавать `SITE_URL=https://staniverse.xyz` (без BASE_PATH).

---

## Приоритизированный список исправлений

### P0 (до прод-деплоя)
| # | Проблема | Доказательство | Точное исправление |
|---|---|---|---|
| P0-1 | Нет страницы 404 | glob `src/pages/**/404*` — пусто | Создать `src/pages/404.astro` на `Base` (ссылки на /, /works/, /garden/, поиск). В хостинге бакета указать error-document `404.html` |
| P0-2 | `/contacts/` отсутствует в sitemap | sitemap.xml.ts:15–26 | Добавить `{ path: "/contacts/", modified: latest }` |

### P1 (первая итерация после деплоя)
| # | Проблема | Исправление |
|---|---|---|
| P1-1 | Нет BreadcrumbList и видимых крошек | `<nav aria-label>` в EntryPage + `breadcrumb` в JSON-LD; `jsonLd`-проп Base расширить до массива |
| P1-2 | Article/CreativeWork без `image` | `thumbnailUrl` либо секционная `/og/<segment>.png` через `new URL(…, Astro.site)` |
| P1-3 | Каталоги без CollectionPage+ItemList | Повторить паттерн videos/index.astro:22–51 для works/projects/garden/topics |
| P1-4 | og:image:width/height жёстко 1200×630 при сторонних 480×360 | В Base.astro: сторонний ogImage → 480×360, иначе 1200×630 |
| P1-5 | og:type=article без article:published_time/modified_time | Пропы `published/modified` + meta в Base.astro |
| P1-6 | Нет RSS/Atom | `src/pages/rss.xml.ts` по образцу sitemap; `<link rel="alternate">` в Base + упоминание в llms.txt |

### P2 (качество)
| # | Проблема | Исправление |
|---|---|---|
| P2-1 | Markdown-изображения без width/height/lazy | Rehype-плагин с sharp |
| P2-2 | Карусель/галерея без width/height | Добавить атрибуты |
| P2-3 | lastmod privacy захардкожен | Из frontmatter или `new Date()` |
| P2-4 | Имя владельца расходится (privacy vs Person) | Привести к одному публичному имени (E-E-A-T) |
| P2-5 | contacts/privacy/cv без секционной og-картинки | Добавить в генератор |
| P2-6 | `inLanguage` захардкожен в 5 местах | Единый проп локали (см. §7) |
| P2-7 | AI-боты не зафиксированы явно в robots | Опциональные явные `Allow`-блоки |
| P2-8 | Нет llms-full.txt | Опционально: генерация на postbuild |
