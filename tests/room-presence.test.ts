import { test } from "node:test";
import assert from "node:assert/strict";
import { cameraAtView, validPresence, validRoomView, viewFromCamera } from "../src/room-presence.ts";

test("room view navigation preserves world center and fits another window's aspect ratio", () => {
  const original = { x: -1700, y: 800, zoom: .5 };
  const view = viewFromCamera(original, 1200, 800)!;
  assert.deepEqual(view, { x: 4600, y: -800, width: 2400, height: 1600 });
  assert.deepEqual(cameraAtView(view, 1200, 800), original);
  const narrow = cameraAtView(view, 600, 900)!;
  assert.equal(narrow.zoom, .25);
  const destination = viewFromCamera(narrow, 600, 900)!;
  assert.equal(destination.x, view.x); assert.equal(destination.y, view.y);
  assert.ok(destination.width >= view.width && destination.height >= view.height);
  assert.equal(cameraAtView({ ...view, width: 1, height: 1 }, 1200, 800)!.zoom, 4);
  assert.equal(cameraAtView({ ...view, width: 200000, height: 200000 }, 1200, 800)!.zoom, .1);
});

test("presence validates world geometry and accepts older payloads without a view", () => {
  const presence = { selection: ["token"], laser: { x: -500, y: 800 }, view: { x: 0, y: 0, width: 1200, height: 800 } };
  assert.equal(validPresence(presence), true);
  assert.equal(validPresence({ selection: [], laser: null }), true);
  for (const view of [null, [], {}, { ...presence.view, width: 0 }, { ...presence.view, height: -1 }, { ...presence.view, x: Infinity }, { ...presence.view, y: 1e7 }, { ...presence.view, width: 200001 }]) {
    assert.equal(validRoomView(view), false);
    if (view !== null) assert.equal(validPresence({ ...presence, view }), false);
  }
  for (const laser of [{ x: NaN, y: 0 }, { x: 0, y: "1" }, { x: 1e7, y: 0 }]) assert.equal(validPresence({ ...presence, laser }), false);
  assert.equal(validPresence({ ...presence, selection: Array(65).fill("id") }), false);
  assert.equal(validPresence({ ...presence, selection: ["x".repeat(129)] }), false);
  assert.equal(viewFromCamera({ x: 0, y: 0, zoom: 0 }, 800, 600), null);
  assert.equal(viewFromCamera({ x: 0, y: 0, zoom: 1 }, 0, 600), null);
  assert.equal(cameraAtView(presence.view, NaN, 600), null);
});
