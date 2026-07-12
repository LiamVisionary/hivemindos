import assert from "node:assert/strict";
import {
  approachPointerProximity,
  pointerProximityRadius,
  pointerProximityStrength,
} from "../src/features/dashboard/views/brain-pointer-proximity.ts";

assert.equal(pointerProximityStrength(0, 160), 1, "the pointer center should fully excite a node");
assert.equal(pointerProximityStrength(160, 160), 0, "the field should reach zero at its edge");
assert.equal(pointerProximityStrength(220, 160), 0, "nodes outside the field should remain untouched");
assert.ok(
  pointerProximityStrength(40, 160) > pointerProximityStrength(100, 160),
  "lighting should fall continuously with screen-space distance",
);

const simultaneous = [18, 55, 110, 190].map((distance) => pointerProximityStrength(distance, 160));
assert.equal(simultaneous.filter((value) => value > 0).length, 3, "the field must not cap the number of lit nodes");

assert.equal(pointerProximityRadius(320, 180), 110, "small canvases should retain a usable minimum radius");
assert.equal(pointerProximityRadius(1400, 900), 180, "large canvases should use the responsive field radius");

const attack = approachPointerProximity(0, 1, 1 / 60);
const release = approachPointerProximity(1, 0, 1 / 60);
assert.ok(attack > 1 - release, "lighting should attack faster than it releases");

const sixtyFps = Array.from({ length: 60 }).reduce(
  (value) => approachPointerProximity(value, 1, 1 / 60),
  0,
);
const thirtyFps = Array.from({ length: 30 }).reduce(
  (value) => approachPointerProximity(value, 1, 1 / 30),
  0,
);
assert.ok(Math.abs(sixtyFps - thirtyFps) < 0.001, "smoothing should be frame-rate independent");

console.log("brain pointer proximity tests passed");
