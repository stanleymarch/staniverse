import { expect, test, type Page } from "@playwright/test";

/**
 * The camera AR adapter is the iOS path: iOS WebKit exposes no `navigator.xr`, so
 * `immersive-ar` can never answer there and the 8th Wall engine binary is the
 * fallback. These checks cover what is verifiable without an iPhone: the entry
 * gate, the laziness of the binary (nothing is fetched until the tap), and the
 * honest degradation when the camera is unavailable — the visitor must land back
 * in the untouched screen experience, never in a broken session.
 */

const universe = "[data-universe]";
const engineUrl = "https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1.0.0/dist/xr.js";

/** Hides native WebXR the way iOS does: the property exists but never answers. */
async function withoutNativeXr(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "xr", { value: undefined, configurable: true });
  });
}

async function openUniverse(page: Page) {
  await page.goto("/universe/");
  await expect(page.locator(".universe-canvas")).toBeVisible();
  await expect(page.locator(`${universe}[data-experience-state="exploring"]`)).toBeVisible({ timeout: 30_000 });
}

test.describe("camera AR adapter gate and fallback", () => {
  test("a touch device without native WebXR is offered the camera path, and the engine stays unfetched until then", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "The coarse-pointer gate only opens in the mobile project.");
    const engineRequests: string[] = [];
    await page.route(engineUrl, (route) => route.abort());
    page.on("request", (request) => {
      if (request.url() === engineUrl) engineRequests.push(request.url());
    });
    await withoutNativeXr(page);
    await openUniverse(page);

    const cameraButton = page.getByRole("button", { name: "AR через камеру" });
    await expect(cameraButton).toBeVisible();
    await expect(page.getByRole("button", { name: "Войти в AR" })).toHaveCount(0);
    // The heavy half of the site never reaches a visitor who does not ask for it.
    expect(engineRequests).toEqual([]);

    await cameraButton.evaluate((button: HTMLButtonElement) => button.click());
    // The engine script is requested on the tap itself, not before and not by any other page load.
    await expect.poll(() => engineRequests.includes(engineUrl)).toBe(true);
    await expect(page.locator(`${universe}[data-xr]`)).toHaveAttribute("data-xr", /camera-ar|screen/);
  });

  test("a denied or missing camera returns the visitor to the screen experience with the button intact", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "The camera path only opens in the mobile project.");
    await page.route(engineUrl, (route) => route.fulfill({
      contentType: "application/javascript",
      body: `
        window.XR8 = {
          modules: [],
          addCameraPipelineModules(modules) { this.modules = modules; },
          loadChunk() { return Promise.resolve(); },
          run() {
            const world = this.modules.find((module) => module && module.name === "staniverse-constellation");
            queueMicrotask(() => world.onCameraStatus({status: "failed"}));
          },
          stop() {},
          GlTextureRenderer: {pipelineModule: () => ({name: "gl"})},
          Threejs: {pipelineModule: () => ({name: "three"})},
          XrController: {pipelineModule: () => ({name: "controller"})},
          XrConfig: {device: () => ({ANY: "any"})},
        };
        window.dispatchEvent(new Event("xrloaded"));
      `,
    }));
    await page.context().grantPermissions([]); // never grant camera
    await withoutNativeXr(page);
    await openUniverse(page);
    await page.getByRole("button", { name: "AR через камеру" }).evaluate((button: HTMLButtonElement) => button.click());

    // Either the engine reports the camera as failed, or it never gets that far in
    // headless Chromium: both must end in the screen mode, with the entry usable again.
    await expect.poll(
      () => page.locator(`${universe}`).getAttribute("data-xr"),
      { timeout: 60_000 },
    ).toBe("screen");
    await expect(page.getByRole("button", { name: "AR через камеру" })).toBeEnabled();
    await expect(page.locator(`${universe}[data-experience-state="exploring"]`)).toBeVisible();
    await expect(page.locator(`${universe}[data-xr="camera-ar"]`)).toHaveCount(0);
    // No leftover engine canvas: the screen canvas is the visible one again.
    await expect(page.locator(".camera-ar-canvas")).toHaveCount(0);
  });

  test("a device with native WebXR never sees the camera adapter", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Desktop Chromium exposes navigator.xr.");
    await openUniverse(page);
    await expect(page.getByRole("button", { name: "AR через камеру" })).toHaveCount(0);
  });
});
