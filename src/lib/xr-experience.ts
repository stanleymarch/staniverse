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
 * Boundary for an optional self-hosted iOS adapter. An 8th Wall engine binary
 * with a real camera/SLAM implementation must be loaded by the host app here.
 * This site deliberately has no fake camera overlay or simulated tracking.
 */
export interface IosArAdapter {
  supported(): Promise<boolean>;
  start(): Promise<void>;
  stop(): void;
}

export type IosArPrerequisite = "https" | "camera" | "webgl" | "wasm-simd" | "device-orientation" | "iphone-or-ipad";

export interface IosArCapabilities {
  secureContext: boolean;
  camera: boolean;
  webgl: boolean;
  wasmSimd: boolean;
  deviceOrientation: boolean;
  iosDevice: boolean;
}

/** Explicit hardware gate for the optional 8th Wall SLAM spike; desktop can verify only SDK loading. */
export function missingIosArPrerequisites(capabilities: IosArCapabilities): IosArPrerequisite[] {
  const missing: IosArPrerequisite[] = [];
  if (!capabilities.secureContext) missing.push("https");
  if (!capabilities.camera) missing.push("camera");
  if (!capabilities.webgl) missing.push("webgl");
  if (!capabilities.wasmSimd) missing.push("wasm-simd");
  if (!capabilities.deviceOrientation) missing.push("device-orientation");
  if (!capabilities.iosDevice) missing.push("iphone-or-ipad");
  return missing;
}
