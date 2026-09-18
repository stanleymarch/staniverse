# Production cutover: staniverse.xyz

Пошаговая инструкция владельцу репозитория по развёртыванию Staniverse в Yandex Object Storage, настройке GitHub Actions, DNS, TLS, Метрики, `404.html` и финальной проверке WebXR.

Дополнительные технические детали, политики кеширования и защита media описаны в [`yandex-object-storage.md`](./yandex-object-storage.md).

## 1. Текущее состояние

Код и локальная production-сборка готовы к деплою. Удалённые ресурсы Yandex Cloud, GitHub Secrets/Variables, сертификат и DNS этим репозиторием автоматически не создаются.

Проверено перед cutover:

- `npm run check`: 0 errors, 0 warnings;
- unit tests: 140 passed, 0 failed;
- production build: 2007 страниц и 10 OG-изображений;
- `dist/index.html` существует;
- `dist/404.html` существует;
- IWER 2.4.0 WebXR: 4 passed, 2 mobile-VR tests намеренно skipped;
- VR: повторный вход/выход, полёт, snap-turn, squeeze, hand pinch и in-scene panel;
- AR: поиск/потеря поверхности, placement, scale, rotate, relocate/cancel и tracking recovery;
- чистые stereo-кадры проверены: крупного объекта или glow только в одном глазу нет;
- AR требует `hit-test` и `dom-overlay`, поэтому неподдерживаемый браузер не запускает неуправляемую сессию.

Ограничение: физические Quest и Android ARCore не подключались. IWER не заменяет проверку камеры, разрешений, touch по DOM Overlay, реальных контроллеров и производительности устройства.

## 2. Ответственность

GitHub Secrets и Variables вводит владелец или администратор репозитория:

`Repository → Settings → Secrets and variables → Actions`

Секреты нельзя коммитить, добавлять в `.env.example`, issue, Actions logs или переписку.

## 3. Не менять DNS до проверки бакета

До успешного первого деплоя:

1. Сохранить действующие DNS-записи и TTL.
2. Не удалять старый GitLab Pages.
3. Не удалять старый сертификат и custom-domain configuration.
4. Подготовить Yandex Object Storage параллельно старому production.

`.gitlab-ci.yml` оставлен как временный rollback. Его нужно отключить только после успешного DNS-cutover и периода наблюдения.

## 4. Создать сервисный аккаунт Yandex Cloud

Нужны активные cloud/folder и платёжный аккаунт.

```bash
yc iam service-account create --name gh-deploy

yc resource-manager folder add-access-binding <folder_id> \
  --role storage.admin \
  --service-account-name gh-deploy

yc iam access-key create --service-account-name gh-deploy
```

Роль `storage.admin`, а не `storage.editor`: управление bucket policy
(публичное чтение) в Yandex Object Storage требует именно `admin` —
подтверждено на деплое 2026-09-18.

Последняя команда выводит:

- `key_id` → GitHub Secret `YC_ACCESS_KEY_ID`;
- `secret` → GitHub Secret `YC_SECRET_ACCESS_KEY`.

`secret` показывается один раз.

## 5. Создать бакет

Имя бакета должно совпадать с production FQDN:

```bash
aws --endpoint-url=https://storage.yandexcloud.net \
  s3 mb s3://staniverse.xyz \
  --region ru-central1
```

Обязательные значения:

- signature region: `ru-central1`;
- endpoint: `https://storage.yandexcloud.net`;
- `ru-central1-d` и другие availability zones здесь не используются.

## 6. Настроить website hosting и `404.html`

Создать `website.json`:

```json
{
  "IndexDocument": {
    "Suffix": "index.html"
  },
  "ErrorDocument": {
    "Key": "404.html"
  }
}
```

Применить:

```bash
aws --endpoint-url=https://storage.yandexcloud.net \
  s3api put-bucket-website \
  --bucket staniverse.xyz \
  --website-configuration file://website.json
```

Проверить:

```bash
aws --endpoint-url=https://storage.yandexcloud.net \
  s3api get-bucket-website \
  --bucket staniverse.xyz
```

Ожидается:

- `IndexDocument.Suffix = index.html`;
- `ErrorDocument.Key = 404.html`.

Репозиторий уже содержит:

- `src/pages/404.astro`;
- production artifact `dist/404.html`;
- проверку `dist/404.html` в `deploy-storage.yml`;
- загрузку `404.html` в корень бакета с `Cache-Control: public, max-age=0, must-revalidate`.

## 7. Разрешить публичное чтение объектов

Создать `public-read.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicRead",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::staniverse.xyz/*"
    }
  ]
}
```

Применить:

```bash
aws --endpoint-url=https://storage.yandexcloud.net \
  s3api put-bucket-policy \
  --bucket staniverse.xyz \
  --policy file://public-read.json
```

Политика разрешает чтение объектов, но не обязана разрешать публичный listing бакета. Без `s3:GetObject` website endpoint вернёт `403`.

## 8. Создать GitHub Secrets

Вкладка `Secrets`:

| Имя | Значение |
|---|---|
| `YC_ACCESS_KEY_ID` | `key_id` статического access key |
| `YC_SECRET_ACCESS_KEY` | секрет статического access key |
| `YC_SA_KEY` | только для опционального Cloud CDN purge; authorized-key JSON |

`YC_ACCESS_KEY_ID` хранится как Secret, потому что workflow использует его как часть пары credentials.

## 9. Создать GitHub Variables

Вкладка `Variables`:

| Имя | Значение |
|---|---|
| `YC_BUCKET` | `staniverse.xyz` |
| `YC_ENDPOINT` | `https://storage.yandexcloud.net` |
| `PUBLIC_YANDEX_METRIKA_ID` | `112792242` |
| `YANDEX_WEBMASTER_VERIFICATION` | опциональный content-токен из meta-тега Webmaster |
| `YC_CDN_RESOURCE_ID` | только если используется Cloud CDN |
| `YC_FOLDER_ID` | только если используется Cloud CDN purge |

`PUBLIC_YANDEX_METRIKA_ID` не является секретом: ID счётчика виден в клиентском JavaScript. Пустое значение отключает Метрику и consent banner.

`SITE_URL` создавать не нужно: production workflow задаёт `https://staniverse.xyz`.

Если CDN не используется, не создавать `YC_SA_KEY`, `YC_CDN_RESOURCE_ID` и `YC_FOLDER_ID`.

## 10. Настроить Yandex Webmaster

1. Добавить `https://staniverse.xyz` в Yandex Webmaster.
2. Выбрать подтверждение статическим meta-тегом.
3. Скопировать только значение `content`, а не весь `<meta>`.
4. Записать значение в GitHub Variable `YANDEX_WEBMASTER_VERIFICATION`.
5. Выполнить новый production deploy.
6. После публикации нажать проверку в Webmaster.

Не использовать динамическую Метрику для подтверждения: она загружается только после согласия пользователя, и робот может не получить тег.

## 11. Первый production deploy

Workflow:

```text
.github/workflows/deploy-storage.yml
```

Запускается:

- автоматически при push в `master`;
- вручную через `GitHub → Actions → Deploy to Yandex Object Storage → Run workflow`.

До запуска должны существовать бакет, обязательные Secrets и Variables.

Workflow выполняет:

1. checkout;
2. Node 24 setup;
3. `npm ci`;
4. проверку credentials, endpoint, bucket и числового ID Метрики;
5. unit tests;
6. production build;
7. проверку `dist/index.html` и `dist/404.html`;
8. sync HTML;
9. sync hashed `_astro` assets;
10. sync media;
11. sync остальной статики;
12. опциональный CDN purge.

Cache policy:

- HTML и `404.html`: `max-age=0, must-revalidate`;
- `_astro`: `max-age=31536000, immutable`;
- media: 30 дней;
- остальная статика: сутки;
- `/lab/<name>/` не удаляется production-sync.

## 12. Проверить бакет до DNS-cutover

Технический website endpoint:

```text
http://staniverse.xyz.website.yandexcloud.net
```

До установки собственного сертификата HTTPS для bucket hostname с точкой может не пройти wildcard-проверку. Не использовать `curl -k` как production-решение.

Проверить маршруты:

- `/`;
- `/works/`;
- `/projects/`;
- `/garden/`;
- `/en/`;
- `/privacy/`;
- `/manifesto/`;
- `/lab/`;
- `/lab/hello-lab/`;
- `/robots.txt`;
- `/sitemap-index.xml`;
- `/rss.xml`;
- изображения, шрифты и видео.

Проверить объект `404.html`:

```bash
aws --endpoint-url=https://storage.yandexcloud.net \
  s3api head-object \
  --bucket staniverse.xyz \
  --key 404.html
```

Проверить custom error document:

```bash
curl -i \
  "http://staniverse.xyz.website.yandexcloud.net/__staniverse-404-check__"
```

Ожидается:

- HTTP status `404`;
- HTML собственной страницы Staniverse;
- не XML `NoSuchKey`;
- правильный `Content-Type`.

## 13. Выпустить и привязать сертификат

В Certificate Manager:

1. Выпустить managed certificate для `staniverse.xyz`.
2. Выполнить DNS-подтверждение владения.
3. Дождаться состояния `Issued`.
4. Привязать сертификат к бакету:

```bash
yc storage bucket set-https \
  --name staniverse.xyz \
  --certificate-id <certificate_ID>
```

Статус в консоли не заменяет проверку реального TLS handshake после DNS-cutover.

## 14. Переключить DNS

Целевой website hostname:

```text
staniverse.xyz.website.yandexcloud.net
```

Для apex-домена использовать поддерживаемый DNS-провайдером механизм:

- ANAME/ALIAS;
- CNAME flattening;
- эквивалентную запись Yandex Cloud DNS.

Обычный CNAME на apex поддерживается не всеми DNS-провайдерами.

Безопасный порядок:

1. Сохранить старые DNS-записи.
2. Заранее снизить TTL.
3. Проверить, что бакет заполнен.
4. Проверить, что сертификат выпущен и привязан.
5. Переключить DNS.
6. Не отключать GitLab Pages до истечения старого TTL.
7. Проверить новый production из нескольких сетей и устройств.

## 15. Проверки после cutover

```bash
curl -I https://staniverse.xyz/
curl -I https://staniverse.xyz/works/
curl -i https://staniverse.xyz/__staniverse-404-check__
```

Дополнительно проверить реальный hashed asset из `/_astro/`.

Ожидается:

- главная и существующие маршруты: `200`;
- случайный URL: `404` и собственная страница;
- HTML: `Cache-Control: public, max-age=0, must-revalidate`;
- hashed assets: `max-age=31536000, immutable`;
- валидный сертификат для `staniverse.xyz`;
- отсутствие mixed content;
- canonical, Open Graph, JSON-LD и sitemap указывают на `https://staniverse.xyz`.

## 16. Проверить Метрику и consent

1. Очистить localStorage/cookies сайта.
2. Открыть DevTools Network.
3. До согласия запросов Метрики быть не должно.
4. Разрешить аналитику.
5. Проверить загрузку счётчика `112792242`.
6. Проверить поступление визита в интерфейсе Метрики.
7. Сбросить согласие.
8. Выбрать отказ.
9. После reload скрипт Метрики загружаться не должен.

Webvisor отключён.

## 17. Физическая проверка VR

WebXR требует HTTPS. Проверять после сертификата и DNS-cutover.

URL для воспроизводимого сценария:

```text
https://staniverse.xyz/universe/?focus=project%3Ametavyatka
```

На Quest или другом целевом headset:

1. Нажать «Войти в VR» и принять permission prompt.
2. Проверить, что project panel читается обоими глазами и не двоится.
3. Проверить левый thumbstick — полёт.
4. Проверить правый thumbstick — один snap-turn на одно отклонение.
5. Проверить squeeze — панель скрывается и возвращается.
6. Проверить controller ray.
7. Переключиться на hand tracking и проверить pinch.
8. Проверить кнопки panel:
   - предыдущий сосед;
   - следующий сосед;
   - назад;
   - сброс;
   - звук;
   - открыть;
   - выход XR.
9. Три раза войти и выйти из VR.
10. Проверить отсутствие:
   - крупных объектов только в одном глазу;
   - белых квадратов и NaN-артефактов;
   - зависшей panel;
   - потери controllers;
   - неприемлемой просадки FPS.

## 18. Физическая проверка AR

На Android Chrome с ARCore:

1. Открыть `/universe/` по HTTPS.
2. Разрешить камеру.
3. Нажать «Войти в AR».
4. Если browser не поддерживает `hit-test + dom-overlay`, вход должен завершиться чистым отказом, а screen-3D остаться рабочим.
5. На поддерживаемом устройстве двигать камерой до обнаружения поверхности.
6. Нажать «Разместить».
7. Проверить реальные touch-нажатия:
   - увеличить;
   - уменьшить;
   - повернуть;
   - перенести;
   - отменить перенос;
   - повторно разместить.
8. Увести browser в background и вернуть.
9. Проверить смену ориентации экрана.
10. Убедиться, что камера остаётся видна, созвездие контрастно и нет общего белого пятна.

IWER проверяет WebXR protocol и state machine, но не доказывает физический touch по DOM Overlay конкретного устройства.

## 19. Деплой `/lab/`
Полная инструкция для monorepo и отдельных GitHub repositories:
[`lab-project-ci.md`](./lab-project-ci.md).


Схема адресации: путь `/lab/<slug>/` в том же бакете `staniverse.xyz`.
Поддомен `lab.staniverse.xyz` не используется — он потребовал бы второго
бакета, CNAME и wildcard-сертификата (обоснование и эскалация:
[`lab-project-ci.md`](./lab-project-ci.md), раздел 0).


```text
.github/workflows/lab.yml
```

Использует те же Secrets и Variables:

- `YC_ACCESS_KEY_ID`;
- `YC_SECRET_ACCESS_KEY`;
- `YC_BUCKET`;
- `YC_ENDPOINT`.

Сейчас paths-filter настроен только на:

```text
experiments/hello-lab/**
```

Для каждого нового эксперимента нужно добавить отдельный filter в `lab.yml`. Простого создания новой папки недостаточно.

Production workflow сохраняет `/lab/<name>/`, но обновляет `/lab/index.html`.

## 20. Rollback

Если после cutover найдена критическая проблема:

1. Вернуть прежние DNS-записи.
2. Дождаться TTL.
3. Использовать оставленный GitLab Pages как временный rollback.
4. Исправить Object Storage deployment.
5. Повторить cutover и проверки.

После нескольких суток стабильной работы:

1. Вернуть обычный DNS TTL.
2. Отключить или удалить старый GitLab Pages pipeline.
3. Удалить старую custom-domain binding в GitLab.
4. Сохранить короткое rollback-окно, если это требуется владельцу.
5. Настроить Yandex Cloud budget alerts.

## 21. Критерий завершения

Миграция завершена только когда одновременно выполнено всё:

- GitHub Actions deploy зелёный;
- production открывается по HTTPS;
- сертификат валиден;
- случайный URL возвращает custom `404.html` со status `404`;
- основные RU/EN routes, sitemap, RSS и media работают;
- Метрика подчиняется consent;
- Yandex Webmaster подтвердил сайт;
- VR проверен на физическом headset;
- AR touch и camera passthrough проверены на физическом Android ARCore;
- старый GitLab production отключён после rollback window.
