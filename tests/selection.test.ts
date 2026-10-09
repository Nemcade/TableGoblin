import { test } from "node:test";
import assert from "node:assert/strict";
import { createShape, marqueeSelection, worldTransform, type Scene } from "../src/model.ts";

test("marquee selects intersecting footprints in either drag direction", () => {
  const a = createShape("rectangle", { x: 0, y: 0 }), b = createShape("rectangle", { x: 200, y: 0 });
  Object.assign(a, { width: 80, height: 60 }); Object.assign(b, { width: 80, height: 60 });
  const scene: Scene = { objects: [a, b], strokes: [] };
  assert.deepEqual(marqueeSelection(scene, { x: -60, y: -50 }, { x: 170, y: 50 }), [a.id, b.id]);
  assert.deepEqual(marqueeSelection(scene, { x: 170, y: 50 }, { x: -60, y: -50 }), [a.id, b.id]);
  assert.deepEqual(marqueeSelection(scene, { x: 40, y: 40 }, { x: 40, y: 80 }), []);
});
test("marquee excludes empty corners of circular and triangular shapes", () => {
  for (const shape of ["circle", "triangle"] as const) {
    const obj = createShape(shape, { x: 0, y: 0 }); Object.assign(obj, { width: 100, height: 100 });
    const scene: Scene = { objects: [obj], strokes: [] };
    assert.deepEqual(marqueeSelection(scene, { x: 40, y: -48 }, { x: 48, y: -40 }), []);
    assert.deepEqual(marqueeSelection(scene, { x: -5, y: -5 }, { x: 5, y: 5 }), [obj.id]);
  }
});
test("marquee follows rotated nested surfaces in world coordinates", () => {
  const parent = createShape("rectangle", { x: 300, y: 200 }), child = createShape("rectangle", { x: 0.25, y: 0 });
  Object.assign(parent, { width: 400, height: 240, rotation: Math.PI / 2 });
  Object.assign(child, { parentId: parent.id, width: 40, height: 20, rotation: Math.PI / 4 });
  const scene: Scene = { objects: [parent, child], strokes: [] }, t = worldTransform(scene, child);
  assert.deepEqual(marqueeSelection(scene, { x: t.x - 5, y: t.y - 5 }, { x: t.x + 5, y: t.y + 5 }), [parent.id, child.id]);
  assert.deepEqual(marqueeSelection(scene, { x: 0, y: 0 }, { x: 30, y: 30 }), []);
});
test("locked backgrounds are excluded while their unlocked children remain selectable", () => {
  const map = createShape("rectangle", { x: 0, y: 0 }), token = createShape("circle", { x: 0, y: 0 });
  Object.assign(map, { locked: true, width: 600, height: 400 });
  Object.assign(token, { parentId: map.id, width: 50, height: 50 });
  const scene: Scene = { objects: [map, token], strokes: [] };
  assert.deepEqual(marqueeSelection(scene, { x: -60, y: -60 }, { x: 60, y: 60 }), [token.id]);
  token.locked = true;
  assert.deepEqual(marqueeSelection(scene, { x: -60, y: -60 }, { x: 60, y: 60 }), []);
});
