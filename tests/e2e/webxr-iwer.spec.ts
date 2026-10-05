import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import type { Camera, Scene } from "three";
import type { UniverseWorld } from "../../src/components/universe/UniverseWorld";

interface XrPanelProbe {
  __staniverseXR: { scene: Scene; camera: Camera; world: UniverseWorld };
}

interface IwerRemote {
  dispatch(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

interface IwerSem {
  loadEnvironment(environment: unknown): void;
  deleteAll(): void;
}

interface IwerController {
  updateAxes(id: string, x: number, y: number): void;
  updateButtonValue(id: string, value: number): void;
}

interface IwerDevice {
  readonly version: string;
  readonly activeSession?: { readonly enabledFeatures: readonly string[]; end(): Promise<void> };
  readonly controllers: Partial<Record<"left" | "right", IwerController>>;
  readonly remote: IwerRemote;
  readonly sem?: IwerSem;
  stereoEnabled: boolean;
  ipd: number;
  fovy: number;
  updateVisibilityState(state: "visible" | "visible-blurred" | "hidden"): void;
}

declare global {
  interface Window {
    __staniverseIwer: IwerDevice;
  }
}

const runtimePath = resolve("node_modules/iwer/build/iwer.min.js");
const semPath = resolve("node_modules/@iwer/sem/build/iwer-sem.min.js");
const officeEnvironment = JSON.parse(readFileSync(resolve("node_modules/@iwer/sem/lib/captures/office_small.json"), "utf8")) as unknown;
const universe = "[data-universe]";

async function installOfficialIwer(page: Page) {
  await page.addInitScript({ path: runtimePath });
  await page.addInitScript({ path: semPath });
  await page.addInitScript(() => {
    interface RuntimeDevice extends IwerDevice {
      installRuntime(options?: { forceInstall?: boolean }): void;
      installSEM(sem: new (device: IwerDevice) => IwerSem): void;
    }
    const host = globalThis as typeof globalThis & {
      IWER: {
        XRDevice: new (config: unknown) => RuntimeDevice;
        metaQuest3: { supportedFeatures: string[] };
      };
      IWER_SEM: { SyntheticEnvironmentModule: new (device: IwerDevice) => IwerSem };
      __staniverseIwer: RuntimeDevice;
    };
    const device = new host.IWER.XRDevice({
      ...host.IWER.metaQuest3,
      supportedFeatures: [...host.IWER.metaQuest3.supportedFeatures, "dom-overlay"],
    });
    device.stereoEnabled = true;
    device.ipd = 0.063;
    device.fovy = Math.PI / 2;
    device.installSEM(host.IWER_SEM.SyntheticEnvironmentModule);
    device.installRuntime({ forceInstall: true });
    host.__staniverseIwer = device;
  });
}

async function openUniverse(page: Page, testInfo: TestInfo, projects: readonly string[] = ["desktop"]) {
  test.skip(!projects.includes(testInfo.project.name), `Official IWER protocol runs in ${projects.join(" and ")} Chromium.`);
  await installOfficialIwer(page);
  await page.goto("/universe/?focus=project%3Ametavyatka&xrDebug=1");
  await expect(page.locator(".universe-canvas")).toBeVisible();
  await expect(page.locator(`${universe}[data-xr="screen"]`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Войти в VR" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Войти в AR" })).toBeEnabled();
  expect(await page.evaluate(() => window.__staniverseIwer.version)).toBe("2.4.0");
  expect(await page.evaluate(() => ({
    stereoEnabled: window.__staniverseIwer.stereoEnabled,
    ipd: window.__staniverseIwer.ipd,
    fovy: window.__staniverseIwer.fovy,
  }))).toEqual({ stereoEnabled: true, ipd: 0.063, fovy: Math.PI / 2 });
}

async function clickXrButton(page: Page, name: string) {
  await page.getByRole("button", { name }).evaluate((button: HTMLButtonElement) => button.click());
}

async function endSession(page: Page) {
  await page.evaluate(async () => { await window.__staniverseIwer.activeSession?.end(); });
  await expect(page.locator(`${universe}[data-xr="screen"]`)).toBeVisible();
}
async function loadOfficeEnvironment(page: Page) {
  await page.evaluate((environment) => window.__staniverseIwer.sem?.loadEnvironment(environment), officeEnvironment);
}



test.describe("official IWER 2.4.0 WebXR protocol", () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(async () => { await window.__staniverseIwer?.activeSession?.end(); }).catch(() => undefined);
  });

  test("owns three repeatable VR entry and exit cycles", async ({ page }, testInfo) => {
    await openUniverse(page, testInfo);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await clickXrButton(page, "Войти в VR");
      await expect(page.locator(`${universe}[data-xr="vr"]`)).toBeVisible();
      await expect(page.locator(`${universe}[data-experience-state="exploring"]`)).toBeVisible();
      await expect.poll(() => page.evaluate(() => Boolean(window.__staniverseIwer.activeSession))).toBe(true);
      if (cycle === 0) await page.screenshot({ path: testInfo.outputPath("iwer-vr-entry.png") });
      await clickXrButton(page, "Выйти из VR");
      await expect(page.locator(`${universe}[data-xr="screen"]`)).toBeVisible();
      await expect.poll(() => page.evaluate(() => Boolean(window.__staniverseIwer.activeSession))).toBe(false);
    }
    await expect(page.locator(".xr-button")).toHaveCount(2);
  });

  test("maps controller flight, snap-turn latch, panel and hand-select without leaving the session", async ({ page }, testInfo) => {
    await openUniverse(page, testInfo);
    await clickXrButton(page, "Войти в VR");
    await expect(page.locator(`${universe}[data-xr="vr"]`)).toBeVisible();
    const root = page.locator(universe);
    await expect(root).toHaveAttribute("data-xr-rig", /-?\d+\.\d{4},-?\d+\.\d{4},-?\d+\.\d{4}/);
    await expect(root).toHaveAttribute("data-xr-panel", "true");
    await page.screenshot({ path: testInfo.outputPath("iwer-vr-panel.png") });

    const beforeFlight = await root.getAttribute("data-xr-rig");
    await page.evaluate(() => window.__staniverseIwer.controllers.left?.updateAxes("thumbstick", 0, -1));
    await page.waitForTimeout(550);
    await page.evaluate(() => window.__staniverseIwer.controllers.left?.updateAxes("thumbstick", 0, 0));
    await expect.poll(() => root.getAttribute("data-xr-rig")).not.toBe(beforeFlight);

    await page.evaluate(() => window.__staniverseIwer.controllers.right?.updateAxes("thumbstick", 1, 0));
    await expect.poll(() => root.getAttribute("data-xr-yaw")).not.toBe("0.0000");
    const firstTurn = await root.getAttribute("data-xr-yaw");
    await page.waitForTimeout(450);
    expect(await root.getAttribute("data-xr-yaw")).toBe(firstTurn);
    await page.evaluate(() => window.__staniverseIwer.controllers.right?.updateAxes("thumbstick", 0, 0));

    await page.evaluate(() => window.__staniverseIwer.controllers.right?.updateButtonValue("squeeze", 1));
    await page.waitForTimeout(100);
    await page.evaluate(() => window.__staniverseIwer.controllers.right?.updateButtonValue("squeeze", 0));
    await expect(root).toHaveAttribute("data-xr-panel", "false");
    await page.evaluate(() => window.__staniverseIwer.controllers.right?.updateButtonValue("squeeze", 1));
    await page.waitForTimeout(100);
    await page.evaluate(() => window.__staniverseIwer.controllers.right?.updateButtonValue("squeeze", 0));
    await expect(root).toHaveAttribute("data-xr-panel", "true");

    await page.evaluate(async () => {
      await window.__staniverseIwer.remote.dispatch("set_input_mode", { mode: "hand" });
      // The panel is the only in-scene action surface. Its bottom action row sits 1.2m in front of the
      // viewer (-0.212m of panel height), so this pinch can only land if the panel really is anchored
      // camera-relative: button 4 of the row is "reset".
      await window.__staniverseIwer.remote.dispatch("look_at", { device: "hand-right", target: { x: 0, y: 1.388, z: -1.2 } });
      // A pinch is a press and a release: the value is held until the frame loop has applied it,
      // because a press released inside the same frame never produces a select edge at all.
      await window.__staniverseIwer.remote.dispatch("set_select_value", { device: "hand-right", value: 1 });
    });
    await expect.poll(() => page.evaluate(() => window.__staniverseIwer.remote.dispatch("get_select_value", { device: "hand-right" }))).toMatchObject({ value: 1 });
    await expect.poll(() => page.locator("[data-announcer]").textContent()).toContain("Выбор закрыт");
    await expect(page.locator("[data-node-card]")).toBeHidden();
    await expect(page.locator(universe)).toHaveAttribute("data-xr", "vr");
    await expect.poll(() => page.evaluate(() => Boolean(window.__staniverseIwer.activeSession))).toBe(true);
    await page.evaluate(() => window.__staniverseIwer.remote.dispatch("set_select_value", { device: "hand-right", value: 0 }));
    await endSession(page);
  });

  test("recalls the dossier after flight and closes it with raycast-only buttons", async ({ page }, testInfo) => {
    await openUniverse(page, testInfo);
    await clickXrButton(page, "Войти в VR");
    const root = page.locator(universe);
    await expect(root).toHaveAttribute("data-xr-panel", "true");
    const beforeFlight = Number((await root.getAttribute("data-xr-rig"))!.split(",")[2]);
    await page.evaluate(() => window.__staniverseIwer.controllers.left!.updateAxes("thumbstick", 0, -1));
    await expect.poll(async () => Number((await root.getAttribute("data-xr-rig"))!.split(",")[2]), { timeout: 20_000 }).toBeLessThan(beforeFlight - 1);
    await page.evaluate(() => window.__staniverseIwer.controllers.left!.updateAxes("thumbstick", 0, 0));
    // Leave the old card open and select a different star through the actual XR trigger.
    await page.evaluate(async () => {
      const { camera, world } = (window as unknown as XrPanelProbe).__staniverseXR;
      const visual = world.visuals.get("work:arka-vyatskogo-kremlya")!;
      const point = camera.parent!.worldToLocal(world.root.localToWorld(visual.position.clone()));
      const target = { x: point.x, y: point.y, z: point.z };
      await window.__staniverseIwer.remote.dispatch("look_at", { device: "headset", target });
      await window.__staniverseIwer.remote.dispatch("look_at", { device: "controller-right", target });
    });
    await page.evaluate(() => window.__staniverseIwer.controllers.right!.updateButtonValue("trigger", 1));
    await expect(page.locator("[data-node-title]")).toHaveText("Арка Вятского Кремля");
    await page.evaluate(() => window.__staniverseIwer.controllers.right!.updateButtonValue("trigger", 0));
    await expect.poll(() => page.evaluate(() => {
      const { camera, scene } = (window as unknown as XrPanelProbe).__staniverseXR;
      const panel = scene.children.find(group => group.children.some(child => child.userData.panelAction))!;
      const expected = camera.getWorldPosition(camera.position.clone()).addScaledVector(camera.getWorldDirection(camera.position.clone()), 1.2);
      return panel.position.distanceTo(expected);
    })).toBeLessThan(.01);
    await page.screenshot({ path: testInfo.outputPath("xr-recalled-dossier-stereo.png") });
    // The close target still works even though it must not contribute pixels or depth.
    await page.evaluate(async () => {
      const { camera, scene } = (window as unknown as XrPanelProbe).__staniverseXR;
      const panel = scene.children.find(group => group.children.some(child => child.userData.panelAction))!;
      const close = panel.children.find(child => child.userData.panelAction === "close")!;
      const point = camera.parent!.worldToLocal(close.getWorldPosition(close.position.clone()));
      await window.__staniverseIwer.remote.dispatch("look_at", { device: "controller-right", target: { x: point.x, y: point.y, z: point.z } });
    });
    await page.evaluate(() => window.__staniverseIwer.controllers.right!.updateButtonValue("trigger", 1));
    await expect(root).toHaveAttribute("data-xr-panel", "false");
    await page.evaluate(() => window.__staniverseIwer.controllers.right!.updateButtonValue("trigger", 0));
    // Reselecting the same star brings its information back, rather than clearing the selection.
    await page.evaluate(async () => {
      const { camera, world } = (window as unknown as XrPanelProbe).__staniverseXR;
      const visual = world.visuals.get("work:arka-vyatskogo-kremlya")!;
      const point = camera.parent!.worldToLocal(world.root.localToWorld(visual.position.clone()));
      await window.__staniverseIwer.remote.dispatch("look_at", { device: "controller-right", target: { x: point.x, y: point.y, z: point.z } });
    });
    await page.evaluate(() => window.__staniverseIwer.controllers.right!.updateButtonValue("trigger", 1));
    await expect(root).toHaveAttribute("data-xr-panel", "true");
    await expect(page.locator("[data-node-title]")).toHaveText("Арка Вятского Кремля");
    await page.evaluate(() => window.__staniverseIwer.controllers.right!.updateButtonValue("trigger", 0));
    await endSession(page);
  });

  test("places a room-scale AR galaxy immediately and preserves it through tracking recovery", async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    await openUniverse(page, testInfo, ["desktop", "mobile"]);
    await loadOfficeEnvironment(page);
    await clickXrButton(page, "Войти в AR");
    await expect(page.locator(`${universe}[data-xr="ar"]`)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(`${universe}[data-ar-state="placed"]`)).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => window.__staniverseIwer.activeSession?.enabledFeatures.includes("dom-overlay"))).toBe(true);
    await page.evaluate(async () => {
      await window.__staniverseIwer.remote.dispatch("look_at", { device: "headset", target: { x: 0, y: 0, z: -1 } });
    });
    await expect(page.locator(universe)).toHaveAttribute("data-ar-mode", "room");
    await expect(page.locator("[data-ar-relocate]")).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath("iwer-ar-auto-placed.png") });

    // Relocation enters search for a fresh surface without losing tracking.
    await page.locator("[data-ar-relocate]").evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.locator(`${universe}[data-ar-state="searching"], ${universe}[data-ar-state="ready"]`)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("[data-xr-ar-status]")).not.toContainText("трекинг потерян");
    // Scale and rotate adjust the placed galaxy in place.
    await page.locator("[data-ar-scale-up]").evaluate((button: HTMLButtonElement) => button.click());
    await page.locator("[data-ar-rotate]").evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.locator(`${universe}[data-ar-state="searching"], ${universe}[data-ar-state="ready"], ${universe}[data-ar-state="placed"]`)).toBeVisible({ timeout: 10_000 });
    await endSession(page);
    await expect(page.locator("[data-ar-actions]")).toBeHidden();
  });
});
