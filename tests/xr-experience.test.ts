import test from "node:test";
import assert from "node:assert/strict";
import { applyRadialDeadzone, AR_SURFACE_CLEARANCE, arContentLift, cameraRelativeStep, missingIosArPrerequisites, nextArPlacementState, nextSnapTurn, normalizedArContentTransform } from "../src/lib/xr-experience";

test("flight motion follows the viewed direction", () => {
  assert.deepEqual(cameraRelativeStep({ forward: 1, strafe: 0, rise: 0 }, 0, 2), { x: 0, y: 0, z: -2 });
  const right = cameraRelativeStep({ forward: 1, strafe: 0, rise: 0 }, Math.PI / 2, 2);
  assert.ok(Math.abs(right.x + 2) < .00001);
});

test("AR placement waits for an actual hit and preserves placement through recovery", () => {
  let state = nextArPlacementState("idle", "start");
  state = nextArPlacementState(state, "hit");
  state = nextArPlacementState(state, "place");
  state = nextArPlacementState(state, "tracking-lost");
  assert.equal(nextArPlacementState(state, "tracking-restored"), "placed");
});

test("surface miss demotes only the found surface and relocate keeps placement until a new one", () => {
  let state = nextArPlacementState(nextArPlacementState("idle", "start"), "hit");
  assert.equal(state, "ready");
  assert.equal(nextArPlacementState(state, "hit-missed"), "searching");
  const placed = nextArPlacementState(nextArPlacementState(state, "place"), "hit");
  assert.equal(nextArPlacementState(placed, "hit-missed"), "placed");
  assert.equal(nextArPlacementState(placed, "relocate"), "searching");
  assert.equal(nextArPlacementState("searching", "relocate-cancel"), "placed");
  assert.equal(nextArPlacementState("ready", "relocate-cancel"), "placed");
  assert.equal(nextArPlacementState("lost", "relocate-cancel"), "lost-placed");
  assert.equal(nextArPlacementState("ready", "relocate"), "ready");
});

test("radial deadzone keeps direction, kills drift and never amplifies beyond unit", () => {
  assert.deepEqual(applyRadialDeadzone(0.1, 0.1), { x: 0, y: 0 });
  const nudged = applyRadialDeadzone(1, 0);
  assert.equal(nudged.x, 1);
  assert.equal(nudged.y, 0);
  const diagonal = applyRadialDeadzone(-0.8, 0.6);
  assert.ok(Math.abs(Math.atan2(diagonal.y, diagonal.x) - Math.atan2(0.6, -0.8)) < 1e-9);
  assert.ok(Math.hypot(diagonal.x, diagonal.y) <= 1);
});

test("snap turn fires once per crossing and waits for the deadzone return", () => {
  let state = { latched: false };
  const first = nextSnapTurn(state, 0.9, 0);
  assert.equal(first.latched, true);
  assert.ok(Math.abs(first.yaw - Math.PI / 6) < 1e-9);
  const held = nextSnapTurn({ latched: first.latched }, 0.9, first.yaw);
  assert.equal(held.yaw, first.yaw);
  const released = nextSnapTurn({ latched: held.latched }, 0.02, held.yaw);
  assert.equal(released.latched, false);
  const left = nextSnapTurn({ latched: released.latched }, -0.7, released.yaw);
  assert.ok(Math.abs(left.yaw - 0) < 1e-9);
});

test("AR content transform normalizes extent to one meter and lifts the bottom above the surface", () => {
  const { scale, offsetY } = normalizedArContentTransform([{ x: -10, y: -5, z: 0 }, { x: 10, y: 5, z: 0 }]);
  assert.ok(Math.abs(scale - 0.05) < 1e-9);
  assert.ok(Math.abs(offsetY - 0.3) < 1e-9);
  const empty = normalizedArContentTransform([]);
  assert.equal(empty.scale, 1);
  assert.equal(empty.offsetY, AR_SURFACE_CLEARANCE);
  const single = normalizedArContentTransform([{ x: 3, y: 3, z: 3 }]);
  assert.equal(single.scale, 1e6);
});

test("AR content lift keeps the lowest node on the surface while the scale controls change", () => {
  const { scale, offsetY } = normalizedArContentTransform([{ x: -10, y: -5, z: 0 }, { x: 10, y: 5, z: 0 }]);
  for (const scaleFactor of [0.5, 1, 1.75, 2]) {
    const bottomAboveSurface = arContentLift(offsetY, scaleFactor) + -5 * scale * scaleFactor;
    assert.ok(Math.abs(bottomAboveSurface - AR_SURFACE_CLEARANCE) < 1e-12, `bottom sits ${bottomAboveSurface}m above the surface at scale ${scaleFactor}`);
  }
});

test("iOS AR hardware gate reports every unavailable prerequisite without treating desktop as hardware proof", () => {
  assert.deepEqual(missingIosArPrerequisites({
    secureContext: true,
    camera: true,
    webgl: true,
    wasmSimd: true,
    deviceOrientation: false,
    iosDevice: false,
  }), ["device-orientation", "iphone-or-ipad"]);
});
