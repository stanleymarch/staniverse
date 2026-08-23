import { test, expect } from "@playwright/test";

test("homepage presents identity, works, own projects and universe", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Создаю цифровые/ })).toBeVisible();
  await expect(page.locator('.hero-actions a[href="/works/"]')).toBeVisible();
  await expect(page.locator('.hero-actions a[href="/projects/"]')).toBeVisible();
  await expect(page.getByRole("link", { name: /Войти во Вселенную/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Внешние задачи/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Собственные проекты/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("homepage.png"), fullPage: true });
});

test("works and own projects remain distinct and filterable", async ({ page }) => {
  await page.goto("/works/");
  await expect(page.getByRole("heading", { name: "Работы", exact: true })).toBeVisible();
  await expect(page.locator("[data-filter-grid] .content-card")).toHaveCount(10);
  await expect(page.locator('[data-filter-grid] a[href="/works/prodakshn-dlya-staniverse/"]')).toHaveCount(0);
  await page.getByRole("button", { name: "xr", exact: true }).click();
  await expect(page.getByRole("link", { name: /Виртуальный офис адвоката/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Система сбора/ })).toBeHidden();
  await page.goto("/projects/");
  await expect(page.getByRole("heading", { name: "Собственные проекты" })).toBeVisible();
  await expect(page.locator("[data-project-status]")).toHaveCount(9);
  await expect(page.locator('[data-project-status] a[href="/projects/nearventure/"]')).toBeVisible();
  await page.getByRole("button", { name: "Архив" }).click();
  await expect(page.locator('[data-filter-grid] a[href="/projects/ya-ty-gorod/"]')).toBeVisible();
  await expect(page.locator('[data-filter-grid] a[href="/projects/albina/"]')).toBeHidden();
});

test("migrated commissioned work keeps role, client, features and full narrative", async ({ page }) => {
  await page.goto("/works/virtualnyy-ofis-advokata/");
  await expect(page.getByText(/Работа.*Завершена/)).toBeVisible();
  await expect(page.getByText("Что сделано лично")).toBeVisible();
  await expect(page.getByText("Антон Окулов", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Контекст" })).toBeVisible();
  await expect(page.locator(".local-graph")).toBeVisible();
});

test("garden searches across publication formats", async ({ page }) => {
  await page.goto("/garden/");
  await expect(page.getByRole("button", { name: "Каталог" })).toBeVisible();
  if (test.info().project.name === "mobile") await page.getByRole("button", { name: "Фильтры" }).click();
  await expect(page.getByText("Тип материала")).toBeVisible();
  await page.getByRole("searchbox").fill("виртуальных помощников");
  await expect(page.locator('.garden-row[href="/articles/ai-waifu/"]')).toBeVisible();
  await expect(page.locator('[href="/garden/youtube-cultural-travel/"]')).toHaveCount(0);
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

test("automatic topics are browsable and connect different content formats",async({page})=>{
  await page.goto("/topics/");
  await expect(page.getByRole("heading",{name:"Темы",exact:true})).toBeVisible();
  const topic=page.getByRole("link",{name:/искусственный интеллект/}).first();
  await expect(topic).toBeVisible();
  await topic.click();
  await expect(page.getByRole("heading",{name:"#искусственный интеллект"})).toBeVisible();
  await expect(page.locator(".content-card").first()).toBeVisible();
});

test("long article keeps connected video pending until channel verification", async ({ page }) => {
  await page.goto("/articles/ai-waifu/");
  await expect(page.getByRole("heading", { name: "Оглавление" })).toBeVisible();
  await expect(page.locator(".prose").getByText(/браки заключаются на небесах/)).toBeVisible();
  await expect(page.locator(".local-graph").getByText(/Видеоверсия/).first()).toBeVisible();
  await page.goto("/garden/video/youtube-ncq31xb3gle/");
  await expect(page.locator(".video-stage iframe")).toHaveAttribute("src", /youtube\.com\/embed\/ncQ31xB3GLE/);
  await expect(page.getByText("Авторство ожидает проверки", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Открыть оригинал/ })).toHaveAttribute("href", "https://youtu.be/ncQ31xB3GLE");
});

test("Telegram Article preserves structured text, media and project causality", async ({ page }) => {
  await page.goto("/garden/telegram/tg-1115/");
  await expect(page.getByText("Telegram-статья")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Приключение на час, туда и обратно" })).toBeVisible();
  await expect(page.locator(".prose img")).toHaveCount(8);
  await expect(page.locator('.local-graph a[href="/projects/nearventure/"]').first()).toBeVisible();
});

test("about and footer expose both media ecosystems", async ({ page }) => {
  await page.goto("/about/");
  for (const href of ["https://t.me/staniverse", "https://vk.com/staniverse", "https://www.youtube.com/@staniverse", "https://vk.com/yatygorod", "https://www.youtube.com/@yatygorod"]) {
    await expect(page.locator(`a[href="${href}"]`).first()).toBeVisible();
  }
});

test("manifesto lives inside the canonical about page", async ({ page }) => {
  await page.goto("/manifesto/");
  await expect(page).toHaveURL(/\/about\/#manifesto$/);
  await expect(page.locator("#manifesto")).toBeVisible();
});

test("content page has compact local graph with universe handoff", async ({ page }) => {
  await page.goto("/projects/albina/");
  const graph = page.locator(".local-graph");
  await expect(graph).toBeVisible();
  await expect(graph.locator('a[href="/articles/ai-waifu/"]').first()).toBeVisible();
  await expect(graph.getByRole("link", { name: /Открыть во Вселенной/ })).toHaveAttribute("href", /focus=project%3Aalbina/);
});

test("fullscreen universe is separate, interactive and sound is opt-in", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/universe/");
  await expect(page.locator("canvas.universe-canvas")).toBeVisible();
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
  if (testInfo.project.name === "desktop") {
    const search = page.locator("[data-node-search]");
    await search.fill("Nearventure");
    await search.press("Enter");
    await expect(page.locator("[data-node-title]")).toHaveText("Nearventure");
  }
});

test("legacy portfolio links preserve canonical works", async ({ page }) => {
  await page.goto("/works/cases/virtualnyy-ofis-advokata/");
  await expect(page).toHaveURL(/\/works\/virtualnyy-ofis-advokata\/$/);
  await expect(page.getByRole("heading", { name: "Виртуальный офис адвоката" })).toBeVisible();
});

test("layout has no horizontal overflow", async ({ page }) => {
  for (const path of ["/", "/works/", "/projects/albina/", "/garden/", "/universe/"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} horizontal overflow`).toBeLessThanOrEqual(1);
  }
});
