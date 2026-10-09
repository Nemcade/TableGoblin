import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contains,
  containsSurface,
  createShape,
  copyHierarchy,
  pasteHierarchy,
  imagePlacement,
  applyCrop,
  createSurface,
  deleteSurfaces,
  drawOrder,
  findParent,
  overlap,
  reparent,
  toLocal,
  toWorld,
  worldTransform,
  type Scene,
  type Point,
} from "../src/model.ts";
const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const samePoint = (a: Point, b: Point) => {
  near(a.x, b.x);
  near(a.y, b.y);
};
const setup = () => {
  const paper = createSurface("paper", { x: 160, y: 80 });
  paper.width = 600;
  paper.height = 400;
  paper.rotation = 0.38;
  const card = createSurface("card", { x: 185, y: 90 });
  return {
    paper,
    card,
    scene: { objects: [paper, card], strokes: [] } as Scene,
  };
};

test("shape hit testing excludes invisible corners, including after rotation", () => {
  for (const shape of [
    "circle",
    "triangle",
    "hexagon",
    "diamond",
    "rounded",
  ] as const) {
    const obj = createShape(shape, { x: 30, y: 20 });
    obj.rotation = 0.8;
    assert.ok(containsSurface(toWorld({ x: 0, y: 0 }, obj), obj, obj));
    assert.equal(
      containsSurface(toWorld({ x: 0.49, y: -0.49 }, obj), obj, obj),
      false,
    );
  }
});
test("shape overlap measures the actual circular and polygon footprint", () => {
  const t = { x: 0, y: 0, width: 100, height: 100, rotation: 0 };
  near(overlap(t, t, "circle", "circle"), 1);
  near(overlap(t, t, "triangle", "rectangle"), 1);
  near(overlap(t, { ...t, x: 100 }, "circle", "circle"), 0);
  assert.ok(
    overlap(t, { ...t, x: 30 }, "circle", "circle") <
      overlap(t, { ...t, x: 30 }),
  );
});
test("copy/paste gives an entire nested stack fresh identities and world-space roots", () => {
  const { paper, card, scene } = setup();
  reparent(scene, card, paper.id);
  const token = createShape("circle", { x: 180, y: 90 });
  token.image = "data:image/png;base64,a";
  token.imageView = { x: 0.1, y: 0, zoom: 2 };
  token.strokes = [
    {
      id: "ink",
      points: [{ x: 0, y: 0 }],
      color: "#fff",
      width: 0.01,
      highlight: false,
    },
  ];
  scene.objects.push(token);
  reparent(scene, token, card.id);
  paper.rotation += 0.9;
  const world = worldTransform(scene, card);
  const contents = copyHierarchy(scene, new Set([card.id, token.id]));
  assert.equal(contents.length, 2);
  samePoint(contents[0], world);
  assert.equal(contents[0].parentId, null);
  const ids = pasteHierarchy(scene, contents, { x: 40, y: 55 });
  assert.equal(ids.length, 1);
  const root = scene.objects.find((o) => o.id === ids[0])!;
  samePoint(root, { x: world.x + 40, y: world.y + 55 });
  const child = scene.objects.find((o) => o.parentId === root.id)!;
  assert.notEqual(child.id, token.id);
  assert.notEqual(child.strokes[0].id, "ink");
  assert.equal(child.image, token.image);
  assert.deepEqual(child.imageView, token.imageView);
  near(child.x, token.x);
  assert.equal(token.parentId, card.id);
});
test("token image framing fills the shape and clamps pan to avoid blank edges", () => {
  const p = imagePlacement(100, 100, 200, 100, { x: 100, y: -100, zoom: 1 });
  near(p.width, 200);
  near(p.height, 100);
  near(p.view.x, 0.5);
  near(p.view.y, 0);
  const q = imagePlacement(100, 100, 100, 200, { x: 1, y: 1, zoom: 2 });
  assert.ok(q.x <= -50 && q.y <= -50);
  assert.ok(q.x + q.width >= 50 && q.y + q.height >= 50);
});
test("crop preserves source registration of existing marks and aspect ratio", () => {
  const o = createSurface("screen", { x: 0, y: 0 });
  o.width = 400;
  o.height = 200;
  o.sourceWidth = 1000;
  o.sourceHeight = 500;
  o.strokes = [
    {
      id: "a",
      points: [
        { x: 0, y: 0 },
        { x: 0.2, y: -0.1 },
      ],
      color: "#fff",
      width: 0.02,
      highlight: false,
    },
  ];
  applyCrop(o, { x: 0.1, y: 0.2, width: 0.8, height: 0.6 });
  near(o.height, 150);
  near(o.strokes[0].points[0].x, 0);
  near(o.strokes[0].points[0].y, 0);
  near(o.strokes[0].points[1].x, 0.25);
  near(o.strokes[0].points[1].y, -1 / 6);
  applyCrop(o, { x: 0, y: 0, width: 1, height: 1 });
  near(o.height, 200);
  near(o.strokes[0].points[1].x, 0.2);
  near(o.strokes[0].points[1].y, -0.1);
});
test("rotated coordinate spaces round-trip without drifting", () => {
  const { paper } = setup();
  const p = { x: 0.27, y: -0.19 };
  samePoint(toLocal(toWorld(p, paper), paper), p);
  assert.ok(contains(toWorld(p, paper), paper));
  assert.ok(!contains(toWorld({ x: 0.6, y: 0 }, paper), paper));
});
test("attachment, rotation, and detachment preserve world placement", () => {
  const { paper, card, scene } = setup();
  const before = worldTransform(scene, card);
  reparent(scene, card, paper.id);
  samePoint(worldTransform(scene, card), before);
  near(worldTransform(scene, card).rotation, before.rotation);
  paper.x += 90;
  paper.y -= 70;
  const moved = worldTransform(scene, card);
  near(moved.x, before.x + 90);
  near(moved.y, before.y - 70);
  paper.rotation += 0.7;
  const rotated = worldTransform(scene, card);
  reparent(scene, card, null);
  samePoint(worldTransform(scene, card), rotated);
  near(card.rotation, rotated.rotation);
});
test("deep descendants follow composed transforms and leave together", () => {
  const { paper, card, scene } = setup();
  reparent(scene, card, paper.id);
  const token = createSurface("card", { x: 190, y: 80 });
  token.width = 20;
  token.height = 20;
  scene.objects.push(token);
  reparent(scene, token, card.id);
  paper.rotation = 1.1;
  const tokenWorld = worldTransform(scene, token);
  reparent(scene, card, null);
  samePoint(worldTransform(scene, token), tokenWorld);
  const before = worldTransform(scene, token);
  reparent(scene, token, null);
  samePoint(worldTransform(scene, token), before);
});
test("resizing a parent scales positions and drawings but keeps child dimensions", () => {
  const { paper, card, scene } = setup();
  reparent(scene, card, paper.id);
  const local = { x: card.x, y: card.y };
  const stroke = { x: 0.3, y: 0.2 };
  const before = toWorld(stroke, paper);
  paper.width *= 2;
  paper.height *= 2;
  const child = worldTransform(scene, card);
  samePoint(child, toWorld(local, paper));
  near(child.width, 180);
  near(child.height, 120);
  const after = toWorld(stroke, paper);
  near(after.x - paper.x, 2 * (before.x - paper.x));
  near(after.y - paper.y, 2 * (before.y - paper.y));
});
test("polygon overlap rejects touching and accepts intentional rotated placement", () => {
  const { paper, card, scene } = setup();
  assert.ok(overlap(card, paper) > 0.99);
  assert.equal(findParent(scene, card)?.id, paper.id);
  card.x = 1000;
  assert.equal(findParent(scene, card), undefined);
  assert.equal(overlap(card, paper), 0);
  const t = { x: 0, y: 0, width: 100, height: 100, rotation: 0 };
  near(overlap(t, { ...t, x: 100 }), 0);
  near(overlap(t, { ...t, x: 50 }), 0.5);
  const r = { ...t, rotation: Math.PI / 4 };
  near(overlap(r, t), 2 * Math.SQRT2 - 2);
});
test("the highest valid underlying surface wins and cycles are prevented", () => {
  const { paper, card, scene } = setup();
  reparent(scene, card, paper.id);
  const token = createSurface("card", { x: 185, y: 90 });
  token.width = 30;
  token.height = 30;
  scene.objects.push(token);
  assert.equal(findParent(scene, token)?.id, card.id);
  reparent(scene, token, card.id);
  reparent(scene, paper, token.id);
  assert.equal(paper.parentId, null);
  assert.deepEqual(
    drawOrder(scene).map((o) => o.id),
    [paper.id, card.id, token.id],
  );
});
test("removing a rotated parent releases contents without deleting them", () => {
  const { paper, card, scene } = setup();
  reparent(scene, card, paper.id);
  paper.rotation = 1.7;
  const before = worldTransform(scene, card);
  deleteSurfaces(scene, new Set([paper.id]));
  assert.equal(scene.objects.length, 1);
  assert.equal(card.parentId, null);
  samePoint(card, before);
  near(card.rotation, before.rotation);
});
test("deleting several ancestors still preserves surviving descendants", () => {
  const { paper, card, scene } = setup();
  reparent(scene, card, paper.id);
  const token = createSurface("card", { x: 190, y: 80 });
  scene.objects.push(token);
  reparent(scene, token, card.id);
  paper.rotation = 2;
  const before = worldTransform(scene, token);
  deleteSurfaces(scene, new Set([paper.id, card.id]));
  assert.equal(scene.objects.length, 1);
  assert.equal(token.parentId, null);
  samePoint(token, before);
  near(token.rotation, before.rotation);
});
