import * as THREE from "three";
import type { GraphEdge, GraphNode } from "../../lib/graph";
import { arContentLift, missingIosArPrerequisites, normalizedArContentTransform, type IosArAdapter } from "../../lib/xr-experience";
import { UniverseWorld } from "./UniverseWorld";

type GraphPayload = { nodes: GraphNode[]; edges: GraphEdge[] };
type Hit = {
  type: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
};
type PipelineModule = {
  name: string;
  onStart?: (args: { canvas: HTMLCanvasElement }) => void;
  onUpdate?: () => void;
};
type Xr8 = {
  addCameraPipelineModules(modules: PipelineModule[]): void;
  removeCameraPipelineModules?(names: string[]): void;
  run(options: { canvas: HTMLCanvasElement; allowedDevices?: unknown }): void;
  stop(): void;
  GlTextureRenderer: { pipelineModule(): PipelineModule };
  Threejs: {
    pipelineModule(): PipelineModule;
    xrScene(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer };
  };
  XrController: {
    pipelineModule(): PipelineModule;
    hitTest(x: number, y: number, includedTypes?: string[]): Hit[];
    updateCameraProjectionMatrix(options: { origin: THREE.Vector3; facing: THREE.Quaternion }): void;
  };
  XrConfig?: { device(): { ANY?: unknown } };
};

declare global {
  interface Window {
    XR8?: Xr8;
    THREE?: typeof THREE;
  }
}

/** Pinned engine build: the spike must load the same reviewed binary on every machine. */
const ENGINE_URL = "https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1.0.0/dist/xr.js";
const LICENSE_URL = "https://github.com/8thwall/engine/blob/main/LICENSE";

/** Raised when the host cancels `start()`; callers treat it as a user action, not a failure. */
class IosArStartCancelled extends Error {
  constructor() {
    super("iOS AR: запуск отменён");
    this.name = "IosArStartCancelled";
  }
}

function supportsWasmSimd() {
  if (!globalThis.WebAssembly?.validate) return false;
  // () -> v128 { v128.const i32x4 0 0 0 0 }
  return WebAssembly.validate(new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,
    0x03, 0x02, 0x01, 0x00,
    0x0a, 0x16, 0x01, 0x14, 0x00, 0xfd, 0x0c,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0b,
  ]));
}

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function loadEngine(url = ENGINE_URL): Promise<Xr8> {
  if (window.XR8) return Promise.resolve(window.XR8);
  return new Promise((resolve, reject) => {
    const finish = () => {
      if (!window.XR8) return;
      window.clearTimeout(timeout);
      resolve(window.XR8);
    };
    const fail = () => {
      window.clearTimeout(timeout);
      window.removeEventListener("xrloaded", finish);
      reject(new Error("8th Wall SDK failed to load"));
    };
    const timeout = window.setTimeout(fail, 30_000);
    window.addEventListener("xrloaded", finish, { once: true });
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${url}"]`);
    if (existing) {
      existing.addEventListener("error", fail, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.preloadChunks = "slam";
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", fail, { once: true });
    document.head.append(script);
  });
}

/**
 * Camera/SLAM fallback for iPhone and iPad, whose Safari lacks immersive WebXR.
 * It owns a separate 8th Wall renderer; Android/Quest keep the native WebXR path.
 */
export async function mountIosArSpike(root: HTMLElement, graph: GraphPayload) {
  const canvas = root.querySelector<HTMLCanvasElement>(".universe-canvas");
  const actions = root.querySelector<HTMLElement>("[data-universe-actions]");
  const status = root.querySelector<HTMLElement>("[data-xr-ar-status]");
  const announcer = root.querySelector<HTMLElement>("[data-announcer]");
  if (!canvas || !actions || !status) throw new Error("iOS AR spike host is incomplete");
  const engineUrl = import.meta.env.PUBLIC_8THWALL_ENGINE_URL?.trim() || ENGINE_URL;

  const webglProbe = document.createElement("canvas");
  const iosDevice = isIosDevice();
  const missing = missingIosArPrerequisites({
    secureContext: window.isSecureContext,
    camera: Boolean(navigator.mediaDevices?.getUserMedia),
    webgl: Boolean(webglProbe.getContext("webgl2") || webglProbe.getContext("webgl")),
    wasmSimd: supportsWasmSimd(),
    deviceOrientation: "DeviceOrientationEvent" in window,
    iosDevice,
  });
  root.dataset.iosArSpike = "gate";
  root.dataset.iosArHardware = missing.length ? `missing:${missing.join(",")}` : "ready";

  for (const selector of [".node-search", "[data-history-back]", "[data-reset]", "[data-sound]", "[data-xr-vr-status]"]) {
    const element = root.querySelector<HTMLElement>(selector);
    if (element) element.hidden = true;
  }
  const regularArActions = root.querySelector<HTMLElement>("[data-ar-actions]");
  if (regularArActions) regularArActions.hidden = true;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-button xr-button";
  button.textContent = iosDevice ? "Запустить iOS AR" : "Проверить iOS AR SDK";
  actions.prepend(button);

  const notice = document.createElement("small");
  notice.className = "xr-status";
  notice.innerHTML = `8th Wall XR Engine © 2026 Niantic Spatial, Inc. · <a href="${LICENSE_URL}">лицензия</a>`;
  actions.append(notice);

  const controller = new AbortController();
  let engine: Xr8 | undefined;
  let world: UniverseWorld | undefined;
  let placementRoot: THREE.Group | undefined;
  let contentRoot: THREE.Group | undefined;
  let reticle: THREE.Mesh | undefined;
  let pipelineNames: string[] = [];
  let running = false;
  let starting = false;
  let engineRunning = false;
  let startToken = 0;
  let cancelStart: (() => void) | undefined;

  const setStatus = (message: string) => {
    status.textContent = message;
    if (announcer) announcer.textContent = message;
  };

  const stop = () => {
    // Cancels a start that is still awaiting the engine or the camera pipeline: without this the
    // pipeline would open the camera after the host already tore the spike down.
    startToken += 1;
    starting = false;
    running = false;
    cancelStart?.();
    cancelStart = undefined;
    if (engineRunning) {
      engine?.stop();
      engineRunning = false;
    }
    engine?.removeCameraPipelineModules?.(pipelineNames);
    pipelineNames = [];
    world?.dispose();
    world = undefined;
    placementRoot?.removeFromParent();
    placementRoot = undefined;
    contentRoot = undefined;
    if (reticle) {
      reticle.removeFromParent();
      reticle.geometry.dispose();
      (reticle.material as THREE.Material).dispose();
      reticle = undefined;
    }
    if (engine) root.dataset.iosArSpike = "stopped";
  };

  /** Boots one camera-pipeline attempt; `start()` owns the flags so a cancelled boot stays consistent. */
  const bootSpike = async (token: number) => {
    window.THREE = THREE;
    root.dataset.iosArSpike = "loading";
    setStatus("iOS AR: загружаю self-hostable 8th Wall engine…");
    const loaded = await loadEngine(engineUrl);
    if (token !== startToken) throw new IosArStartCancelled();
    engine = loaded;

    let resolveStarted: (() => void) | undefined;
    let rejectStarted: ((error: Error) => void) | undefined;
    const started = new Promise<void>((resolve, reject) => { resolveStarted = resolve; rejectStarted = reject; });
    const startTimeout = window.setTimeout(() => rejectStarted?.(new Error("8th Wall camera pipeline start timeout: проверьте доступ к камере")), 30_000);
    cancelStart = () => { window.clearTimeout(startTimeout); rejectStarted?.(new IosArStartCancelled()); };
    let placed = false;
    let gesture: { distance: number; angle: number; scale: number; rotation: number } | undefined;
    let gestureConsumed = false;

    const spikeModule: PipelineModule = {
      name: "staniverse-ios-ar-spike",
      onStart: ({ canvas: runningCanvas }) => {
        // The host may have stopped the spike while the engine was booting.
        if (token !== startToken) { window.clearTimeout(startTimeout); resolveStarted?.(); return; }
        try {
          const xrScene = engine!.Threejs.xrScene();
          const focusId = new URLSearchParams(location.search).get("focus") ?? graph.nodes.find((node) => node.featured)?.id ?? graph.nodes[0]?.id;
          const initialIds = new Set<string>();
          if (focusId) initialIds.add(focusId);
          graph.edges.forEach((edge) => {
            if (edge.source === focusId) initialIds.add(edge.target);
            if (edge.target === focusId) initialIds.add(edge.source);
          });
          world = UniverseWorld.create({ THREE, scene: xrScene.scene }, graph, { compact: false, initialIds });
          world.revealBatch([...initialIds]);
          if (focusId) world.focus(focusId);

          placementRoot = new THREE.Group();
          contentRoot = new THREE.Group();
          const currentParent = world.root.parent;
          currentParent?.remove(world.root);
          contentRoot.add(world.root);
          placementRoot.add(contentRoot);
          xrScene.scene.add(placementRoot);
          const transform = normalizedArContentTransform([...world.visuals.values()].map((visual) => visual.position));
          contentRoot.scale.setScalar(transform.scale);
          contentRoot.position.y = transform.offsetY;
          placementRoot.visible = false;

          reticle = new THREE.Mesh(
            new THREE.RingGeometry(.035, .05, 24).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial({ color: 0x6de1f4, side: THREE.DoubleSide }),
          );
          reticle.visible = false;
          xrScene.scene.add(reticle);
          xrScene.camera.position.set(0, 2, 2);
          engine!.XrController.updateCameraProjectionMatrix({ origin: xrScene.camera.position, facing: xrScene.camera.quaternion });

          const hitAt = (x: number, y: number) => engine!.XrController.hitTest(x, y, ["FEATURE_POINT"])[0];
          const placeAt = (hit: Hit) => {
            placementRoot!.position.set(hit.position.x, hit.position.y, hit.position.z);
            placementRoot!.quaternion.set(hit.rotation.x, hit.rotation.y, hit.rotation.z, hit.rotation.w);
            placementRoot!.visible = true;
            placed = true;
            if (reticle) reticle.visible = false;
            root.dataset.iosArSpike = "placed";
            setStatus("iOS AR: созвездие размещено; коснитесь звезды или используйте жест двумя пальцами");
          };
          const pickNode = (touch: Touch) => {
            const rect = runningCanvas.getBoundingClientRect();
            const pointer = new THREE.Vector2(
              ((touch.clientX - rect.left) / rect.width) * 2 - 1,
              -((touch.clientY - rect.top) / rect.height) * 2 + 1,
            );
            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(pointer, xrScene.camera);
            const hit = raycaster.intersectObjects(world!.pickableMeshes(), false)[0];
            const id = hit ? String(hit.object.userData.nodeId ?? "") : "";
            const node = id ? world!.byId.get(id) : undefined;
            if (!node) return;
            world!.focus(id);
            setStatus(`iOS AR: выбран узел «${node.title}»`);
          };
          runningCanvas.addEventListener("touchstart", (event) => {
            if (event.touches.length !== 2 || !contentRoot) return;
            const [a, b] = [event.touches[0], event.touches[1]];
            gesture = {
              distance: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
              angle: Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX),
              scale: contentRoot.scale.x,
              rotation: contentRoot.rotation.y,
            };
            gestureConsumed = true;
          }, { signal: controller.signal });
          runningCanvas.addEventListener("touchmove", (event) => {
            event.preventDefault();
            if (event.touches.length !== 2 || !gesture || !contentRoot) return;
            const [a, b] = [event.touches[0], event.touches[1]];
            const distance = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
            const angle = Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX);
            const nextScale = THREE.MathUtils.clamp(gesture.scale * distance / Math.max(gesture.distance, 1), transform.scale * .5, transform.scale * 2);
            contentRoot.scale.setScalar(nextScale);
            // Pinch-zooming must not lift the constellation off the surface or push it through it.
            contentRoot.position.y = arContentLift(transform.offsetY, nextScale / transform.scale);
            contentRoot.rotation.y = gesture.rotation + angle - gesture.angle;
          }, { passive: false, signal: controller.signal });
          runningCanvas.addEventListener("touchend", (event) => {
            if (gesture || gestureConsumed) {
              gesture = undefined;
              if (event.touches.length === 0) gestureConsumed = false;
              return;
            }
            const touch = event.changedTouches[0];
            if (!touch) return;
            if (!placed) {
              const rect = runningCanvas.getBoundingClientRect();
              const hit = hitAt((touch.clientX - rect.left) / rect.width, (touch.clientY - rect.top) / rect.height);
              if (hit) placeAt(hit); else setStatus("iOS AR: поверхность не найдена — переместите камеру медленнее");
              return;
            }
            pickNode(touch);
          }, { signal: controller.signal });

          running = true;
          root.dataset.iosArSpike = "searching";
          setStatus("iOS AR: наведите камеру на поверхность и коснитесь точки размещения");
          window.clearTimeout(startTimeout);
          resolveStarted?.();
        } catch (error) {
          window.clearTimeout(startTimeout);
          rejectStarted?.(error instanceof Error ? error : new Error(String(error)));
        }
      },
      onUpdate: () => {
        if (!engine || !reticle || placed) return;
        const hit = engine.XrController.hitTest(.5, .55, ["FEATURE_POINT"])[0];
        reticle.visible = Boolean(hit);
        if (!hit) return;
        reticle.position.set(hit.position.x, hit.position.y, hit.position.z);
        reticle.quaternion.set(hit.rotation.x, hit.rotation.y, hit.rotation.z, hit.rotation.w);
      },
    };
    const modules = [engine.GlTextureRenderer.pipelineModule(), engine.Threejs.pipelineModule(), engine.XrController.pipelineModule(), spikeModule];
    pipelineNames = modules.map((module) => module.name);
    engine.addCameraPipelineModules(modules);
    engineRunning = true;
    engine.run({ canvas, allowedDevices: engine.XrConfig?.device().ANY });
    await started;
    if (token !== startToken) throw new IosArStartCancelled();
  };

  const adapter: IosArAdapter = {
    async supported() { return missing.length === 0; },
    async start() {
      if (running || starting) return;
      if (missing.length) throw new Error(`iOS AR prerequisites missing: ${missing.join(", ")}`);
      starting = true;
      const token = ++startToken;
      try {
        await bootSpike(token);
      } finally {
        starting = false;
        cancelStart = undefined;
      }
    },
    stop,
  };

  const loadSdkOnly = async () => {
    button.disabled = true;
    try {
      const loaded = await loadEngine(engineUrl);
      const complete = Boolean(loaded.GlTextureRenderer && loaded.Threejs && loaded.XrController);
      if (!complete) throw new Error("required world-tracking modules are absent");
      root.dataset.iosArSdk = "ready";
      setStatus("8th Wall SDK загружен; desktop проверяет только API, не iPhone SLAM");
      button.textContent = "SDK доступен · нужен iPhone";
    } catch (error) {
      root.dataset.iosArSdk = "failed";
      setStatus(`iOS AR SDK: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      button.disabled = false;
    }
  };

  button.addEventListener("click", async () => {
    if (!iosDevice) { await loadSdkOnly(); return; }
    if (starting) {
      // The engine boot can wait on the camera permission prompt for 30s: keep the button usable as
      // a cancel so the spike never traps the visitor in a half-started camera session.
      adapter.stop();
      setStatus("iOS AR: запуск отменён");
      button.textContent = "Запустить iOS AR";
      return;
    }
    if (running) { adapter.stop(); location.reload(); return; }
    button.textContent = "Отменить запуск";
    try {
      await adapter.start();
      button.textContent = running ? "Выйти из iOS AR" : "Запустить iOS AR";
    } catch (error) {
      adapter.stop();
      if (error instanceof IosArStartCancelled) {
        setStatus("iOS AR: запуск отменён");
      } else {
        root.dataset.iosArSpike = "failed";
        setStatus(`iOS AR: ${error instanceof Error ? error.message : String(error)}`);
      }
      button.textContent = "Запустить iOS AR";
    } finally {
      button.disabled = false;
    }
  }, { signal: controller.signal });

  if (missing.length === 0) setStatus("iOS AR spike готов; запуск запросит доступ к камере");
  else if (!iosDevice) setStatus(`Desktop SDK-проверка; hardware gate: ${missing.join(", ")}`);
  else {
    setStatus(`iOS AR недоступен: ${missing.join(", ")}`);
    button.disabled = true;
  }

  return () => {
    controller.abort();
    adapter.stop();
    button.remove();
    notice.remove();
    delete root.dataset.iosArSpike;
    delete root.dataset.iosArHardware;
    delete root.dataset.iosArSdk;
  };
}
