import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { roomImage } from "../src/room-artwork.ts";
import { emptySharedTable, parseSharedTable, sharedSnapshot } from "../src/room-state.ts";
import { parseSnapshot } from "../src/table-storage.ts";
import { createShape } from "../src/model.ts";
const { raster } = createRequire(import.meta.url)("../scripts/room-assets.cjs");
test("room artwork references are restricted paths and never valid local saved content", () => {
  const image = `/api/rooms/0123456789abcdef/assets/${"a".repeat(64)}.png`;
  assert.equal(roomImage(image)?.room, "0123456789abcdef");
  for (const url of ["https://example.com" + image, "//example.com" + image, image + "?secret=yes", image.replace("assets", "../assets"), image.replace(".png", ".svg")]) assert.equal(roomImage(url), null);
  const table = emptySharedTable(), shape = createShape("circle", { x: 0, y: 0 }); shape.image = image; table.scene.objects.push(shape);
  assert.equal(parseSharedTable(table)?.scene.objects[0].image, image);
  assert.equal(parseSnapshot(sharedSnapshot(table)), null, "Local saves/imports require self-contained images");
});
test("raster storage rejects spoofed, truncated and oversized image containers", () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPioAAAAASUVORK5CYII=", "base64");
  assert.deepEqual(raster(png), { extension: "png", type: "image/png" });
  for (const bytes of [Buffer.alloc(0), Buffer.from("<svg>bad</svg>"), png.subarray(0, 45), Buffer.concat([png, Buffer.from("html")])]) assert.equal(raster(bytes), null);
  const huge = Buffer.from(png); huge.writeUInt32BE(20000, 16); assert.equal(raster(huge), null);
});
