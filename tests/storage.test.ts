import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultMood } from "../src/mood.ts";
import { defaultDiceGroup } from "../src/dice-types.ts";
import { defaultGrid, defaultObscure } from "../src/table-widgets.ts";
import { createShape } from "../src/model.ts";
import { parseScene, parseSnapshot, snapshotIssue, storedIssue, recoverVideoMetadata, validateStored, readTableFile, type TableSnapshot } from "../src/table-storage.ts";
const empty = (): TableSnapshot => ({ version: 1, scene: { objects: [], strokes: [] }, mood: { ...defaultMood }, dice: { color: null, fontColor: null, groups: [defaultDiceGroup()], enabled: true, sound: false, activeGroup: "main", history: [] }, grid: { ...defaultGrid }, obscure: { ...defaultObscure, regions: [] }, measurement: null, camera: { x: 720, y: 450, zoom: 1, width: 1440, height: 900 }, pen: { color: "#b66b45", thickness: 3, smoothing: .55, transforms: true } });
test("GM cover opacity persists, accepts old tables and rejects invalid values", () => {
  const s = empty();
  s.obscure.gmOpacity = .72;
  assert.equal(parseSnapshot(s)!.obscure.gmOpacity, .72);
  delete s.obscure.gmOpacity;
  assert.ok(parseSnapshot(s), "Tables with the original fixed GM opacity still load");
  for (const value of [-.1, 1.1, NaN, Infinity, "0.5", null]) {
    assert.match(snapshotIssue({ ...s, obscure: { ...s.obscure, gmOpacity: value } })!, /GM cover opacity/);
  }
});
test("table snapshots validate empty tables and preserve nested objects, art, drawings and settings", () => {
  const s = empty(), parent = createShape("rectangle", { x: 20, y: -10 }), child = createShape("circle", { x: .1, y: -.2 });
  child.parentId = parent.id; child.image = "data:image/png;base64,test"; child.imageView = { x: 0, y: 0, zoom: 2 };
  child.strokes = [{ id: "stroke", color: "#123456", width: .03, highlight: false, points: [{ x: 0, y: 0 }, { x: .1, y: .3 }] }];
  s.scene.objects.push(parent, child); s.obscure.regions.push({ mode: "reveal", points: [{ x: 0, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 30 }] });
  const copy = parseSnapshot(s)!; assert.deepEqual(copy, s); copy.scene.objects[0].x = 99; assert.equal(s.scene.objects[0].x, 20);
  assert.ok(parseSnapshot(empty()));
  assert.equal(parseSnapshot({ ...s, version: 9 }), null);
  assert.equal(parseSnapshot({ ...s, camera: { ...s.camera, zoom: NaN } }), null);
  assert.equal(parseSnapshot({ ...s, dice: { ...s.dice, activeGroup: "gone" } }), null);
});
test("invalid scene references and corrupt table files cannot replace existing work", async () => {
  const s = empty(), a = createShape("circle", { x: 0, y: 0 }), b = createShape("circle", { x: 0, y: 0 });
  s.scene.objects.push(a, b); a.parentId = b.id; b.parentId = a.id;
  assert.equal(parseScene(s.scene), null); a.parentId = "missing"; b.parentId = null; assert.equal(parseScene(s.scene), null);
  a.parentId = null; b.id = a.id; assert.equal(parseScene(s.scene), null);
  assert.equal(parseScene({ objects: [], strokes: [{ id: "bad", color: "#fff", width: 3, highlight: false, points: [{ x: NaN, y: 0 }] }] }), null);
  await assert.rejects(readTableFile(new File(["{}"], "bad.json")));
});
test("locks persist in snapshots while malformed lock flags are rejected", () => {
  const s = empty(), obj = createShape("rectangle", { x: 0, y: 0 });
  s.scene.objects.push(obj);
  assert.ok(parseSnapshot(s), "Older objects without a lock flag remain valid");
  obj.locked = true;
  assert.equal(parseSnapshot(s)!.scene.objects[0].locked, true);
  assert.equal(parseScene({ ...s.scene, objects: [{ ...obj, locked: "yes" }] }), null);
});
test("portable video assets restore as blobs, and missing assets reject the whole snapshot", async () => {
  const s = empty(), video = { ...createShape("rectangle", { x: 0, y: 0 }), kind: "video" as const, video: "asset:clip" };
  s.scene.objects.push(video);
  assert.equal(validateStored({ snapshot: s, assets: [] }), null);
  assert.equal(validateStored({ snapshot: s, assets: [{ key: "clip", blob: new Blob(["video"], { type: "text/html" }) }] }), null);
  const file = new File([JSON.stringify({ app: "table-goblin", version: 1, snapshot: s, assets: [{ key: "clip", data: "data:video/webm;base64,dmlkZW8=" }] })], "table.goblin.json");
  const loaded = await readTableFile(file);
  assert.equal(loaded.assets[0].blob.type, "video/webm"); assert.equal(await loaded.assets[0].blob.text(), "video");
  assert.deepEqual(loaded.snapshot, s);
});
test("load diagnostics identify the rejected section or named object without changing the saved record", () => {
  const s = empty(), token = createShape("circle", { x: 0, y: 0 });
  token.name = "Hero"; token.image = "data:image/png;base64,test";
  token.imageView = { x: 0, y: 0, zoom: 0 }; s.scene.objects.push(token);
  const original = structuredClone(s);
  assert.match(snapshotIssue(s)!, /Hero.*artwork framing/);
  assert.deepEqual(s, original);
  token.imageView.zoom = 1;
  assert.equal(snapshotIssue(s), null);
  s.camera.zoom = NaN; assert.match(snapshotIssue(s)!, /view settings/);
  s.camera.zoom = 1; s.dice.activeGroup = "gone";
  assert.match(snapshotIssue(s)!, /dice selection/);
  s.dice.activeGroup = "main"; s.mood.saturation = 120;
  assert.match(snapshotIssue(s)!, /theme settings/);
  s.mood.saturation = 7;
  assert.match(storedIssue({ snapshot: s, assets: null })!, /media list/);
});
test("stopped sources and locked image tokens remain valid without active streams", () => {
  const s = empty(), camera = { ...createShape("rectangle", { x: 0, y: 0 }), kind: "camera" as const, sourceId: "stopped", sourceWidth: 640, sourceHeight: 360 };
  const token = createShape("circle", { x: .2, y: .1 });
  token.parentId = camera.id; token.image = "data:image/png;base64,test";
  token.imageView = { x: .1, y: -.2, zoom: 1.7 }; token.locked = true;
  s.scene.objects.push(camera, token);
  assert.equal(storedIssue({ snapshot: s, assets: [] }), null);
  assert.deepEqual(validateStored({ snapshot: s, assets: [] })!.snapshot.scene, s.scene);
});
test("legacy video imports with zero dimensions recover without dropping objects, media or settings", () => {
  const snapshot = empty(), token = createShape("circle", { x: 100, y: 20 }); token.locked = true;
  const video = { ...createShape("rectangle", { x: 20, y: 30 }), kind: "video" as const, name: "hmmm", width: 480, height: NaN, sourceWidth: 0, sourceHeight: 0, video: "asset:ghost" };
  snapshot.scene.objects.push(video, token);
  const original = { snapshot, assets: [{ key: "ghost", blob: new Blob(["media"], { type: "video/webm" }) }] };
  const recovered = recoverVideoMetadata(original)!;
  assert.ok(recovered); assert.equal(recovered.snapshot.scene.objects.length, 2);
  assert.equal(recovered.snapshot.scene.objects[0].height, 270);
  assert.equal(recovered.snapshot.scene.objects[0].sourceWidth, undefined);
  assert.deepEqual(recovered.snapshot.scene.objects[1], token);
  assert.deepEqual(recovered.snapshot.mood, snapshot.mood);
  assert.equal(recovered.assets[0].blob.size, original.assets[0].blob.size);
  assert.ok(Number.isNaN(video.height), "Recovery leaves the original record untouched");
  assert.equal(recoverVideoMetadata({ ...original, assets: [] }), null, "Missing media is not guessed");
  video.x = NaN;
  assert.equal(recoverVideoMetadata(original), null, "Unrelated corrupt placement is not guessed");
});
test("audio surfaces and playback preferences persist with their media, including audio-only MP4", async () => {
  const snapshot = empty(), audio = { ...createShape("rectangle", { x: 20, y: 30 }), kind: "audio" as const, audio: "asset:sound", filename: "Pocket sound.mp4", volume: .4, loop: true, paused: true };
  snapshot.scene.objects.push(audio);
  const assets = [{ key: "sound", blob: new Blob(["audio"], { type: "video/mp4" }) }];
  assert.deepEqual(validateStored({ snapshot, assets })!.snapshot.scene.objects[0], audio);
  assert.equal(validateStored({ snapshot, assets: [] }), null);
  const file = new File([JSON.stringify({ app: "table-goblin", version: 1, snapshot, assets: [{ key: "sound", data: "data:audio/mp4;base64,YXVkaW8=" }] })], "sound.goblin.json");
  const restored = await readTableFile(file);
  assert.equal(await restored.assets[0].blob.text(), "audio");
  assert.equal(restored.snapshot.scene.objects[0].loop, true);
  audio.volume = NaN; assert.equal(parseScene(snapshot.scene), null);
});
