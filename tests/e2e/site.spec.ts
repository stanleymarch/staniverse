import { test, expect } from "@playwright/test";

test("homepage presents identity, works, own projects and universe", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Всем 👋 привет, это Стас!" })).toBeVisible();
  await expect(page.locator(".hero-actions a")).toHaveCount(2);
  await expect(page.locator('.hero-actions a[href="/works/"]')).toBeVisible();
  await expect(page.locator('.hero-actions a[href^="mailto:"]')).toBeVisible();
  await expect(page.locator(".home-constellation")).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /То, что стало реальным/ })).toBeVisible();
  await expect(page.locator('.card-grid a[href="/works/virtualnyy-ofis-advokata/"]')).toHaveCount(1);
  await expect(page.locator('.card-grid a[href="/works/ya-obmanyvat-sebya-ne-stanu/"]')).toHaveCount(1);
  await expect(page.locator('.card-grid a[href="/works/arka-vyatskogo-kremlya/"]')).toHaveCount(1);
  await expect(page.getByRole("heading", { name: /То, что продолжает двигаться/ })).toBeVisible();
  await expect(page.locator('.card-grid a[href="/projects/loci/"]')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("homepage.png"), fullPage: true });
  await page.getByRole("button", { name: /Обо мне/ }).click();
  await expect(page.locator("[data-profile-dialog]").getByRole("heading", { name: /Проектирую цифровой опыт/ })).toBeVisible();
  await page.locator(".profile-details summary").click();
  await expect(page.getByText(/MB110x: Introduction to the Music Business/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("profile-dialog.png") });
});

test("work entries remain distinct from project records and filterable", async ({ page }) => {
  await page.goto("/works/");
  await expect(page.getByRole("heading", { name: "Работы", exact: true })).toBeVisible();
  await expect(page.locator('[data-filter-grid] a[href="/works/arka-vyatskogo-kremlya/"]')).toBeVisible();
  await expect(page.locator('[data-filter-grid] a[href="/works/chertezhi-tekhdiplomy/"]')).toBeVisible();
  await page.getByRole("button", { name: /^xr/ }).click();
  await expect(page.getByRole("link", { name: /Виртуальный офис адвоката/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Система сбора/ })).toBeHidden();
  await page.goto("/projects/");
  await expect(page.getByRole("heading", { name: "Собственные проекты" })).toBeVisible();
  await expect(page.locator("[data-project-status]")).toHaveCount(11);
  await expect(page.locator('[data-project-status] a[href="/projects/nearventure/"]')).toBeVisible();
  await page.getByRole("button", { name: "Архив" }).click();
  await expect(page.locator('[data-filter-grid] a[href="/projects/ya-ty-gorod/"]')).toBeVisible();
  await expect(page.locator('[data-filter-grid] a[href="/projects/albina/"]')).toBeVisible();
  await expect(page.locator('[data-filter-grid] a[href="/projects/loci/"]')).toBeHidden();
});

test("migrated commissioned work keeps role, client, features and full narrative", async ({ page }, testInfo) => {
  await page.goto("/works/virtualnyy-ofis-advokata/");
  await expect(page.getByText(/Работа.*Завершена/)).toBeVisible();
  await expect(page.getByText("Что сделано лично")).toBeVisible();
  await expect(page.getByText("Антон Окулов", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Контекст" })).toBeVisible();
  await expect(page.locator(".local-graph")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("work-detail.png"), fullPage: true });
});

test("garden searches across publication formats", async ({ page }) => {
  await page.goto("/garden/");
  await expect(page.getByRole("button", { name: "Список" })).toBeVisible();
  await page.getByRole("button", { name: "Ещё фильтры" }).click();
  await expect(page.locator("[data-garden-facets] legend").first()).toHaveText("Формат");
  await page.locator("[data-garden-search]").fill("виртуальных помощников");
  await expect(page.locator('.garden-row[href="/articles/ai-waifu/"]')).toBeVisible();
  await expect(page.locator('[href="/garden/youtube-cultural-travel/"]')).toHaveCount(0);
  await page.locator("[data-garden-search]").fill("интимейт");
  await expect(page.locator('.garden-row[href="/garden/telegram/tg-1153/"]')).toBeVisible();
  await page.locator("[data-garden-search]").fill("vtuber");
  await expect(page.locator('.garden-row[href="/garden/telegram/tg-1153/"]')).toBeVisible();
});

test("garden catalog includes projects and commissioned experience without mixing ownership", async ({ page }) => {
  await page.goto("/garden/");
  await page.getByRole("button", { name: "Ещё фильтры" }).click();
  await expect(page.locator('[data-kind-filter][value="project"]')).toBeVisible();
  await page.locator('label:has([data-kind-filter][value="project"])').click();
  await expect(page.locator('.garden-row[href="/projects/mnemoform/"]')).toBeVisible();
  await expect(page.locator('.garden-row[href="/works/virtualnyy-ofis-advokata/"]')).toHaveCount(0);
  await page.locator('label:has([data-kind-filter][value="project"])').click();
  await page.locator('label:has([data-kind-filter][value="work"])').click();
  await expect(page.locator('[data-topic-filter][value="iot"]')).toBeVisible();
  const commissionedRow = page.locator('.garden-row[href="/works/virtualnyy-ofis-advokata/"]');
  for (let expand = 0; !(await commissionedRow.count()) && expand < 4; expand += 1) {
    const more = page.locator("[data-garden-more]");
    await expect(more).toBeVisible();
    await more.click();
  }
  await expect(commissionedRow).toBeVisible();
  await expect(page.locator('.garden-row[href="/projects/mnemoform/"]')).toHaveCount(0);
});

test("garden exposes removable filter chips and persists filter state", async ({ page }) => {
  await page.goto("/garden/");
  await page.locator("[data-filter-toggle]").click();
  await page.locator('label:has([data-topic-filter][value="iot"])').click();
  await expect(page.locator(".garden-filter-chip")).toHaveCount(1);
  await expect(page).toHaveURL(/topic=iot/);
  await page.reload();
  await expect(page.locator('[data-topic-filter][value="iot"]')).toBeChecked();
  await page.locator(".garden-filter-chip").click();
  await expect(page.locator('[data-topic-filter][value="iot"]')).not.toBeChecked();
  await expect(page).not.toHaveURL(/topic=iot/);
});

test("garden map reflects the currently filtered catalogue", async ({ page }, testInfo) => {
  await page.goto("/garden/");
  await page.locator('[data-garden-mode="map"]').click();
  await expect(page.locator("[data-garden-map-svg]")).toBeVisible();
  await expect(page.locator(".garden-map-node").first()).toBeVisible();
  const initialNodes = await page.locator(".garden-map-node").count();
  await page.locator("[data-garden-search]").fill("виртуальных помощников");
  await expect.poll(() => page.locator(".garden-map-node").count()).toBeLessThan(initialNodes);
  expect(await page.locator(".garden-map-node").count()).toBeGreaterThan(0);
  expect(initialNodes).toBeGreaterThan(1);
  await page.screenshot({ path: testInfo.outputPath("garden-map.png"), fullPage: true });
});

test("multi-photo publication uses a working carousel and moves taxonomy below the text", async ({ page }) => {
  await page.goto("/garden/telegram/tg-1015/");
  await expect(page.locator("[data-carousel-slide]")).toHaveCount(4);
  await expect(page.locator("[data-carousel-status]")).toHaveText("1 / 4");
  await page.locator("[data-carousel-next]").click();
  await expect(page.locator("[data-carousel-status]")).toHaveText("2 / 4");
  const taxonomy = page.locator(".entry-taxonomy");
  await expect(taxonomy).toContainText("Теги автора");
  await expect(taxonomy).toContainText("Ещё по теме · найдено автоматически");
  await expect(taxonomy.locator('a[href="/topics/intim-i-blizost/"]')).toBeVisible();
});

test("topic index explains navigation and connects different content formats",async({page})=>{
  await page.goto("/topics/");
  await expect(page.getByRole("heading",{name:"По темам",exact:true})).toBeVisible();
  await expect(page.getByRole("link",{name:/Все материалы и фильтры в Саду/})).toHaveAttribute("href","/garden/");
  const topic=page.getByRole("link",{name:/искусственный интеллект/}).first();
  await expect(topic).toBeVisible();
  await topic.click();
  await expect(page.getByRole("heading",{name:"#искусственный интеллект"})).toBeVisible();
  await expect(page.locator(".content-card").first()).toBeVisible();
  await expect(page.locator("[data-topic-sort]")).toHaveValue("newest");
  const newestDates = await page.locator(".content-card time").evaluateAll((items) => items.map((item) => Date.parse(item.getAttribute("datetime") || "")).filter(Number.isFinite));
  expect(newestDates).toEqual([...newestDates].sort((a, b) => b - a));
  await page.locator("[data-topic-sort]").selectOption("oldest");
  await expect(page).toHaveURL(/sort=oldest/);
  const oldestDates = await page.locator(".content-card time").evaluateAll((items) => items.map((item) => Date.parse(item.getAttribute("datetime") || "")).filter(Number.isFinite));
  expect(oldestDates).toEqual([...oldestDates].sort((a, b) => a - b));
});

test("long article connects to a channel-verified video", async ({ page }) => {
  await page.goto("/articles/ai-waifu/");
  await expect(page.getByRole("heading", { name: "Оглавление" })).toBeVisible();
  await expect(page.locator(".prose").getByText(/браки заключаются на небесах/)).toBeVisible();
  await expect(page.locator(".entry-hero-meta time")).toBeVisible();
  await expect(page.locator('.local-graph a[href="/garden/video/youtube-ncq31xb3gle/"]').first()).toBeVisible();
  await page.goto("/garden/video/youtube-ncq31xb3gle/");
  await expect(page.locator("[data-video-play]")).toBeVisible();
  await page.click("[data-video-play]");
  await expect(page.locator(".video-stage iframe")).toHaveAttribute("src", /youtube\.com\/embed\/ncQ31xB3GLE\?autoplay=1/);
  await expect(page.getByText("Проверенное авторское видео", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Открыть оригинал/ })).toHaveAttribute("href", "https://www.youtube.com/watch?v=ncQ31xB3GLE");
  await expect(page.locator(".channel-gallery-grid a").first()).toBeVisible();
});

test("garden filters verified YouTube feeds by author channel", async ({ page }) => {
  await page.goto("/garden/");
  await page.getByRole("button", { name: "Ещё фильтры" }).click();
  await page.locator('label:has([data-channel-filter][value="ya-ty-gorod"])').click();
  await expect(page.locator('.garden-row.has-thumbnail').first()).toBeVisible();
  await expect(page.locator('.garden-row-meta').first()).toContainText("я.ты.город.");
});

test("garden exposes Gaussian Splatting and sorts in both date directions", async ({ page }) => {
  await page.goto("/garden/");
  await expect(page.locator('[data-garden-sort]')).toHaveValue("newest");
  await page.getByRole("button", { name: "Ещё фильтры" }).click();
  await expect(page.locator('[data-topic-filter][value="gaussian-splatting"]')).toBeVisible();
  await page.locator('label:has([data-topic-filter][value="gaussian-splatting"])').click();
  await expect(page.locator(".garden-filter-chip")).toContainText("Gaussian Splatting");
  await page.locator('[data-garden-sort]').selectOption("oldest");
  await expect(page).toHaveURL(/sort=oldest/);
  const dates = await page.locator(".garden-row-date").evaluateAll((items) => items.map((item) => Date.parse(item.getAttribute("datetime") || "")).filter(Number.isFinite));
  expect(dates).toEqual([...dates].sort((a, b) => a - b));
});

test("Telegram mixed-media threads preserve playable videos in order", async ({ page }) => {
  await page.goto("/garden/telegram/tg-839/");
  await expect(page.locator(".media-gallery img").first()).toBeVisible();
  await expect(page.locator(".media-gallery video").first()).toBeVisible();
  await expect(page.locator(".media-gallery video").first()).toHaveAttribute("src", /\/media\/telegram\/839-840-1\.mp4/);
});

test("Telegram Article preserves structured text, media and project causality", async ({ page }, testInfo) => {
  await page.goto("/garden/telegram/tg-1115/");
  await expect(page.getByText("Telegram-статья")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Приключение на час, туда и обратно" })).toBeVisible();
  await expect(page.locator(".prose img")).toHaveCount(8);
  await expect(page.locator('.local-graph a[href="/projects/nearventure/"]').first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("telegram-article.png"), fullPage: true });
  await page.goto("/garden/telegram/tg-1152/");
  const inlineCarousel = page.locator(".prose [data-media-carousel]").first();
  await expect(inlineCarousel).toBeVisible();
  await expect(inlineCarousel.locator("[data-carousel-status]")).toHaveText("1 / 5");
  await inlineCarousel.locator("[data-carousel-next]").click();
  await expect(inlineCarousel.locator("[data-carousel-status]")).toHaveText("2 / 5");
});

test("about and footer expose both media ecosystems", async ({ page }) => {
  await page.goto("/about/");
  for (const href of ["https://t.me/staniverse", "https://vk.com/staniverse", "https://www.youtube.com/@staniverse", "https://vk.com/yatygorod", "https://www.youtube.com/@yatygorod"]) {
    await expect(page.locator(`a[href="${href}"]`).first()).toBeVisible();
  }
});

test("manifesto has a canonical article route", async ({ page }) => {
  await page.goto("/manifesto/");
  await expect(page).toHaveURL(/\/articles\/manifesto\/$/);
  await expect(page.getByRole("heading", { name: /манифест/i })).toBeVisible();
});

test("support page preserves canonical public payment routes", async ({ page }, testInfo) => {
  await page.goto("/donate/");
  await expect(page.getByRole("heading", { name: "Поддержать" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Boosty/ })).toHaveAttribute("href", "https://boosty.to/staniverse");
  await expect(page.getByRole("link", { name: /CloudTips/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Ozon Банк/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("donate.png"), fullPage: true });
});

test("content page has compact local graph with universe handoff", async ({ page }) => {
  await page.goto("/projects/albina/");
  const graph = page.locator(".local-graph");
  await expect(graph).toBeVisible();
  /* Ring budgets 12 + 20 + 26 plus the current material. */
  expect(await graph.locator("[data-focus-node]").count()).toBeLessThanOrEqual(59);
  expect(await graph.locator("[data-relation-depth]").count()).toBeLessThanOrEqual(120);
  await expect(graph.locator('a[href="/articles/ai-waifu/"]').first()).toBeVisible();
  await expect(graph.getByRole("link", { name: /Открыть во Вселенной/ })).toHaveAttribute("href", /focus=project%3Aalbina/);
  const depthButtons = graph.locator("[data-depth-button]");
  if (await depthButtons.count() > 1) {
    const visibleAtOne = await graph.locator("[data-focus-node]:not([hidden])").count();
    await depthButtons.last().click();
    await expect.poll(() => graph.locator("[data-focus-node]:not([hidden])").count()).toBeGreaterThan(visibleAtOne);
  }
});

test("privacy page explains optional analytics and exposes the footer route", async ({ page }) => {
  await page.goto("/privacy/");
  await expect(page.getByRole("heading", { name: "Конфиденциальность" })).toBeVisible();
  await expect(page.getByText(/только после вашего явного согласия/)).toBeVisible();
  await expect(page.locator('a[href="/privacy/"]').last()).toBeVisible();
});

test("fullscreen universe is separate, interactive and sound is opt-in", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/universe/");
  await expect(page.locator("canvas.universe-canvas")).toBeVisible();
  await expect(page.locator("[data-flight-joystick]")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Летай между идеями" })).toBeVisible();
  await expect(page.locator("[data-xr-status]")).toContainText(/режим|устройстве/);
  const graph=await page.locator("[data-universe]").getAttribute("data-graph");
  expect(graph).toContain('"kind":"topic"');
  const sound = page.locator("[data-sound]");
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  await sound.click();
  await expect(sound).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: testInfo.outputPath("universe.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("universe supports keyboard navigation and reduced motion", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/universe/");
  await expect(page.locator("[data-universe]")).toHaveAttribute("data-motion", "reduced");
  const canvas = page.locator("canvas.universe-canvas");
  await canvas.focus();
  await expect(canvas).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Home");
  if (["wide", "desktop"].includes(testInfo.project.name)) {
    const search = page.locator("[data-node-search]");
    await search.fill("Nearventure");
    await search.press("Enter");
    await expect(page.locator("[data-node-title]")).toHaveText("Nearventure");
  }
});

test("legacy portfolio links preserve canonical works and projects", async ({ page }) => {
  await page.goto("/works/cases/virtualnyy-ofis-advokata/");
  await expect(page).toHaveURL(/\/works\/virtualnyy-ofis-advokata\/$/);
  await expect(page.getByRole("heading", { name: "Виртуальный офис адвоката" })).toBeVisible();
  await page.goto("/lab/metavyatka/");
  await expect(page).toHaveURL(/\/projects\/metavyatka\/$/);
  await expect(page.getByRole("heading", { name: "MetaVyatka" })).toBeVisible();
});

test("merged works redirect to the entity that absorbed them", async ({ page }) => {
  await page.goto("/works/cases/avtomaticheskiy-kanal-dlya-proekta-chertezhi/");
  await expect(page).toHaveURL(/\/works\/chertezhi-tekhdiplomy\/$/);
  await expect(page.getByRole("heading", { name: "Чертежи + Техдипломы" })).toBeVisible();
  await page.goto("/works/avtomaticheskiy-kanal-dlya-proekta-chertezhi/");
  await expect(page).toHaveURL(/\/works\/chertezhi-tekhdiplomy\/$/);
  await page.goto("/works/cases/prodakshn-dlya-staniverse/");
  await expect(page).toHaveURL(/\/projects\/staniverse\/$/);
  await page.goto("/works/prodakshn-dlya-staniverse/");
  await expect(page).toHaveURL(/\/projects\/staniverse\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "staniverse" })).toBeVisible();
  await page.goto("/works/cases/prodakshn-dlya-ya-ty-gorod/");
  await expect(page).toHaveURL(/\/projects\/ya-ty-gorod\/$/);
  await page.goto("/works/prodakshn-dlya-ya-ty-gorod/");
  await expect(page).toHaveURL(/\/projects\/ya-ty-gorod\/$/);
  await page.goto("/works/cases/sayt-proekta-ya-ty-gorod/");
  await expect(page).toHaveURL(/\/projects\/ya-ty-gorod\/$/);
  await page.goto("/works/sayt-proekta-ya-ty-gorod/");
  await expect(page).toHaveURL(/\/projects\/ya-ty-gorod\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "я.ты.город." })).toBeVisible();
});

test("layout has no horizontal overflow", async ({ page }) => {
  for (const path of ["/", "/works/", "/projects/albina/", "/garden/", "/donate/", "/universe/"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} horizontal overflow`).toBeLessThanOrEqual(1);
  }
});
