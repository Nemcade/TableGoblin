import { test } from "node:test";
import assert from "node:assert/strict";
import { changePlayback, emptyRoomPlayback, parsePlaybackRequest, parseRoomPlayback, playbackPosition, reconcilePlayback, type PlaybackTrack } from "../src/room-playback.ts";
import { createSurface } from "../src/model.ts";
import { emptySharedTable } from "../src/room-state.ts";
const ref = `/api/rooms/0123456789abcdef/media/${"a".repeat(64)}.mp4`;
const track: PlaybackTrack = { object: "clip", ref, version: 1, position: 3, duration: 10, updatedAt: 1000, playing: true, loop: false };
const request = { id: "12345678-1234-1234-1234-123456789012", object: "clip", ref, version: 1, action: "seek" as const, duration: 10, position: 8 };
test("room playback follows an anchored clock, wraps loops, clamps endings and tolerates clock skew", () => {
  assert.deepEqual(playbackPosition(track, 3000), { position: 5, playing: true });
  assert.deepEqual(playbackPosition(track, 13000), { position: 10, playing: false });
  assert.deepEqual(playbackPosition({ ...track, loop: true }, 13000), { position: 5, playing: true });
  assert.equal(playbackPosition(track, 0).position, 3);
  assert.equal(playbackPosition({ ...track, duration: 0 }, 13000, 20).position, 15);
});
test("seek and pause retain the current transport intention; restart and replay begin at zero", () => {
  assert.deepEqual(changePlayback(track, request, 3000, 2), { ...track, version: 2, updatedAt: 3000, position: 8 });
  const paused = changePlayback(track, { ...request, action: "pause" }, 3000, 2);
  assert.equal(paused.position, 5); assert.equal(paused.playing, false);
  assert.equal(changePlayback(paused, request, 5000, 3).playing, false);
  assert.equal(changePlayback(track, { ...request, action: "restart" }, 3000, 2).position, 0);
  assert.equal(changePlayback(track, { ...request, action: "play" }, 13000, 2).position, 0);
});
test("object movement preserves transport; deletion, replacement and copies get independent anchors", () => {
  const table = emptySharedTable(), audio = createSurface("audio", { x: 0, y: 0 }); audio.audio = ref; table.scene.objects.push(audio);
  const first = reconcilePlayback(emptyRoomPlayback(), table, 1000); assert.equal(first.tracks[0].playing, false);
  audio.x = 99; assert.equal(reconcilePlayback(first, table, 2000), first);
  table.scene.objects.push({ ...audio, id: "copy" }); const copies = reconcilePlayback(first, table, 2000);
  assert.equal(copies.tracks[0].updatedAt, 1000); assert.equal(copies.tracks[1].updatedAt, 2000);
  audio.audio = ref.replace("a".repeat(64), "b".repeat(64)); const replaced = reconcilePlayback(copies, table, 3000);
  assert.equal(replaced.tracks[0].updatedAt, 3000); assert.ok(replaced.tracks[0].version > first.tracks[0].version);
  table.scene.objects = []; assert.deepEqual(reconcilePlayback(replaced, table, 4000).tracks, []);
});
test("playback boundaries reject forged references, bad times, duplicate targets and invalid versions", () => {
  assert.ok(parsePlaybackRequest(request)); assert.ok(parseRoomPlayback({ sequence: 1, tracks: [track] }));
  for (const patch of [{ position: -1 }, { position: Infinity }, { position: 11 }, { duration: 0 }, { duration: 604801 }, { ref: "blob:local" }, { version: -1 }, { action: "loop", loop: "yes" }]) assert.equal(parsePlaybackRequest({ ...request, ...patch }), null);
  assert.equal(parseRoomPlayback({ sequence: 1, tracks: [track, track] }), null);
  assert.equal(parseRoomPlayback({ sequence: 0, tracks: [track] }), null);
  assert.equal(parseRoomPlayback({ sequence: 1, tracks: [{ ...track, position: 11 }] }), null);
});
