import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySharedTable } from "../src/room-state.ts";
import { createShape } from "../src/model.ts";
import { assignNewAccess, editsAllowed } from "../src/room-permissions.ts";

test("ownership and specific editors allow changes independently from creation permission", () => {
  const before = emptySharedTable(), piece = createShape("circle", { x: 0, y: 0 }); before.scene.objects.push(piece);
  const access = assignNewAccess(before, {}, "alice"), after = structuredClone(before); after.scene.objects[0].x = 25;
  assert.equal(editsAllowed(before, after, access, "alice", false, false), true);
  assert.equal(editsAllowed(before, after, access, "bob", false, true), false);
  access[`object:${piece.id}`].editors = ["bob"];
  assert.equal(editsAllowed(before, after, access, "bob", false, false), true);
  after.scene.objects.push(createShape("circle", { x: 30, y: 30 }));
  assert.equal(editsAllowed(before, after, access, "bob", false, false), false);
  assert.equal(editsAllowed(before, after, access, "bob", false, true), true);
});
test("protected child placement cannot be changed through a shared parent", () => {
  const before = emptySharedTable(), parent = createShape("rectangle", { x: 0, y: 0 }), child = createShape("circle", { x: 0, y: 0 });
  child.parentId = parent.id; before.scene.objects.push(parent, child);
  const access = assignNewAccess(before, {}, "gm"); access[`object:${parent.id}`].shared = true;
  let after = structuredClone(before); after.scene.objects[0].rotation = .5;
  assert.equal(editsAllowed(before, after, access, "player", false, true), false);
  after = structuredClone(before); after.scene.objects[0].color = "#112233";
  assert.equal(editsAllowed(before, after, access, "player", false, true), true);
  after.scene.objects.shift(); after.scene.objects[0].parentId = null;
  assert.equal(editsAllowed(before, after, access, "player", false, true), false);
});
test("locked background accepts independent tokens and protects its own placement", () => {
  const before = emptySharedTable(), map = createShape("rectangle", { x: 0, y: 0 }); map.locked = true; before.scene.objects.push(map);
  let access = assignNewAccess(before, {}, "gm"), after = structuredClone(before);
  const token = createShape("circle", { x: 0, y: 0 }); token.parentId = map.id; after.scene.objects.push(token);
  assert.equal(editsAllowed(before, after, access, "player", false, true), true);
  access = assignNewAccess(after, access, "player"); const moved = structuredClone(after); moved.scene.objects[1].x = .2;
  assert.equal(editsAllowed(after, moved, access, "player", false, false), true);
  moved.scene.objects[0].x = 20;
  assert.equal(editsAllowed(after, moved, access, "player", false, true), false);
});
test("freehand strokes belong to the artist, including restoration after deletion", () => {
  const before = emptySharedTable(); before.scene.strokes.push({ id: "ink", points: [{ x: 0, y: 0 }], color: "#112233", width: 3, highlight: false });
  const access = assignNewAccess(before, {}, "alice"), erased = structuredClone(before); erased.scene.strokes = [];
  assert.equal(editsAllowed(before, erased, access, "bob", false, true), false);
  assert.equal(editsAllowed(before, erased, access, "alice", false, false), true);
  assert.equal(editsAllowed(erased, before, access, "alice", false, false), true);
  assert.equal(editsAllowed(erased, before, access, "bob", false, true), false);
});
