import type { Group, Mesh, Object3D, PerspectiveCamera, Scene } from "three";
import { arContentLift } from "../../lib/xr-experience";
import type { ThreeModule } from "./UniverseWorld";

/**
 * Camera+SLAM AR adapter for the phones WebXR forgot: iOS WebKit has no
 * `navigator.xr`, so `immersive-ar` can never answer there. The version-pinned
 * 8th Wall CDN binary provides the camera pipeline and SLAM tracking; this
 * module owns its whole lifecycle:
 *
 *   lazy <script> load (no data-preload-chunks) → XR8.loadChunk('slam') after
 *   the tap → the engine's three.js pipeline renders the very same `world.root`
 *   graph → camera-relative placement (there is no WebXR hit-test here;
 *   placement follows the view direction and says so) → cleanup that returns
 *   the graph to the screen scene untouched.
 *
 * The engine never enters the page until a visitor taps the entry button, so
 * every other device downloads none of it. Repeat sessions reuse one canvas,
 * one placement hierarchy and one module registration: the engine is not
 * designed to accumulate duplicate pipelines.
 */

/** The narrow slice of the XR8 global this adapter touches. */
interface XR8 {
  addCameraPipelineModules(modules: unknown[]): void;
  run(config: { canvas: HTMLCanvasElement; allowedDevices: unknown }): void;
  stop(): void;
  loadChunk(chunk: "slam" | "face"): Promise<void>;
  GlTextureRenderer: { pipelineModule(): unknown };
  /** The engine builds its scene, camera and renderer from our global THREE. */
  Threejs: { pipelineModule(): unknown; xrScene(): { scene: Scene; camera: PerspectiveCamera } };
  XrController: { pipelineModule(): unknown };
  XrConfig: { device(): { ANY: unknown } };
}

type XR8Host = typeof globalThis & { XR8?: XR8; THREE?: unknown; __staniverseCameraAr?: CameraArShared };

export type CameraArStateEvent =
  | "engine-loading"
  | "camera-requesting"
  | "ready"
  | "placed"
  | "failed"
  | "ended";

export interface CameraArSession {
  /** Places the constellation along the current view direction. */
  place(): void;
  /** Back to aiming: the next `place()` moves it; the old spot is kept until then. */
  relocate(): void;
  /** Cancels aiming and keeps the previous placement. */
  cancelRelocate(): void;
  /** Scale in relative steps; rotation in radians. */
  adjust(scaleDelta: number, rotateDelta: number): void;
  /** Resolves when the engine is stopped and the graph is back in the screen scene. */
  end(): Promise<void>;
  /** Raycast through the engine camera into the world meshes; a node id or nothing. */
  pick(clientX: number, clientY: number): string | undefined;
}

export interface CameraArOptions {
  scriptUrl: string;
  /** The screen scene's three module: the engine builds its renderer from it. */
  THREE: ThreeModule;
  /** Overlay host: the engine canvas is inserted as its first child. */
  host: HTMLElement;
  /** `world.root` — adopted into the engine scene for the session. */
  worldRoot: Group;
  /** The graph's tabletop normalization, shared with the WebXR AR path. */
  contentBase: { scale: number; offsetY: number };
  /** Revealed pick volumes in world coordinates. */
  pickables: () => Mesh[];
  nodeIdFromPick: (mesh: Mesh, index?: number) => string | undefined;
  /**
   * Per-frame world animation, replacing the paused screen render loop. The
   * second argument is the live content scale, so point sprites can compensate.
   */
  worldUpdate: (elapsedSeconds: number, contentScale: number) => void;
  onState: (event: CameraArStateEvent, detail?: string) => void;
}

/** Everything that survives between sessions; the engine keeps its modules. */
interface CameraArShared {
  options: CameraArOptions;
  canvas: HTMLCanvasElement;
  placement: Group;
  content: Group;
  previousParent: Object3D | null;
  xrCamera?: PerspectiveCamera;
  scaleFactor: number;
  rotation: number;
  placed: boolean;
  ended: boolean;
  worldReturned: boolean;
  readinessTimer: number;
  startupFailed: boolean;
}

const loadEngineScript = (url: string) => new Promise<void>((resolve, reject) => {
  const host = globalThis as XR8Host;
  if (host.__staniverseCameraAr || host.XR8) { resolve(); return; }
  let settled = false;
  let poll = 0;
  const finish = () => {
    if (settled) return;
    settled = true;
    window.clearInterval(poll);
    resolve();
  };
  const script = document.createElement("script");
  script.src = url;
  script.async = true;
  script.addEventListener("error", () => {
    if (settled) return;
    settled = true;
    window.clearInterval(poll);
    reject(new Error("engine script failed to load"));
  }, { once: true });
  window.addEventListener("xrloaded", finish, { once: true });
  document.head.append(script);
  // The xrloaded event can race a slow script; poll for the global as a backstop.
  poll = window.setInterval(() => { if (host.XR8) finish(); }, 100);
  window.setTimeout(() => {
    if (!settled && !host.XR8) { window.clearInterval(poll); settled = true; reject(new Error("XR8 never appeared")); }
  }, 30_000);
});

const applyContentTransform = (shared: CameraArShared) => {
  const { content, options, scaleFactor, rotation } = shared;
  content.scale.setScalar(options.contentBase.scale * scaleFactor);
  content.position.set(0, arContentLift(options.contentBase.offsetY, scaleFactor), 0);
  content.rotation.set(0, rotation, 0);
};

const returnWorld = (shared: CameraArShared) => {
  if (shared.worldReturned) return;
  shared.worldReturned = true;
  shared.previousParent?.add(shared.options.worldRoot);
  shared.placement.removeFromParent();
};

export async function startCameraAr(options: CameraArOptions): Promise<CameraArSession> {
  const { THREE, host } = options;
  options.onState("engine-loading");
  await loadEngineScript(options.scriptUrl);

  const host8 = globalThis as XR8Host;
  const XR8 = host8.XR8;
  if (!XR8) throw new Error("XR8 is unavailable");

  // The engine's three.js pipeline reads the global and needs revision >= 125;
  // we hand it the very same module the screen scene uses. The binding stays
  // for the page's lifetime: the screen scene and the engine share it.
  if (host8.THREE !== THREE) host8.THREE = THREE;

  const existing = host8.__staniverseCameraAr;
  const shared: CameraArShared = existing ?? {
    options,
    canvas: document.createElement("canvas"),
    placement: new THREE.Group(),
    content: new THREE.Group(),
    previousParent: null,
    scaleFactor: 1,
    rotation: 0,
    placed: false,
    ended: false,
    worldReturned: false,
    startupFailed: false,
    readinessTimer: 0,
  };
  // Every session starts from the current options and a clean placement state.
  shared.options = options;
  shared.scaleFactor = 1;
  shared.rotation = 0;
  shared.placed = false;
  shared.ended = false;
  shared.worldReturned = false;
  shared.startupFailed = false;
  window.clearTimeout(shared.readinessTimer);
  shared.readinessTimer = 0;
  shared.previousParent = options.worldRoot.parent;
  shared.xrCamera = undefined;
  if (!existing) {
    shared.canvas.className = "camera-ar-canvas";
    shared.canvas.setAttribute("aria-label", "Камера дополненной реальности");
    shared.placement.add(shared.content);
  }
  host8.__staniverseCameraAr = shared;

  // The SLAM chunk is the heavy half of the engine: it downloads only after
  // this point, still inside the user gesture chain that started the session.
  await XR8.loadChunk("slam");

  host.prepend(shared.canvas);

  let lastUpdate = performance.now();

  try {
  if (!existing) {
    const worldModule = () => ({
      name: "staniverse-constellation",
      onStart() {
        const live = (globalThis as XR8Host).__staniverseCameraAr;
        if (!live) return;
        window.clearTimeout(live.readinessTimer);
        live.readinessTimer = 0;
        const { scene, camera } = XR8.Threejs.xrScene();
        scene.add(live.placement);
        live.content.add(live.options.worldRoot);
        applyContentTransform(live);
        live.xrCamera = camera;
        lastUpdate = performance.now();
        live.options.onState("ready");
      },
      onUpdate() {
        const live = (globalThis as XR8Host).__staniverseCameraAr;
        if (!live) return;
        const now = performance.now();
        live.options.worldUpdate((now - lastUpdate) / 1000, live.options.contentBase.scale * live.scaleFactor);
        lastUpdate = now;
      },
      onCameraStatus(event: { status: string }) {
        const live = (globalThis as XR8Host).__staniverseCameraAr;
        if (!live) return;
        if (event.status === "requesting") live.options.onState("camera-requesting");
        if (event.status === "failed") {
          window.clearTimeout(live.readinessTimer);
          live.readinessTimer = 0;
          live.startupFailed = true;
          live.options.onState("failed", "камера недоступна");
        }
      },
      onDetach() { const live = (globalThis as XR8Host).__staniverseCameraAr; if (live) returnWorld(live); },
      onError(error: unknown) {
        const live = (globalThis as XR8Host).__staniverseCameraAr;
        if (!live) return;
        window.clearTimeout(live.readinessTimer);
        live.readinessTimer = 0;
        live.startupFailed = true;
        live.options.onState("failed", String(error));
      },
    });
    XR8.addCameraPipelineModules([
      XR8.GlTextureRenderer.pipelineModule(),
      XR8.Threejs.pipelineModule(),
      XR8.XrController.pipelineModule(),
      worldModule(),
    ]);
  }

  XR8.run({ canvas: shared.canvas, allowedDevices: XR8.XrConfig.device().ANY });
    // Some engines report a denied/unavailable camera synchronously from run().
    // Reject before returning a handle; the catch below unwinds the canvas and
    // world graph even if setup itself threw.
    if (shared.startupFailed) throw new Error("camera unavailable");
    if (!shared.xrCamera) {
      shared.readinessTimer = window.setTimeout(() => {
        if (shared.ended || shared.xrCamera) return;
        shared.startupFailed = true;
        shared.options.onState("failed", "камера не ответила");
      }, 30_000);
    }
  } catch (error) {
    window.clearTimeout(shared.readinessTimer);
    shared.readinessTimer = 0;
    shared.ended = true;
    try { XR8.stop(); } catch { /* the engine may already be down */ }
    returnWorld(shared);
    shared.canvas.remove();
    throw error;
  }

  const forward = new THREE.Vector3();
  const position = new THREE.Vector3();
  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();

  return {
    place() {
      if (shared.ended || !shared.xrCamera) return;
      shared.xrCamera.getWorldPosition(position);
      shared.xrCamera.getWorldDirection(forward);
      // Camera-relative placement, honestly: no surface hit-test exists in this
      // engine, so the constellation settles where the viewer is looking — a
      // step away and a little below eye height.
      shared.placement.position.copy(position).addScaledVector(forward, 1.4);
      shared.placement.position.y -= .35;
      shared.placement.lookAt(position.x, shared.placement.position.y, position.z);
      applyContentTransform(shared);
      shared.placed = true;
      options.onState("placed");
    },
    relocate() { shared.placed = false; options.onState("ready"); },
    cancelRelocate() { if (shared.placed && !shared.ended) options.onState("placed"); },
    adjust(scaleDelta, rotateDelta) {
      shared.scaleFactor = THREE.MathUtils.clamp(shared.scaleFactor + scaleDelta, .5, 2);
      shared.rotation += rotateDelta;
      if (shared.placed) applyContentTransform(shared);
    },
    async end() {
      if (shared.ended) return;
      window.clearTimeout(shared.readinessTimer);
      shared.readinessTimer = 0;
      shared.ended = true;
      try { XR8.stop(); } catch { /* the engine may already be down */ }
      returnWorld(shared);
      shared.canvas.remove();
      options.onState("ended");
    },
    pick(clientX, clientY) {
      if (shared.ended || !shared.xrCamera) return undefined;
      const rect = shared.canvas.getBoundingClientRect();
      pointer.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, shared.xrCamera);
      const hit = raycaster.intersectObjects(options.pickables(), false)[0];
      return hit ? options.nodeIdFromPick(hit.object as Mesh, hit.index) : undefined;
    },
  };
}
