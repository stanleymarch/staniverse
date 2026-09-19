import test from "node:test";
import assert from "node:assert/strict";
import { applyRadialDeadzone, AR_ROOM_DIAMETER_M, AR_SURFACE_CLEARANCE, AR_TABLE_DIAMETER_M, arContentLift, arDiameterForMode, cameraArOffer, cameraRelativeStep, createGestureTracker, experienceStateForAr, GESTURE_DRAG_THRESHOLD_PX, MIN_TOUCH_TARGET_PX, nearestScreenTarget, nextArPlacementState, nextExperienceState, nextSnapTurn, normalizedArContentTransform, xrOffer } from "../src/lib/xr-experience";

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

test("camera AR is offered only to touch-first devices WebXR forgot entirely", () => {
  const ios = { xrSystem: false, immersiveAr: false, coarsePointer: true, secureContext: true };
  assert.equal(cameraArOffer(ios), true);
  // A device with native immersive-ar never needs the camera adapter.
  assert.equal(cameraArOffer({ ...ios, xrSystem: true, immersiveAr: true }), false);
  // navigator.xr exists but immersive-ar answered false (desktop Chrome): no webcam surprise.
  assert.equal(cameraArOffer({ ...ios, xrSystem: true, immersiveAr: false }), false);
  // A fine pointer (desktop Safari) keeps the touch-3D screen instead.
  assert.equal(cameraArOffer({ ...ios, coarsePointer: false }), false);
  // getUserMedia needs a secure context.
  assert.equal(cameraArOffer({ ...ios, secureContext: false }), false);
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
test("AR placement modes scale the same extent to tabletop reach or room surround", () => {
  assert.equal(AR_TABLE_DIAMETER_M, 1);
  assert.equal(AR_ROOM_DIAMETER_M, 3.5);
  assert.equal(arDiameterForMode("table"), 1);
  assert.equal(arDiameterForMode("room"), 3.5);
  const extent = [{ x: -10, y: -5, z: 0 }, { x: 10, y: 5, z: 0 }];
  const table = normalizedArContentTransform(extent);
  const room = normalizedArContentTransform(extent, arDiameterForMode("room"));
  assert.ok(Math.abs(table.scale - 0.05) < 1e-9);
  assert.ok(Math.abs(room.scale - 0.175) < 1e-9);
  assert.ok(Math.abs((arContentLift(room.offsetY, 1) + -5 * room.scale) - AR_SURFACE_CLEARANCE) < 1e-12);
});

test("the loader leaves loading exactly once and an error is terminal", () => {
  assert.equal(nextExperienceState("loading", "loaded"), "exploring");
  assert.equal(nextExperienceState("exploring", "loaded"), "exploring");
  assert.equal(nextExperienceState("searching", "loaded"), "searching");
  assert.equal(nextExperienceState("loading", "failed"), "error");
  assert.equal(nextExperienceState("error", "loaded"), "error");
});

test("AR placement maps onto the published experience states", () => {
  assert.equal(experienceStateForAr("idle"), "exploring");
  assert.equal(experienceStateForAr("searching"), "searching");
  assert.equal(experienceStateForAr("ready"), "ready");
  assert.equal(experienceStateForAr("placed"), "placed");
  assert.equal(experienceStateForAr("lost"), "lost");
  assert.equal(experienceStateForAr("lost-placed"), "lost");
});

test("only a device that really supports immersive-ar is offered AR and no camera probe backs it", () => {
  assert.deepEqual(xrOffer({ xrSystem: false, immersiveVr: false, immersiveAr: false }), { vr: false, ar: false, screen: "touch-3d" });
  assert.deepEqual(xrOffer({ xrSystem: true, immersiveVr: true, immersiveAr: false }), { vr: true, ar: false, screen: "touch-3d" });
  assert.deepEqual(xrOffer({ xrSystem: true, immersiveVr: false, immersiveAr: true }), { vr: false, ar: true, screen: "touch-3d" });
  // A browser that reports immersive modes without an XR system may not be trusted with either.
  assert.deepEqual(xrOffer({ xrSystem: false, immersiveVr: true, immersiveAr: true }), { vr: false, ar: false, screen: "touch-3d" });
});

test("gesture slop is cumulative, so a slow drag is never read as a tap", () => {
  assert.ok(GESTURE_DRAG_THRESHOLD_PX >= 8 && GESTURE_DRAG_THRESHOLD_PX <= 12, `slop ${GESTURE_DRAG_THRESHOLD_PX}px sits inside the 8-12px band`);
  const tap = createGestureTracker();
  tap.start(200, 300);
  // A finger never reports a clean position: jitter around the origin stays a tap.
  assert.equal(tap.move(201, 301), false);
  assert.equal(tap.move(200, 301), false);
  assert.equal(tap.move(201, 300), false);
  assert.equal(tap.dragged, false);

  const drag = createGestureTracker();
  drag.start(0, 0);
  // 30 samples of 1px each are a real drag, even though no single sample is large.
  for (let index = 0; index < 30; index += 1) drag.move(index + 1, 0);
  assert.equal(drag.dragged, true);
  assert.equal(drag.travelled, 30);
  drag.reset();
  assert.equal(drag.dragged, false);
});

test("a near miss still selects the nearest visible star inside one touch target", () => {
  const targets = [
    { id: "far", x: 400, y: 400, visible: true },
    { id: "near", x: 100, y: 112, visible: true },
    { id: "hidden", x: 100, y: 100, visible: false },
    { id: "exact", x: 100, y: 100, visible: true },
  ];
  assert.equal(nearestScreenTarget(targets, 100, 100)?.id, "exact");
  assert.equal(nearestScreenTarget(targets, 100, 121)?.id, "near");
  // 23px away is outside one 44px target, and the next visible star is further still.
  assert.equal(nearestScreenTarget(targets, 100, 135), undefined);
  assert.equal(nearestScreenTarget([targets[2]], 100, 100), undefined);
  assert.equal(MIN_TOUCH_TARGET_PX, 44);
});
