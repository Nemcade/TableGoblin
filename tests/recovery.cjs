const assert = require("node:assert/strict");
const fs = require("node:fs");
exports.testUI = async (existing) => {
  const context = await existing.context().browser().newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const saved = () => page.waitForFunction(() => document.querySelector(".local-status")?.textContent.includes("SAVED LOCALLY"));
  const read = () => page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open("table-goblin", 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try {
      const value = await new Promise((resolve, reject) => { const r = db.transaction("tables").objectStore("tables").get("current"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      return { snapshot: value.snapshot, assets: value.assets.map(({ key, blob }) => ({ key, blob: { size: blob.size, type: blob.type } })) };
    }
    finally { db.close(); }
  });
  try {
    await page.goto(existing.url()); await saved();
    const original = await page.evaluate(async () => {
      const db = await new Promise((resolve) => { const r = indexedDB.open("table-goblin", 1); r.onsuccess = () => resolve(r.result); });
      const value = await new Promise((resolve) => { const r = db.transaction("tables").objectStore("tables").get("current"); r.onsuccess = () => resolve(r.result); });
      const canvas = document.createElement("canvas"); canvas.width = 20; canvas.height = 20;
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "#b66b45"; ctx.fillRect(0, 0, 20, 20);
      value.snapshot.scene.objects = [
        { id: "camera", kind: "camera", name: "Stopped camera", x: -200, y: 0, width: 300, height: 200, rotation: 0, parentId: null, color: "#acbf9b", sourceId: "old-camera", sourceWidth: 640, sourceHeight: 360, strokes: [] },
        { id: "hero", kind: "shape", shape: "circle", name: "Hero", x: 200, y: 0, width: 100, height: 100, rotation: 0, parentId: null, color: "#acbf9b", locked: true, image: canvas.toDataURL(), sourceWidth: 20, sourceHeight: 20, imageView: { x: 0, y: 0, zoom: 0 }, strokes: [] },
      ];
      // Preserve media bytes as well as the rejected scene in the recovery download.
      value.assets = [{ key: "unused-media", blob: new Blob(["original media"], { type: "video/webm" }) }];
      await new Promise((resolve, reject) => { const tx = db.transaction("tables", "readwrite"); tx.objectStore("tables").put(value, "current"); tx.oncomplete = resolve; tx.onabort = reject; });
      db.close();
      return { ...value, assets: [{ key: "unused-media", blob: { blobType: "video/webm", data: "data:video/webm;base64,b3JpZ2luYWwgbWVkaWE=" } }] };
    });
    await page.reload();
    const panel = page.getByRole("alert", { name: "Saved table recovery" });
    await panel.waitFor();
    assert.match(await panel.textContent(), /Hero.*artwork framing/);
    assert.match(await page.locator(".local-status").textContent(), /NOT SAVED/);
    // Editing the empty in-memory table must not replace the original rejected save.
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("button", { name: "Shapes Pick a shape, give it a color" }).click();
    await page.getByRole("button", { name: "Add Rectangle", exact: true }).click();
    assert.deepEqual((await read()).snapshot, original.snapshot);
    const download = page.waitForEvent("download");
    await panel.getByRole("button", { name: "Export saved data", exact: true }).click();
    const file = ".test-artifacts/original-table.recovery.json";
    await (await download).saveAs(file);
    const exported = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(exported.original, original);
    assert.match(exported.issue, /Hero.*artwork framing/);
    await panel.getByRole("button", { name: "Retry", exact: true }).click();
    await panel.waitFor(); assert.deepEqual((await read()).snapshot, original.snapshot);
    await page.screenshot({ path: ".test-artifacts/recovery.png" });
    // Simulate repairing the diagnosed field; retry should restore rather than clear.
    await page.evaluate(async () => {
      const db = await new Promise((resolve) => { const r = indexedDB.open("table-goblin", 1); r.onsuccess = () => resolve(r.result); });
      const value = await new Promise((resolve) => { const r = db.transaction("tables").objectStore("tables").get("current"); r.onsuccess = () => resolve(r.result); });
      value.snapshot.scene.objects[1].imageView.zoom = 1;
      await new Promise((resolve) => { const tx = db.transaction("tables", "readwrite"); tx.objectStore("tables").put(value, "current"); tx.oncomplete = resolve; }); db.close();
    });
    await panel.getByRole("button", { name: "Retry", exact: true }).click(); await saved();
    assert.equal(await panel.count(), 0);
    const recovered = await read();
    assert.equal(recovered.snapshot.scene.objects.length, 2);
    assert.equal(recovered.snapshot.scene.objects[1].locked, true);
    assert.equal(recovered.snapshot.scene.objects[1].image, original.snapshot.scene.objects[1].image);
    await page.getByRole("button", { name: "Live feeds", exact: true }).click();
    await page.getByRole("button", { name: "Reconnect", exact: true }).waitFor();
    console.log("PASS: specific load diagnostics, protected original across editing/retry, lossless recovery export including blobs, and retry restores stopped feeds and locked tokens");
    await page.evaluate(async () => {
      const db = await new Promise((resolve) => { const r = indexedDB.open("table-goblin", 1); r.onsuccess = () => resolve(r.result); });
      const value = await new Promise((resolve) => { const r = db.transaction("tables").objectStore("tables").get("current"); r.onsuccess = () => resolve(r.result); });
      value.snapshot.scene.objects.push({ id: "ghost", kind: "video", name: "hmmm", x: 0, y: 0, width: 480, height: NaN, rotation: 0, parentId: null, color: "#acbf9b", sourceWidth: 0, sourceHeight: 0, video: "asset:ghost-file", strokes: [] });
      value.assets.push({ key: "ghost-file", blob: new Blob(["original ghost video"], { type: "video/webm" }) });
      await new Promise((resolve) => { const tx = db.transaction("tables", "readwrite"); tx.objectStore("tables").put(value, "current"); tx.oncomplete = resolve; }); db.close();
    });
    await page.reload(); await saved();
    const repaired = await read();
    assert.equal(repaired.snapshot.scene.objects.length, 3);
    const ghost = repaired.snapshot.scene.objects.find((o) => o.id === "ghost");
    assert.equal(ghost.height, 270); assert.equal(ghost.sourceWidth, undefined);
    assert.equal(repaired.snapshot.scene.objects.find((o) => o.id === "hero").image, original.snapshot.scene.objects[1].image);
    assert.ok(repaired.assets.some((a) => a.blob.size === "original ghost video".length));
    await page.getByRole("button", { name: "Table options", exact: true }).click();
    const backupDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export saved data for recovery", exact: true }).click();
    const backupFile = ".test-artifacts/legacy-video.recovery.json";
    await (await backupDownload).saveAs(backupFile);
    const backup = JSON.parse(fs.readFileSync(backupFile, "utf8"));
    assert.equal(backup.original.snapshot.scene.objects.find((o) => o.id === "ghost").sourceWidth, 0);
    assert.deepEqual(backup.original.snapshot.scene.objects.find((o) => o.id === "ghost").height, { $number: "NaN" });
    assert.match(backup.original.assets.find((a) => a.key === "ghost-file").blob.data, /^data:video\/webm;base64,/);
    await page.reload(); await saved(); assert.equal((await read()).snapshot.scene.objects.length, 3);
    console.log("PASS: legacy zero-dimension video recovery restores the whole table, retains the ghost as a manageable surface, and preserves the untouched original plus video bytes");
  } finally { await context.close(); }
};

exports.testEngine = async (existing) => {
  const context = await existing.context().browser().newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(existing.url());
    await page.setContent('<style>html,body{margin:0;width:100%;height:100%}canvas{width:100%;height:100%;display:block}</style><canvas tabindex="0"></canvas>');
    await page.addScriptTag({ path: ".test-artifacts/engine-test.js" });
    await page.evaluate(() => { window.engine = new GoblinTest.TableEngine(document.querySelector("canvas"), (v) => window.view = v, (m) => window.message = m); });
    await checkEngine(page);
  } finally { await context.close(); }
};
async function checkEngine(page) {
  await page.evaluate(async () => {
    engine.reset(true);
    // A real audio-only WAV with an MP4 filename reaches loadedmetadata with 0 x 0 video dimensions.
    const bytes = new Uint8Array(2044), data = new DataView(bytes.buffer);
    const ascii = (offset, text) => [...text].forEach((c, i) => data.setUint8(offset + i, c.charCodeAt(0)));
    ascii(0, "RIFF"); data.setUint32(4, bytes.length - 8, true); ascii(8, "WAVE"); ascii(12, "fmt ");
    data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true);
    data.setUint32(24, 8000, true); data.setUint32(28, 16000, true); data.setUint16(32, 2, true); data.setUint16(34, 16, true);
    ascii(36, "data"); data.setUint32(40, 2000, true);
    await engine.addFiles([new File([bytes], "hmmm.mp4", { type: "audio/wav" })]);
  });
  const converted = await page.evaluate(() => ({ objects: engine.scene.objects, assets: engine.assets.size, message }));
  assert.equal(converted.objects.length, 1); assert.equal(converted.objects[0].kind, "audio");
  assert.ok(Number.isFinite(converted.objects[0].height)); assert.equal(converted.objects[0].paused, true);
  console.log("PASS: real audio-only media becomes a finite visible audio surface instead of a ghost video");
  await page.evaluate(async () => { engine.reset(true); await engine.restoreLocal(); engine.addShape("circle"); });
  await page.waitForFunction(() => view.storage === "saved");
  const result = await page.evaluate(async () => {
    await engine.store.writing;
    const before = await engine.store.readOriginal();
    const obj = engine.scene.objects.at(-1);
    obj.imageView = { x: 0, y: 0, zoom: 0 };
    engine.setLocked(true, new Set([obj.id]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { before, after: await engine.store.readOriginal(), status: view.storage, message };
  });
  assert.deepEqual(result.after, result.before);
  assert.equal(result.status, "error"); assert.match(result.message, /artwork framing/);
  await page.evaluate(() => { const obj = engine.scene.objects.at(-1); obj.locked = false; engine.saveImageView(obj.id, { x: 0, y: 0, zoom: 1 }); });
  await page.waitForFunction(() => view.storage === "saved");
  await page.evaluate(async () => { engine.reset(true); await engine.store.writing; });
  console.log("PASS: unreadable snapshots cannot overwrite the last good save or show Saved locally; valid changes resume saving");
}
