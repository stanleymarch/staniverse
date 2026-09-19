/** Small, DOM-free pieces shared by the screen and immersive render loops. */
export type FlightInput = { forward: number; strafe: number; rise: number };
export type ArPlacementState = "idle" | "searching" | "ready" | "placed" | "lost" | "lost-placed";

export function cameraRelativeStep(input: FlightInput, yaw: number, distance: number) {
  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  return {
    x: (forwardX * input.forward + Math.cos(yaw) * input.strafe) * distance,
    y: input.rise * distance,
    z: (forwardZ * input.forward + Math.sin(yaw) * input.strafe) * distance,
  };
}

export const VR_SPEED_METERS_PER_SECOND = 1.5;
export const VR_THUMBSTICK_DEADZONE = 0.15;
export const VR_SNAP_TURN_RADIANS = Math.PI / 6;

/** Radial deadzone for xr-standard thumbsticks: direction is preserved, drift never moves the rig. */
export function applyRadialDeadzone(x: number, y: number, deadzone = VR_THUMBSTICK_DEADZONE): { x: number; y: number } {
  const magnitude = Math.hypot(x, y);
  if (magnitude < deadzone) return { x: 0, y: 0 };
  const rescaled = Math.min(1, (magnitude - deadzone) / (1 - deadzone)) / magnitude;
  return { x: x * rescaled, y: y * rescaled };
}

export interface SnapTurnState {
  /** True while the stick is held past the deadzone; the next turn waits for a return. */
  latched: boolean;
}

/** Snap turn: one step per crossing, latched until the stick returns to the deadzone. */
export function nextSnapTurn(state: SnapTurnState, axisX: number, yaw: number, deadzone = VR_THUMBSTICK_DEADZONE, step = VR_SNAP_TURN_RADIANS): { yaw: number; latched: boolean } {
  if (Math.abs(axisX) < deadzone) return { yaw, latched: false };
  if (state.latched) return { yaw, latched: true };
  const turned = yaw + Math.sign(axisX) * step;
  return { yaw: Math.atan2(Math.sin(turned), Math.cos(turned)), latched: true };
}

/** Clearance in meters between the normalized constellation's bottom and the detected surface. */
export const AR_SURFACE_CLEARANCE = 0.05;

/** Normalizes graph extent into a 1m tabletop constellation with its bottom 5cm above the surface. */
export function normalizedArContentTransform(positions: ReadonlyArray<{ x: number; y: number; z: number }>): { scale: number; offsetY: number } {
  if (!positions.length) return { scale: 1, offsetY: AR_SURFACE_CLEARANCE };
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of positions) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const diameter = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-6);
  const scale = 1 / diameter;
  return { scale, offsetY: -minY * scale + AR_SURFACE_CLEARANCE };
}

/**
 * Y offset for the movable content root. `normalizedArContentTransform` holds the bottom
 * `AR_SURFACE_CLEARANCE` above the surface at scale 1, so scaling the content has to scale that
 * same lift — otherwise the constellation sinks through the surface or floats above it.
 */
export function arContentLift(offsetY: number, scaleFactor: number): number {
  return AR_SURFACE_CLEARANCE + (offsetY - AR_SURFACE_CLEARANCE) * scaleFactor;
}

export type ArPlacementEvent = "start" | "hit" | "hit-missed" | "place" | "relocate" | "relocate-cancel" | "tracking-lost" | "tracking-restored" | "end";

export function nextArPlacementState(current: ArPlacementState, event: ArPlacementEvent): ArPlacementState {
  if (event === "end") return "idle";
  if (event === "start") return "searching";
  // Surface loss is not tracking loss: a miss only drops the found surface.
  if (event === "hit-missed") return current === "ready" ? "searching" : current;
  if (event === "relocate") return current === "placed" ? "searching" : current;
  if (event === "relocate-cancel") return current === "lost" ? "lost-placed" : current === "searching" || current === "ready" ? "placed" : current;
  if (event === "tracking-lost") return current === "placed" ? "lost-placed" : current === "idle" ? "idle" : "lost";
  if (event === "tracking-restored") return current === "lost-placed" ? "placed" : current === "lost" ? "searching" : current;
  if (event === "hit" && current === "searching") return "ready";
  if (event === "place" && current === "ready") return "placed";
  return current;
}

/**
 * One state, published as `data-experience-state`, for the whole route: the loader, the screen
 * session and the AR session all report through it, so the overlay never has to guess what is
 * happening from a dozen flags.
 */
export type ExperienceState = "loading" | "exploring" | "searching" | "ready" | "placed" | "lost" | "error";
export type ExperienceEvent = "loaded" | "failed";

/** The loader only ever leaves `loading` once, and `error` is terminal: a late chunk cannot undo either. */
export function nextExperienceState(current: ExperienceState, event: ExperienceEvent): ExperienceState {
  if (event === "failed") return "error";
  return current === "loading" ? "exploring" : current;
}

/** AR placement states projected onto the route state; the screen modes are simply `exploring`. */
export function experienceStateForAr(state: ArPlacementState): ExperienceState {
  if (state === "searching") return "searching";
  if (state === "ready") return "ready";
  if (state === "placed") return "placed";
  if (state === "lost" || state === "lost-placed") return "lost";
  return "exploring";
}

export interface XrCapabilities {
  /** `"xr" in navigator`. */
  xrSystem: boolean;
  immersiveVr: boolean;
  immersiveAr: boolean;
}

export interface XrOffer {
  vr: boolean;
  ar: boolean;
  /** The single non-immersive experience: a camera-free touch-3D view of the same graph. */
  screen: "touch-3d";
}

/**
 * Which immersive modes the overlay may offer. The decision reads the two `isSessionSupported`
 * answers and nothing else — no user-agent sniffing, no camera probe, no vendor SDK — so a device
 * that has no `immersive-ar` gets the touch-3D screen mode instead of a camera prompt.
 */
export function xrOffer(capabilities: XrCapabilities): XrOffer {
  const xrSystem = capabilities.xrSystem === true;
  return {
    vr: xrSystem && capabilities.immersiveVr === true,
    ar: xrSystem && capabilities.immersiveAr === true,
    screen: "touch-3d",
  };
}

export interface CameraArCapabilities {
  /** `"xr" in navigator`: a native WebXR implementation exists. */
  xrSystem: boolean;
  /** `isSessionSupported("immersive-ar")` answer. */
  immersiveAr: boolean;
  /** The primary pointer is a finger, not a mouse. */
  coarsePointer: boolean;
  /** getUserMedia needs a secure context. */
  secureContext: boolean;
}

/**
 * Whether the camera+SLAM adapter may be offered. It exists for the phones WebXR
 * forgot — iOS WebKit exposes no `navigator.xr` at all — and is deliberately not
 * offered where native `immersive-ar` already answered, nor on pointer-fine
 * devices, so a desktop without WebXR keeps the plain touch-3D screen instead of
 * a webcam surprise. Capability answers only; no user-agent sniffing.
 */
export function cameraArOffer(capabilities: CameraArCapabilities): boolean {
  return capabilities.secureContext === true
    && capabilities.xrSystem !== true
    && capabilities.immersiveAr !== true
    && capabilities.coarsePointer === true;
}

/** Cumulative travel, in CSS pixels, that turns a press into a look/flight drag. */
export const GESTURE_DRAG_THRESHOLD_PX = 10;
/** Minimum footprint of every interactive target, in-scene picks included. */
export const MIN_TOUCH_TARGET_PX = 44;

export interface GestureTracker {
  /** Path length travelled since `start`, in CSS pixels. */
  readonly travelled: number;
  /** True once the accumulated travel passed the slop threshold. */
  readonly dragged: boolean;
  start(x: number, y: number): void;
  /** Records one pointer sample and reports whether the gesture is now a drag. */
  move(x: number, y: number): boolean;
  reset(): void;
}

/**
 * Tap-versus-drag tracker. Judging each sample on its own lets a slow, high-frequency drag read as
 * a tap and select a star by accident; accumulating the whole path since the press instead keeps
 * real drags working and ignores the few pixels of jitter a tap produces.
 */
export function createGestureTracker(threshold = GESTURE_DRAG_THRESHOLD_PX): GestureTracker {
  let travelled = 0;
  let lastX = 0;
  let lastY = 0;
  let active = false;
  return {
    get travelled() { return travelled; },
    get dragged() { return travelled >= threshold; },
    start(x, y) { active = true; travelled = 0; lastX = x; lastY = y; },
    move(x, y) {
      if (!active) return travelled >= threshold;
      travelled += Math.hypot(x - lastX, y - lastY);
      lastX = x; lastY = y;
      return travelled >= threshold;
    },
    reset() { active = false; travelled = 0; },
  };
}

export interface ScreenTarget {
  id: string;
  /** Projected pointer position, in CSS pixels relative to the canvas. */
  x: number;
  y: number;
  visible: boolean;
}

/**
 * Fallback for a raycast that missed: the nearest visible star inside one touch target of the
 * pointer still counts as a hit, so a fingertip does not have to land exactly on a few pixels.
 */
export function nearestScreenTarget<T extends ScreenTarget>(targets: readonly T[], x: number, y: number, radius = MIN_TOUCH_TARGET_PX / 2): T | undefined {
  let best: T | undefined;
  let bestDistance = radius;
  for (const target of targets) {
    if (!target.visible) continue;
    const distance = Math.hypot(target.x - x, target.y - y);
    if (distance <= bestDistance) { bestDistance = distance; best = target; }
  }
  return best;
}
