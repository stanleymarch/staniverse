import { test, expect } from "@playwright/test";

test("site search finds a tagged publication and opens it", async ({ page }) => {
  await page.goto("/");
  await page.click("[data-search-open]");
  const input = page.locator("[data-search-input]");
  await expect(input).toBeFocused();
  await input.fill("теледильдоника");
  const results = page.locator("[data-search-results] a");
  await expect(results.first()).toBeVisible({ timeout: 10_000 });
  await expect(results.first()).toContainText("IoT", { ignoreCase: true });
  const href = await results.first().getAttribute("href");
  expect(href).toContain("/garden/telegram/");
  await results.first().click();
  await expect(page).toHaveURL(new RegExp(href ?? "/garden/"));
  await expect(page.locator("[data-search-panel]")).toBeHidden();
});

test("search overlay supports keyboard open, escape close and empty state", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+KeyK");
  const panel = page.locator("[data-search-panel]");
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await page.click("[data-search-open]");
  await page.fill("[data-search-input]", "zzzzнеттакойстраницы");
  await expect(page.locator("[data-search-status]")).toContainText("Ничего не найдено", { timeout: 10_000 });
});
