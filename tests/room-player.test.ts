import { test } from "node:test";
import assert from "node:assert/strict";
import { RoomFilePlayer } from "../src/room-player.ts";
import { createSurface } from "../src/model.ts";
import type { RoomPlayback } from "../src/room-playback.ts";
const ref = `/api/rooms/0123456789abcdef/media/${"a".repeat(64)}.ogg`;
function fixture(t: any, loop = false) {
  let now = 1000, currentTime = 0;
  t.mock.method(performance, "now", () => now);
  const player = new RoomFilePlayer(() => {}), obj = createSurface("audio", { x: 0, y: 0 }); obj.audio = ref;
  const media = { duration: 60, readyState: 4, paused: false, seeking: false, playbackRate: 1, muted: false, volume: 1, loop: false,
    seeks: [] as number[], get currentTime() { return currentTime; }, set currentTime(value: number) { currentTime = value; this.seeks.push(value); },
    pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); } };
  let state: RoomPlayback = { sequence: 1, tracks: [{ object: obj.id, ref, version: 1, position: 0, duration: 60, updatedAt: 100000, playing: true, loop }] };
  player.apply(state, 100000); player.sync(obj, media as unknown as HTMLMediaElement);
  return { player, obj, media, state, at(time: number, position: number) { now = time; currentTime = position; },
    sync() { player.sync(obj, media as unknown as HTMLMediaElement); } };
}
test("delayed table updates and duplicate responses never rewind uninterrupted music", t => {
  const f = fixture(t);
  for (let i = 1; i <= 40; i++) {
    f.at(1000 + i * 250, i / 4);
    f.player.apply(structuredClone(f.state), 100000 + i * 250 - [0, 900, 650, 1200][i % 4]);
    f.sync();
    assert.equal(f.player.position(f.obj)!.position, i / 4);
    assert.equal(f.media.playbackRate, 1);
  }
  assert.deepEqual(f.media.seeks, []);
});
test("small playback drift adjusts speed without seeking; large drift and explicit seeks still catch up", t => {
  const f = fixture(t);
  f.at(2000, .5); f.sync(); assert.equal(f.media.playbackRate, 1.03); assert.deepEqual(f.media.seeks, []);
  f.at(2250, 1.8); f.sync(); assert.equal(f.media.playbackRate, .97); assert.deepEqual(f.media.seeks, []);
  f.at(2500, 1.5); f.sync(); assert.equal(f.media.playbackRate, 1);
  f.at(3000, 1); f.sync(); assert.deepEqual(f.media.seeks, [2]);
  f.player.apply({ sequence: 2, tracks: [{ ...f.state.tracks[0], version: 2, position: 2.2, updatedAt: 102000 }] }, 102000);
  f.sync(); assert.deepEqual(f.media.seeks, [2, 2.2], "Even a small deliberate seek is applied");
});
test("buffering and in-flight seeks are allowed to finish, while paused commands stay exact", t => {
  const f = fixture(t);
  f.at(7000, 0); f.media.readyState = 2; f.sync(); assert.deepEqual(f.media.seeks, []);
  f.media.readyState = 4; f.media.seeking = true; f.at(7250, 0); f.sync(); assert.deepEqual(f.media.seeks, []);
  f.media.seeking = false; f.sync(); assert.deepEqual(f.media.seeks, [6.25]);
  f.player.apply({ sequence: 2, tracks: [{ ...f.state.tracks[0], version: 2, position: 7, updatedAt: 106250, playing: false }] }, 106250);
  f.sync(); assert.equal(f.media.currentTime, 7); assert.equal(f.media.paused, true); assert.equal(f.media.playbackRate, 1);
});
test("loop boundaries use the nearest phase; leaving a room clears clock and speed correction", t => {
  const f = fixture(t, true);
  f.at(61100, 59.9); f.sync(); assert.deepEqual(f.media.seeks, []); assert.equal(f.media.playbackRate, 1.03);
  f.player.clear(); assert.equal(f.media.playbackRate, 1);
  f.at(80000, 0); f.player.apply(f.state, 100000); f.sync();
  assert.equal(f.player.position(f.obj)!.position, 0, "A new room gets a fresh clock sample");
});
