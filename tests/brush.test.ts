import { test } from "node:test";
import assert from "node:assert/strict";
import { BrushSampler } from "../src/brush.ts";
import {
  copyHierarchy,
  pasteHierarchy,
  createSurface,
  type Scene,
} from "../src/model.ts";

test("brush fills sparse input evenly and preserves the exact release position", () => {
  const sampler = new BrushSampler({ x: 0, y: 0 }, 0, 0);
  const points = sampler.sample({ x: 10, y: 0 }, 16);
  assert.ok(points.length >= 14);
  points.forEach((p, i) => assert.ok(Math.abs(p.x - (i + 1) * 0.7) < 1e-8));
  assert.deepEqual(sampler.finish({ x: 10.2, y: 0.3 }).at(-1), {
    x: 10.2,
    y: 0.3,
  });
});
test("stabilization reduces slow sideways jitter while following the stroke", () => {
  const smooth = new BrushSampler({ x: 0, y: 0 }, 0, 1),
    direct = new BrushSampler({ x: 0, y: 0 }, 0, 0);
  const filtered = [],
    raw = [];
  for (let i = 1; i <= 80; i++) {
    const p = { x: i, y: i % 2 === 0 ? 2 : -2 };
    filtered.push(...smooth.sample(p, i * 8));
    raw.push(...direct.sample(p, i * 8));
  }
  const rms = (points: { y: number }[]) =>
    Math.sqrt(points.reduce((n, p) => n + p.y * p.y, 0) / points.length);
  assert.ok(rms(filtered) < rms(raw) * 0.7);
  assert.ok(filtered.at(-1)!.x > 75);
  assert.deepEqual(smooth.finish({ x: 80, y: 2 }).at(-1), { x: 80, y: 2 });
});
test("a tap does not gain an extra segment", () => {
  const sampler = new BrushSampler({ x: 3, y: 4 }, 0, 0.55);
  assert.deepEqual(sampler.sample({ x: 3, y: 4 }, 8), []);
  assert.deepEqual(sampler.finish({ x: 3, y: 4 }), []);
});
test("camera copies share the original live resource through multiple generations", () => {
  const camera = createSurface("camera", { x: 0, y: 0 });
  const scene: Scene = { objects: [camera], strokes: [] };
  const [copy] = pasteHierarchy(
    scene,
    copyHierarchy(scene, new Set([camera.id])),
    { x: 20, y: 20 },
  );
  const [second] = pasteHierarchy(
    scene,
    copyHierarchy(scene, new Set([copy])),
    { x: 20, y: 20 },
  );
  assert.equal(scene.objects.find((o) => o.id === second)!.sourceId, camera.id);
});
