import { test } from "node:test";
import assert from "node:assert/strict";
import { ROOM_PROTOCOL, emptySharedTable, parseSharedTable, playerSceneAllowed, readRoomState } from "../src/room-state.ts";
import { createShape } from "../src/model.ts";

test("room decoding preserves old-server tables without inventing writable metadata", () => {
  const table = emptySharedTable(); table.scene.objects.push(createShape("circle", { x: 10, y: 20 }));
  const me = { id: "player", name: "Player", color: "#224466", role: "player", online: true };
  const old = { id: "0123456789abcdef", title: "Old room", revision: 1, playerEditing: true, me, participants: [me], presence: [], table };
  const read = readRoomState(old)!;
  assert.equal(read.protocol, 0); assert.deepEqual(read.history, { undo: false, redo: false }); assert.deepEqual(read.accepted, []);
  assert.deepEqual(read.table, table);
  const moved = structuredClone(table); moved.scene.objects[0].x = 50;
  const event = readRoomState({ revision: 2, table: moved, actor: "gm" }, read)!;
  assert.equal(event.me.id, "player"); assert.equal(event.protocol, 0); assert.equal(event.table.scene.objects[0].x, 50);
  const current = { ...old, protocol: ROOM_PROTOCOL, versions: {}, history: { undo: true, redo: false }, accepted: [] };
  assert.equal(readRoomState(current)!.protocol, ROOM_PROTOCOL);
  assert.equal(readRoomState({ ...current, history: undefined }), null, "A malformed current server cannot silently bypass metadata checks");
  assert.equal(readRoomState({ revision: 2, table: moved }, readRoomState(current)!), null);
  assert.equal(readRoomState({ ...old, table: { scene: { objects: [null] } } }), null);
});

test("room validation keeps static artwork and excludes local media references and GM view preferences", () => {
  const table = emptySharedTable(), obj = createShape("circle", { x: 20, y: 30 });
  obj.image = "data:image/png;base64,dGVzdA==";
  table.scene.objects.push(obj); table.obscure.gm = true; table.obscure.gmOpacity = .9;
  const copy = parseSharedTable(table)!;
  assert.equal(copy.scene.objects[0].image, obj.image);
  assert.equal(copy.obscure.gm, false); assert.equal(copy.obscure.gmOpacity, .28);
  for (const image of ["blob:test", "https://example.com/secret", "data:image/svg+xml;base64,dGVzdA=="]) {
    obj.image = image; assert.equal(parseSharedTable(table), null);
  }
  delete obj.image; obj.video = "blob:local"; assert.equal(parseSharedTable(table), null);
  delete obj.video; obj.sourceId = "camera"; assert.equal(parseSharedTable(table), null);
  assert.equal(parseSharedTable({ ...table, scene: { objects: [null], strokes: [] } }), null);
});
test("player editing protects locked objects, their ancestors and lock settings", () => {
  const parent = createShape("rectangle", { x: 0, y: 0 }), child = createShape("circle", { x: 0, y: 0 });
  child.parentId = parent.id; child.locked = true;
  const before = { objects: [parent, child], strokes: [] };
  const next = structuredClone(before); next.objects[0].x = 50;
  assert.equal(playerSceneAllowed(before, next), false, "A protected child cannot be moved via its parent");
  next.objects[0].x = 0; next.objects[1].locked = false;
  assert.equal(playerSceneAllowed(before, next), false);
  next.objects.pop(); assert.equal(playerSceneAllowed(before, next), false);
  const free = createShape("circle", { x: 10, y: 10 }); next.objects = structuredClone(before.objects); next.objects.push(free);
  assert.equal(playerSceneAllowed(before, next), true);
  free.locked = true; assert.equal(playerSceneAllowed(before, next), false);
});
