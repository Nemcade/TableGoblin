import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { createSurface } from "../src/model.ts";
import { emptySharedTable, parseSharedTable } from "../src/room-state.ts";
const { createLive } = createRequire(import.meta.url)("../scripts/room-live.cjs");
function fixture() {
  const gm = { id: randomUUID(), role: "gm", name: "GM" }, player = { id: randomUUID(), role: "player", name: "Player" };
  const camera = createSurface("camera", { x: 0, y: 0 }), table = emptySharedTable(); table.scene.objects.push(camera);
  const room: any = { id: "0123456789abcdef", members: [gm, player], table, access: { [`object:${camera.id}`]: { owner: gm.id, shared: false, editors: [] } }, playerEditing: false };
  const a = { id: gm.id, client: randomUUID(), res: { destroyed: false } }, b = { id: player.id, client: randomUUID(), res: { destroyed: false } };
  const clients = new Map([[room.id, new Set([a, b])]]), sent: any[] = [], events: any[] = [];
  const live = createLive({ clients, send: (to: any, type: string, value: any) => sent.push({ to, type, value }), broadcast: (_room: any, type: string, value: any) => events.push({ type, value }),
    fail: (status: number, message: string) => { throw Object.assign(new Error(message), { status }); } });
  const publication = { action: "publish", client: a.client, source: camera.id, kind: "camera", label: "Camera", generation: randomUUID() };
  return { gm, player, camera, room, a, b, clients, live, sent, events, publication };
}
const status = (number: number) => (e: any) => e.status === number;
test("live surfaces serialize geometry and safe shared bindings, never arbitrary media URLs", () => {
  const table = emptySharedTable(), camera = createSurface("camera", { x: 0, y: 0 }); table.scene.objects.push(camera);
  assert.ok(parseSharedTable(table));
  table.scene.objects.push({ ...camera, id: randomUUID(), sourceId: camera.id }); assert.ok(parseSharedTable(table));
  camera.sourceId = "https://example.com/feed"; assert.equal(parseSharedTable(table), null);
  delete camera.sourceId; camera.video = "blob:private"; assert.equal(parseSharedTable(table, true), null);
});
test("live signaling is directed, bounded, role checked and protected against stale peer generations", () => {
  const f = fixture(), { live, room, gm, player, a, b, publication, sent, events } = f;
  assert.throws(() => live.request(room, player, { ...publication, client: b.client }), status(403));
  live.request(room, gm, publication);
  assert.throws(() => live.request(room, gm, { ...publication, client: randomUUID() }), status(409));
  const connection = randomUUID(), common = { source: publication.source, generation: publication.generation, connection };
  live.request(room, player, { ...common, action: "subscribe", client: b.client });
  const offer = { ...common, action: "signal", client: a.client, peer: b.client, message: { type: "offer", sdp: "v=0\r\n" } };
  live.request(room, gm, offer); assert.equal(sent.at(-1).to, b);
  assert.ok(!events.some((e: any) => JSON.stringify(e).includes("v=0")), "SDP is never broadcast");
  assert.throws(() => live.request(room, gm, { ...offer, connection: randomUUID() }), status(403));
  assert.throws(() => live.request(room, gm, { ...offer, message: { type: "offer", sdp: "v=0" + "x".repeat(65536) } }), status(400));
  assert.throws(() => live.request(room, gm, { ...offer, message: { type: "offer", sdp: "v=0", extra: "x".repeat(72000) } }), status(400));
  assert.throws(() => live.request(room, player, { ...offer, client: b.client, peer: a.client }), status(400));
  assert.throws(() => live.request(room, gm, { ...offer, message: { type: "ice", candidate: { candidate: "x", sdpMid: "0", sdpMLineIndex: -1 } } }), status(400));
  live.request(room, gm, { ...publication, generation: randomUUID() }); assert.throws(() => live.request(room, gm, offer), status(409));
  assert.throws(() => live.request(room, player, { ...publication, client: b.client, kind: "audio" }), status(400), "Audio cannot hijack a video binding");
});
test("live sources stop on ownership/creation revocation and disconnected sessions; copies preserve feeds", () => {
  const { live, room, gm, player, a, b, publication, clients, camera } = fixture();
  live.request(room, gm, publication);
  room.table.scene.objects.push({ ...camera, id: randomUUID(), sourceId: camera.id }); room.table.scene.objects.shift();
  room.access[`object:${room.table.scene.objects[0].id}`] = { owner: gm.id };
  live.reconcile(room); assert.equal(live.snapshot(room).sources.length, 1);
  room.access[`object:${room.table.scene.objects[0].id}`].owner = player.id;
  // GM retains authority; disconnected publishing browser still closes.
  clients.get(room.id).delete(a); live.disconnect(room, gm.id, a.client); assert.equal(live.snapshot(room).sources.length, 0);
  const audio = { action: "publish", client: b.client, source: randomUUID(), generation: randomUUID(), kind: "audio", label: "Input" };
  assert.throws(() => live.request(room, player, audio), status(403));
  room.playerEditing = true; live.request(room, player, audio); room.playerEditing = false; live.reconcile(room);
  assert.equal(live.snapshot(room).sources.length, 0);
});
