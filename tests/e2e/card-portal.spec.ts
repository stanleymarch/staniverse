import { expect, test, type Page } from "@playwright/test";

/**
 * `/card/` is the QR entry point, so it must work as a plain page first: the
 * landing is reachable without any camera, the AR runtime stays unfetched until
 * the visitor asks for it, and a denied camera degrades to the ordinary links
 * instead of a dead end. What is verifiable here is the DOM contract; image
 * tracking itself needs a physical card and is covered by the manual checklist.
 */
const portal = "[data-card-portal]";

async function denyCamera(page: Page) {
  await page.context().grantPermissions([], {});
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: () => Promise.reject(new DOMException("Permission denied", "NotAllowedError")),
      configurable: true,
    });
  });
}

test.describe("card portal page", () => {
  test("landing renders the portal entry and the ordinary contact links without any camera", async ({ page }) => {
    await denyCamera(page);
    await page.goto("/card/");

    await expect(page.locator(`${portal}[data-state="idle"]`)).toBeVisible();
    await expect(page.getByRole("heading", { name: /STANIVERSE/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Открыть портал" })).toBeEnabled();

    const fallback = page.locator(".card-fallback");
    await expect(fallback.getByRole("link", { name: "Telegram-канал" })).toHaveAttribute("href", "https://t.me/staniverse");
    await expect(fallback.getByRole("link", { name: "Написать в Telegram" })).toHaveAttribute("href", "https://t.me/stanleymarch");
    await expect(fallback.getByRole("link", { name: "stas@staniverse.xyz" })).toHaveAttribute("href", "mailto:stas@staniverse.xyz");
    await expect(page.getByRole("link", { name: "XR-карта" }).first()).toHaveAttribute("href", "/universe/");
  });

  test("a denied camera shows the recovery state, and every way out stays usable", async ({ page }) => {
    await denyCamera(page);
    await page.goto("/card/");
    await page.getByRole("button", { name: "Открыть портал" }).click();

    await expect(page.locator(`${portal}[data-state="error"]`)).toBeVisible();
    await expect(page.getByText("Камера не включена")).toBeVisible();
    await expect(page.getByRole("button", { name: "Попробовать снова" })).toBeEnabled();
    await expect(page.getByRole("link", { name: "Перейти на staniverse.xyz" })).toHaveAttribute("href", "/");
    await expect(page.getByRole("link", { name: "Открыть XR-карту" })).toHaveAttribute("href", "/universe/");
  });

  test("no camera is requested before the visitor opens the portal", async ({ page }) => {
    await page.addInitScript(() => {
      const camera = window as Window & { __cameraAsked?: boolean };
      camera.__cameraAsked = false;
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: () => { camera.__cameraAsked = true; return Promise.reject(new DOMException("Permission denied", "NotAllowedError")); },
        configurable: true,
      });
    });
    await page.goto("/card/");
    await expect(page.locator(`${portal}[data-state="idle"]`)).toBeVisible();

    expect(await page.evaluate(() => (window as Window & { __cameraAsked?: boolean }).__cameraAsked)).toBe(false);
  });
});
