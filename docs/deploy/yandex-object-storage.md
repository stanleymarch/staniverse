# Деплой staniverse-site в Yandex Object Storage

Исследование: YandexDeployScout, 2026-09-18. Официальная документация Yandex Cloud; тарифы сверять на <https://yandex.cloud/ru/price-list>.

---

## 0. Итоговые решения (TL;DR)

| Вопрос | Решение |
|---|---|
| Хостинг основного сайта | Бакет `staniverse.xyz` + website hosting (`index.html` / `404.html`), публичное чтение объектов |
| Домен | CNAME/ANAME `staniverse.xyz → staniverse.xyz.website.yandexcloud.net` |
| HTTPS | Сертификат в бакет через Certificate Manager (managed Let's Encrypt, бесплатно). CDN — опционально |
| CI-аутентификация | Сервисный аккаунт + статический ключ; роль `storage.admin` для ACL/website-настроек (editor не хватает — проверено 2026-09-18) |
| Инструмент деплоя | SHA-256 manifest + `aws s3 cp` только изменившихся объектов; AWS CLI v2, endpoint `https://storage.yandexcloud.net` |
| Эксперименты | В тот же бакет, префикс `lab/<name>/`, тот же домен; workflow с paths-filter + matrix. **Не GitHub Pages** |
| Ориентир по стоимости | ~10–20 ₽/мес без CDN; ~150–165 ₽/мес с Cloud CDN |

## 1. Бакет и хостинг

Имя бакета **обязано совпадать с FQDN**: `staniverse.xyz` ([own-domain](https://yandex.cloud/ru/docs/storage/operations/hosting/own-domain)).

```bash
aws --endpoint-url=https://storage.yandexcloud.net s3 mb s3://staniverse.xyz --region ru-central1

cat > website.json <<'JSON'
{ "IndexDocument": { "Suffix": "index.html" }, "ErrorDocument": { "Key": "404.html" } }
JSON
aws --endpoint-url=https://storage.yandexcloud.net s3api put-bucket-website \
  --bucket staniverse.xyz --website-configuration file://website.json

# Публичное чтение без bucket policy
aws --endpoint-url=https://storage.yandexcloud.net s3api put-bucket-acl \
  --bucket staniverse.xyz --acl public-read
```

URL до привязки домена: `http(s)://staniverse.xyz.website.yandexcloud.net`.
Привязка: `staniverse.xyz CNAME staniverse.xyz.website.yandexcloud.net`. Apex → ANAME (Cloud DNS) или CNAME-flattening (Cloudflare) — голый CNAME на apex многие DNS не разрешают (RFC 1912).

## 2. HTTPS

**Вариант A (рекомендуется для старта, 0 ₽):** Certificate Manager → managed Let's Encrypt → привязать к бакету:

```bash
yc storage bucket set-https --name staniverse.xyz --certificate-id <certificate_ID>
```

HTTP→HTTPS редирект включается автоматически; сертификат подхватывается ~30 минут.

**Вариант B:** Cloud CDN перед бакетом — 150 ₽/ресурс·мес (150 ГБ трафика + 100 млн запросов включено), кеш/gzip/HTTP/3, инвалидация `yc cdn cache purge --resource-id <id> --path "/*"`.

**Вариант C (Cloudflare):** не рекомендую для RU-аудитории — нестабильные плечи, сторонняя зависимость.

## 3. CI-аутентификация

```bash
yc iam service-account create --name gh-deploy
yc resource-manager folder add-access-binding <folder_id> --role storage.admin --service-account-name gh-deploy
yc iam access-key create --service-account-name gh-deploy   # key_id + secret (показывается один раз)
```

GitHub **Secrets** (секретные значения):

- `YC_ACCESS_KEY_ID`;
- `YC_SECRET_ACCESS_KEY`;
- для CDN-purge — `YC_SA_KEY` (authorized key JSON).

GitHub **Variables** (публичная конфигурация):

- `YC_BUCKET=staniverse.xyz`;
- `YC_ENDPOINT=https://storage.yandexcloud.net`;
- `PUBLIC_YANDEX_METRIKA_ID=112792242`;
- `YANDEX_WEBMASTER_VERIFICATION` — код из Вебмастера, если выбран статический метатег;
- опционально для CDN — `YC_CDN_RESOURCE_ID` и `YC_FOLDER_ID`.

Проверку Вебмастера лучше делать статическим метатегом через
`YANDEX_WEBMASTER_VERIFICATION`, а не тегом YTM/GTM: Метрика на сайте
загружается только после явного согласия, поэтому робот Вебмастера не получит
динамический тег. Workflow проверяет обязательные значения и не начинает
production build с пустым или некорректным ID Метрики.

## 4. Workflow деплоя основного сайта

`.github/workflows/deploy-storage.yml` — полный YAML в репозитории. После
`npm ci`, тестов и production build workflow считает SHA-256 каждого объекта
`dist`, сравнивает с `.deploy-manifest.json` в бакете и:

1. загружает только реально изменившиеся файлы, четырьмя cache-профилями:
   HTML без кеша; `_astro` immutable на год; media на 30 дней; остальное на сутки;
2. удаляет ключи, исчезнувшие из нового manifest;
3. никогда не трогает независимые `/lab/<name>/`, но владеет `/lab/index.html`;
4. последним PUT публикует новый manifest — он всегда описывает уже применённый deploy;
5. purge CDN запускает только при изменившихся байтах.

При первом manifest-деплое workflow строит стартовое состояние из одного
`ListObjectsV2`, сверяя ETag/размер: сам переход не вызывает повторный PUT всего
бакета. Обычный новый пост загружает только изменившиеся страницы и индексы;
docs-only push при идентичной сборке делает **0 PUT**.

Env: `AWS_DEFAULT_REGION=ru-central1`, `AWS_EC2_METADATA_DISABLED=true`.

## 5. Эксперименты /lab

**Рекомендация: тот же бакет под `/lab/<name>/`, не GitHub Pages.** Причины: единый домен и TLS, один CDN, деплой синком в префикс из любого репозитория, и главное — независимость от доступности `github.io` из РФ (Roskomnadzor периодически ограничивает GitHub/Fastly). GitHub Pages — только как аварийная витрина.

Требование к сборке эксперимента: базовый путь = префикс (Vite `base: '/lab/<name>/'`), синк `experiments/<name>/dist/ → s3://bucket/lab/<name>/`. Workflow с `dorny/paths-filter` + matrix собирает только изменившиеся (`.github/workflows/lab.yml` в репозитории). URL: `https://staniverse.xyz/lab/<name>/`.

## 6. Yandex-грабли

1. Регион подписи **всегда** `ru-central1`; эндпоинт РФ — `https://storage.yandexcloud.net`. `--endpoint-url` обязателен, иначе CLI уйдёт в AWS.
2. `ru-central1-d` и прочие — зоны доступности Compute, НЕ эндпоинты Object Storage. Не подставлять в `--region`.
3. SigV4 (AWS CLI v2 делает сам).
4. Бакет с точкой в имени → wildcard-сертификат Object Storage домен не покрывает → нужен свой сертификат (см. §2).
5. Apex-домен: ANAME или CNAME-flattening.
6. Лимиты: 1 024 ГБ на облако, 25 бакетов, объект ≤ 5 ТБ, заголовки ≤ 8 КБ.
7. **404:** нужен физический `dist/404.html` (Astro генерирует из `src/pages/404.astro` даже при directory format) → указать его как `ErrorDocument`.
8. Directory format: `/garden/tg-1153/` → объект `garden/tg-1153/index.html`; URL без слэша → 302 на слэш.
9. MIME: CLI угадывает, но проверять `.webp`/`.mjs`/шрифты; при необходимости `--content-type`.
10. `s3 sync` сравнивает size+mtime и на fresh CI-чек-ауте перезаливает почти всё. `--size-only` небезопасен: изменение того же размера потеряется. Production workflow использует SHA-256 manifest и не зависит от mtime.
11. Публичный доступ обязателен, иначе 403.

## 7. Стоимость (< 5 ГБ, < 100 ГБ трафика/мес)

Без CDN: хранение ≈ 9,5 ₽ + первые 100 ГБ трафика и 100k GET бесплатно ≈
**10–15 ₽/мес**. С Cloud CDN: **150–165 ₽/мес** (пакет), сверх — 1,054 ₽/ГБ,
1 ₽/100k запросов.

PUT тарифицируются отдельно. Fresh build меняет mtime почти всех файлов, поэтому
`aws s3 sync` создавал тысячи лишних PUT. Manifest-деплой сравнивает SHA-256:
идентичная сборка делает 0 PUT, обычный новый пост загружает только реально
изменившиеся страницы и один новый manifest.

## 8. Чек-лист внедрения

1. Каталог/облако YC, платёжный аккаунт.
2. Бакет `staniverse.xyz` + website hosting + публичный ACL.
3. `src/pages/404.astro` в репо (иначе нет `dist/404.html`).
4. СА `gh-deploy` + `storage.admin` + статический ключ.
5. GitHub Secrets (§3).
6. `.github/workflows/deploy-storage.yml`, деплой, проверка `https://staniverse.xyz.website.yandexcloud.net`.
7. Домен CNAME/ANAME + managed Let's Encrypt + `yc storage bucket set-https`.
8. `experiments/**` + `.github/workflows/lab.yml`; base сборки = `/lab/<name>/`.
9. (Опц.) Cloud CDN + purge в workflow.

## 9. Защита от ботов, хотлинка и перерасхода

Повторное скачивание не увеличивает объём хранения; оно расходует исходящий
трафик и число GET-запросов. В текущем `public/media/telegram/` — около 668 МБ
видео (149 файлов), крупнейший файл — около 94 МБ. Страница использует
`preload="metadata"`, поэтому обычный просмотр не скачивает ролик целиком.

### 9.1. Бесплатный базовый контур

1. `public/robots.txt` разрешает AI-краулерам читать текстовые страницы, но
   запрещает `/media/`. Это снижает честный crawler-трафик, но не останавливает
   клиент, который игнорирует robots.txt.
2. Workflow отдаёт `/media/` с `Cache-Control: public, max-age=2592000,
   must-revalidate`: браузер и CDN не запрашивают один ролик повторно в течение
   30 дней.
3. Не применять bucket policy для Referer-фильтрации: проверенная production-
   конфигурация использует публичный ACL, а policy в Yandex Object Storage может
   перекрыть административный доступ к бакету. Если хотлинк станет измеримой
   проблемой, фильтровать `/media/*` на Cloudflare/Cloud CDN, не в бакете.

### 9.2. Контроль расходов

- Создать месячный бюджет Yandex Cloud с уведомлениями на 50%, 80% и 100%.
  Бюджет только уведомляет и сам не прекращает потребление.
- В Monitoring поставить алерт на исходящий трафик и GET-запросы бакета.
- Для автоматической аварийной отсечки нужен Budget Trigger → Cloud Function,
  которая временно закрывает публичный ACL бакета. Это отключит весь сайт,
  поэтому использовать только как аварийный рубильник.
- После первой недели смотреть реальные данные. Не ставить платный WAF «на
  всякий случай»: сначала кеширование, бюджет и алерты.

### 9.3. Усиленный вариант

Cloud CDN умеет защищённые токены: подписанная ссылка содержит срок действия и
опциональный IP. Это сильнее Referer, но для статического сайта потребует
серверной функции, которая выдаёт короткоживущую ссылку по клику. Включать
только если по метрикам видно систематическое скачивание: иначе сложность и
стоимость выше риска. Отдельный выигрыш без инфраструктуры — перекодировать
несколько крупнейших MP4; сначала файл на 94 МБ.

## 10. Приватный GitHub-репозиторий

Продакшен-деплой продолжит работать из private repo: `actions/checkout`, Secrets,
`deploy-storage.yml` и синк в Yandex Object Storage приватность репозитория не
меняют. На GitHub Free private Actions получают 2 000 runner-минут в месяц;
публичные стандартные runner-ы бесплатны. Текущая сборка занимает минуты, поэтому
лимита достаточно при обычном числе деплоев.

GitHub Pages из private repo на личном GitHub Free недоступен; он требует Pro
или выше, при этом сам Pages-сайт всё равно публичный. `pages.yml` поэтому
автоматически пропускается для private repo. Основной сайт и `/lab/` от Pages не
зависят: оба публикуются в Object Storage.
