# CI для проектов `/lab/` в общем бакете Staniverse

Инструкция для самостоятельных приложений и экспериментов, которые должны публиковаться в тот же Yandex Object Storage bucket, что и основной сайт, но владеть только своим префиксом:

```text
https://staniverse.xyz/lab/<slug>/
```

Основной production bucket:

```text
s3://staniverse.xyz
```

## 0. Домен: путь `/lab/<slug>/`, не поддомен

Решение: один бакет `staniverse.xyz`, все опыты публикуются путём:

```text
https://staniverse.xyz/lab/<slug>/
```

Поддомен `lab.staniverse.xyz` не используется. В Yandex Object Storage для
подключения собственного домена имя бакета обязано совпадать с FQDN, поэтому
поддомен означал бы: второй бакет `lab.staniverse.xyz`, второй CNAME, отдельный
сертификат (`*.staniverse.xyz` не покрывает apex, основной сертификат не
покрывает поддомен), отдельную website/404-конфигурацию и дубль deploy-ключей.

Дополнительные аргументы против поддомена:

- разрешение камеры для AR выдаётся на origin: путь `/lab/…` наследует уже
  выданное разрешение `staniverse.xyz`, поддомен спрашивает заново;
- один деплой-конвейер, один набор Secrets/Variables;
- SEO-вес и аналитика не дробятся по поддоменам.

Цена общего origin: localStorage, cookies и service worker у основного сайта и
опытов общие. Правила для опыта:

- ключи хранения именовать `lab:<slug>:<key>`;
- service worker регистрировать только со scope `/lab/<slug>/`;
- не писать cookies на корень домена из опыта.

Эскалация на поддомен оправдана, только если опыту нужна настоящая изоляция
origin: своя авторизация, чужой/недоверенный код, агрессивный service worker.
Тогда по той же схеме `yandex-object-storage.md` создаётся бакет
`lab.staniverse.xyz`, но это отдельное осознанное решение, не дефолт.

### Схема имён, чтобы карточки не путались

Два независимых пространства имён с одинаковыми slug не конфликтуют:

| Что | Где живёт | Кто рендерит |
|---|---|---|
| Описание проекта (карточка-статья: текст, контекст, связи) | `/projects/<slug>/` | основной Astro-сайт, `src/content/projects/` |
| Сам опыт (интерактивное приложение) | `/lab/<slug>/` | standalone-сборка из `experiments/<slug>/` |
| Витрина лаборатории | `/lab/` | основной сайт, `src/data/experiments.ts` |

Пример: описание Метавятки — `/projects/metavyatka/`, интерактивный опыт (когда
появится) — `/lab/metavyatka/`. Со страницы описания ставится обычная ссылка на
опыт; карточка на `/lab/` рендерится автоматически из `experiments.ts`, где
`name` совпадает со slug и именем каталога. Никаких hardcoded карточек.

## 1. Главный инвариант безопасности

Каждый lab-проект владеет только одним префиксом:

```text
s3://staniverse.xyz/lab/<slug>/
```

Команда с `--delete` допустима только с полным project prefix:

```bash
aws s3 sync dist/ "s3://$YC_BUCKET/lab/$LAB_SLUG/" --delete
```

Запрещено запускать из lab workflow:

```bash
# НЕЛЬЗЯ: удалит или заменит объекты основного сайта и других lab-проектов.
aws s3 sync dist/ "s3://$YC_BUCKET/" --delete

# НЕЛЬЗЯ: один проект не должен владеть всем /lab/.
aws s3 sync dist/ "s3://$YC_BUCKET/lab/" --delete
```

Основной workflow Staniverse уже исключает `lab/*` из удаления. Он обновляет только каталог `/lab/index.html`, поэтому lab-приложения могут независимо публиковаться в своих префиксах.

## 2. Правила для `slug`

`slug` — постоянный уникальный идентификатор проекта в URL.

Требования:

- только lowercase ASCII;
- разрешены `a-z`, `0-9` и `-`;
- без пробелов и `_`;
- не использовать `index`, `assets`, `_astro`, `media`;
- не переиспользовать slug удалённого проекта без осознанной миграции;
- один slug принадлежит только одному workflow/repository.

Примеры:

```text
hello-lab
metavyatka
mnemoform
parametrick
```

URL проекта:

```text
https://staniverse.xyz/lab/metavyatka/
```

## 3. Контракт build output

Перед деплоем проект обязан создать директорию:

```text
dist/
```

Минимально обязательный файл:

```text
dist/index.html
```

CI должен завершаться ошибкой, если файла нет:

```bash
test -f dist/index.html
```

Все asset URL должны учитывать production prefix `/lab/<slug>/`.

## 4. Base path для популярных сборщиков

### Vite

```ts
import { defineConfig } from "vite";

export default defineConfig({
  base: "/lab/metavyatka/",
});
```

### Astro

```js
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://staniverse.xyz",
  base: "/lab/metavyatka",
  output: "static",
});
```

### Plain HTML

Предпочтительны относительные ссылки:

```html
<script type="module" src="./app.js"></script>
<link rel="stylesheet" href="./styles.css">
<img src="./assets/preview.webp" alt="">
```

Либо явно использовать полный prefix:

```html
<script type="module" src="/lab/metavyatka/app.js"></script>
```

Root-absolute путь вида `/assets/app.js` указывает на корень `staniverse.xyz`, а не на проект. Такой путь допустим только для намеренно общих ресурсов основного сайта.

## 5. Рекомендуемая схема: проект внутри основного репозитория

Структура:

```text
experiments/
  metavyatka/
    package.json
    src/
    dist/
```

Преимущества:

- Yandex credentials хранятся только в `stanleymarch/staniverse`;
- основной и lab workflows используют один bucket config;
- меньше repository secrets;
- основной deploy гарантированно не удаляет lab-префиксы;
- один список slug в `.github/workflows/lab.yml`.

Текущий workflow:

```text
.github/workflows/lab.yml
```

Сейчас автоматический filter настроен только на `hello-lab`. Для нового проекта нужно добавить filter:

```yaml
- uses: dorny/paths-filter@v3
  id: filter
  with:
    filters: |
      hello-lab: experiments/hello-lab/**
      metavyatka: experiments/metavyatka/**
      mnemoform: experiments/mnemoform/**
```

Имя filter становится `matrix.lab` и URL slug. Оно должно точно совпадать с именем директории.

Для обычного приложения workflow выполнит:

```bash
cd experiments/<slug>
npm ci
npm run build
```

и синхронизирует:

```text
experiments/<slug>/dist/ → s3://staniverse.xyz/lab/<slug>/
```

`hello-lab` — отдельный plain-HTML special case без build step. Не копировать этот special case для приложений с `package.json`.

## 6. Отдельный GitHub-репозиторий lab-проекта

Если проект живёт в отдельном repository, он может публиковаться в тот же bucket, но workflow должен содержать жёстко заданный уникальный `LAB_SLUG`.

Файл:

```text
.github/workflows/deploy-lab.yml
```

Шаблон:

```yaml
name: Deploy to staniverse.xyz/lab

on:
  push:
    branches: [master]
  workflow_dispatch:

concurrency:
  group: deploy-lab-metavyatka
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    env:
      LAB_SLUG: metavyatka
      YC_BUCKET: ${{ vars.YC_BUCKET }}
      YC_ENDPOINT: ${{ vars.YC_ENDPOINT }}
      AWS_ACCESS_KEY_ID: ${{ secrets.YC_ACCESS_KEY_ID }}
      AWS_SECRET_ACCESS_KEY: ${{ secrets.YC_SECRET_ACCESS_KEY }}
      AWS_DEFAULT_REGION: ru-central1
      AWS_EC2_METADATA_DISABLED: "true"

    steps:
      - name: Checkout
        uses: actions/checkout@v7

      - name: Set up Node
        uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm

      - name: Validate deployment configuration
        run: |
          test -n "$LAB_SLUG"
          test -n "$YC_BUCKET"
          test -n "$YC_ENDPOINT"
          test -n "$AWS_ACCESS_KEY_ID"
          test -n "$AWS_SECRET_ACCESS_KEY"
          [[ "$LAB_SLUG" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]

      - name: Install dependencies
        run: npm ci

      - name: Test
        run: npm test --if-present

      - name: Build
        env:
          BASE_PATH: /lab/${{ env.LAB_SLUG }}/
          SITE_URL: https://staniverse.xyz
        run: npm run build

      - name: Verify build output
        run: test -f dist/index.html

      - name: Deploy only this lab prefix
        run: |
          aws s3 sync dist/ "s3://$YC_BUCKET/lab/$LAB_SLUG/" \
            --delete \
            --endpoint-url "$YC_ENDPOINT" \
            --cache-control "public, max-age=0, must-revalidate" \
            --no-progress
```

Заменить во всём шаблоне:

```text
metavyatka → фактический уникальный slug проекта
```

`concurrency.group` тоже должен быть уникален для проекта.

Если default branch называется `main`, заменить:

```yaml
branches: [master]
```

на:

```yaml
branches: [main]
```

## 7. GitHub Variables и Secrets отдельного repository

В каждом отдельном repository открыть:

`Settings → Secrets and variables → Actions`

Variables:

| Имя | Значение |
|---|---|
| `YC_BUCKET` | `staniverse.xyz` |
| `YC_ENDPOINT` | `https://storage.yandexcloud.net` |

Secrets:

| Имя | Значение |
|---|---|
| `YC_ACCESS_KEY_ID` | access-key ID Yandex service account |
| `YC_SECRET_ACCESS_KEY` | secret статического access key |

Фиксированные variables можно создать через GitHub CLI из директории проекта:

```bash
gh variable set YC_BUCKET --body staniverse.xyz
gh variable set YC_ENDPOINT --body https://storage.yandexcloud.net
```

Секреты лучше вводить интерактивно, чтобы они не попадали в shell history:

```bash
gh secret set YC_ACCESS_KEY_ID
gh secret set YC_SECRET_ACCESS_KEY
```

Один общий статический key в нескольких repositories увеличивает blast radius: компрометация любого repository даёт credentials сервисного аккаунта. Предпочтительно использовать отдельный access key/service account для независимых или недоверенных проектов и регулярно ротировать ключи.

Даже при отдельном key безопасность удаления обеспечивается не самим `aws s3 sync`, а точным destination prefix. Проверять строку назначения при каждом изменении workflow.

## 8. Почему основной сайт не удалит lab

Production workflow основного сайта выполняет четыре независимых sync-pass:

1. HTML исключает `lab/*`, но обновляет `/lab/index.html`;
2. hashed assets синхронизируются только в `/_astro/`;
3. media синхронизируются только в `/media/`;
4. остальная статика исключает `lab/*`.

Следовательно, объект:

```text
s3://staniverse.xyz/lab/metavyatka/index.html
```

не входит в область удаления основного workflow.

Обратное правило тоже обязательно: lab workflow не должен писать за пределами собственного `/lab/<slug>/`.

## 9. Проверка после deploy

Открыть:

```text
https://staniverse.xyz/lab/<slug>/
```

Проверить:

- `index.html` возвращает `200`;
- JS/CSS/fonts/images загружаются из `/lab/<slug>/...`;
- в Network нет `404` для assets;
- refresh страницы работает;
- canonical и Open Graph используют production URL, если проект их публикует;
- соседний lab-проект не изменился;
- основной `/`, `/works/`, `/projects/` не изменился.

Проверить объекты CLI:

```bash
aws --endpoint-url=https://storage.yandexcloud.net \
  s3 ls "s3://staniverse.xyz/lab/<slug>/" \
  --recursive
```

Проверить HTTP:

```bash
curl -I "https://staniverse.xyz/lab/<slug>/"
```

## 10. SPA routing

У bucket website hosting один глобальный error document — корневой `404.html`. Отдельный `404.html` для каждого `/lab/<slug>/` автоматически не выбирается.

Для SPA есть три безопасных варианта:

1. hash router: `/lab/<slug>/#/scene/42`;
2. генерировать реальные статические HTML routes;
3. использовать только entry URL `/lab/<slug>/` и хранить внутреннее состояние в query/hash.

History API route вида:

```text
/lab/<slug>/scene/42
```

при прямом открытии попадёт в общий root `404.html`, если файл `lab/<slug>/scene/42/index.html` не существует.

## 11. Обновление и удаление проекта

Обычный новый deploy использует `--delete` только внутри project prefix, поэтому удаляет старые assets этого проекта и не касается соседей.

Чтобы удалить проект полностью, выполнять отдельную осознанную команду с точным prefix:

```bash
aws --endpoint-url=https://storage.yandexcloud.net \
  s3 rm "s3://staniverse.xyz/lab/<slug>/" \
  --recursive
```

Перед выполнением дважды проверить `<slug>`. Не использовать переменную, которая может оказаться пустой.

После удаления:

1. удалить карточку/ссылку из `/lab/index.html` основного сайта;
2. удалить filter из центрального `lab.yml`, если проект был в monorepo;
3. отключить workflow отдельного repository;
4. удалить неиспользуемые project-specific credentials.

## 12. Checklist нового lab-проекта

- [ ] Выбран уникальный lowercase slug.
- [ ] Base path равен `/lab/<slug>/`.
- [ ] Build создаёт `dist/index.html`.
- [ ] Workflow пишет только в `s3://staniverse.xyz/lab/<slug>/`.
- [ ] `--delete` применяется только к этому prefix.
- [ ] Variables `YC_BUCKET` и `YC_ENDPOINT` настроены.
- [ ] Secrets Yandex настроены без placeholder-значений.
- [ ] В `concurrency.group` указан уникальный project slug.
- [ ] Для monorepo добавлен filter в `.github/workflows/lab.yml`.
- [ ] Прямой URL проекта возвращает `200`.
- [ ] Все assets загружаются из project prefix.
- [ ] Проверено, что соседние `/lab/` и основной сайт не изменились.
