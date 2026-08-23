import { test, expect } from "@playwright/test";

test("homepage presents identity, works, own projects and universe", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Соединяю/ })).toBeVisible();
  await expect(page.locator('.signal-strip a[href="/works/"]')).toBeVisible();
  await expect(page.locator('.signal-strip a[href="/projects/"]')).toBeVisible();
  await expect(page.getByRole("link", { name: /Войти во вселенную/ })).toBeVisible();
  await expect(page.getByText("То, что стало реальным")).toBeVisible();
  await expect(page.getByText("То, что продолжает двигаться")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("homepage.png"), fullPage: true });
});

test("works and own projects remain distinct and filterable", async ({ page }) => {
  await page.goto("/works/");
  await expect(page.getByRole("heading", { name: "Работы", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "xr", exact: true }).click();
  await expect(page.getByRole("link", { name: /MetaAdvokat/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Система сбора/ })).toBeHidden();
  await page.goto("/projects/");
  await expect(page.getByRole("heading", { name: "Собственные проекты" })).toBeVisible();
  await page.getByRole("button", { name: "На паузе" }).click();
  await expect(page.locator('[data-filter-grid] a[href="/projects/ya-ty-gorod/"]')).toBeVisible();
  await expect(page.locator('[data-filter-grid] a[href="/projects/albina/"]')).toBeHidden();
});

test("garden searches across publication formats", async ({ page }) => {
  await page.goto("/garden/");
  await page.getByRole("searchbox").fill("компаньон");
  await expect(page.locator('[data-filter-grid] a[href="/articles/ai-waifu/"]')).toBeVisible();
  await expect(page.locator('[data-filter-grid] a[href="/garden/youtube-cultural-travel/"]')).toBeHidden();
});

test("content page has compact local graph with universe handoff", async ({ page }) => {
  await page.goto("/projects/albina/");
  const graph = page.getByRole("complementary", { name: /Что связано/ });
  await expect(graph).toBeVisible();
  await expect(graph.locator('a[href="/articles/ai-waifu/"]')).toBeVisible();
  await expect(graph.getByRole("link", { name: /Открыть во вселенной/ })).toHaveAttribute("href", /focus=project%3Aalbina/);
});

test("fullscreen universe is separate, interactive and sound is opt-in", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/universe/");
  await expect(page.locator("canvas.universe-canvas")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Летай между идеями" })).toBeVisible();
  const sound = page.locator("[data-sound]");
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  await sound.click();
  await expect(sound).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: testInfo.outputPath("universe.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("layout has no horizontal overflow", async ({ page }) => {
  for (const path of ["/", "/works/", "/projects/albina/", "/garden/", "/universe/"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} horizontal overflow`).toBeLessThanOrEqual(1);
  }
});
