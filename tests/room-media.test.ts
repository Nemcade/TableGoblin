import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { roomMedia } from "../src/room-media.ts";
import { emptySharedTable, parseSharedTable, sharedSnapshot } from "../src/room-state.ts";
import { parseSnapshot } from "../src/table-storage.ts";
import { createSurface } from "../src/model.ts";
import { applyChanges } from "../src/room-operations.ts";
const { inspectMedia } = createRequire(import.meta.url)("../scripts/room-media.cjs");

test("room media accepts only private references; pending blobs are client-side only", () => {
  const ref = `/api/rooms/0123456789abcdef/media/${"a".repeat(64)}.mp4`;
  assert.equal(roomMedia(ref)?.room, "0123456789abcdef");
  for (const invalid of ["https://example.com" + ref, "//example.com" + ref, ref + "?token=abc", ref.replace("media", "../media"), ref.replace(".mp4", ".html")]) assert.equal(roomMedia(invalid), null);
  const table = emptySharedTable(), obj = createSurface("audio", { x: 0, y: 0 }); obj.audio = ref; table.scene.objects.push(obj);
  assert.ok(parseSharedTable(table)); assert.equal(parseSnapshot(sharedSnapshot(table)), null);
  obj.audio = "blob:pending-file"; assert.equal(parseSharedTable(table), null); assert.ok(parseSharedTable(table, true));
  const changes = [{ key: `object:${obj.id}`, value: obj }];
  assert.equal(applyChanges(emptySharedTable(), changes), null); assert.ok(applyChanges(emptySharedTable(), changes, true));
  obj.audio = "https://example.com/file.mp4"; assert.equal(parseSharedTable(table, true), null);
  obj.audio = ref; obj.video = ref; assert.equal(parseSharedTable(table), null);
});

test("media container checks accept real audio-only MP4 and reject truncated or spoofed files", () => {
  const mp4 = readFileSync(new URL("./fixtures/audio-only.mp4", import.meta.url));
  assert.equal(inspectMedia(mp4), "mp4");
  for (const invalid of [Buffer.alloc(0), Buffer.from("<html>pretend media</html>"), mp4.subarray(0, 28), mp4.subarray(0, mp4.length - 1), Buffer.concat([mp4, Buffer.from("extra")])]) assert.equal(inspectMedia(invalid), null);
  const wav = Buffer.alloc(60); wav.write("RIFF"); wav.writeUInt32LE(52, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(16, 40); assert.equal(inspectMedia(wav), "wav");
  assert.equal(inspectMedia(wav.subarray(0, 58)), null); wav.writeUInt32LE(0, 40); assert.equal(inspectMedia(wav), null);
});
