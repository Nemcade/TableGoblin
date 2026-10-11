const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
require("esbuild").buildSync({
  stdin: { contents: 'export { TableEngine } from "./src/engine"; export { RoomClient } from "./src/room-client"; export { readTableFile } from "./src/table-storage";', resolveDir: process.cwd(), loader: "ts" },
  bundle: true, format: "iife", globalName: "GoblinArtworkTest", outfile: ".test-artifacts/online-artwork.js", define: { "import.meta.url": '""' },
});
module.exports = async (browser, base) => {
  const contexts = await Promise.all([browser.newContext({ acceptDownloads: true }), browser.newContext()]), pages = await Promise.all(contexts.map(c => c.newPage())), [gm, player] = pages;
  const errors = [], operations = []; gm.on("request", req => { if (req.url().endsWith("/operations")) operations.push(req.postDataBuffer().length); });
  const wait = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 20000 });
  try {
    for (const page of pages) {
      page.on("pageerror", e => errors.push(e.message));
      await page.route("**/artwork-harness", route => route.fulfill({ contentType: "text/html", body: '<html><style>body{margin:0}canvas{width:100vw;height:100vh}</style><canvas></canvas></html>' }));
      await page.goto(base + "/artwork-harness"); await page.addScriptTag({ path: path.resolve(".test-artifacts/online-artwork.js") });
    }
    const room = await gm.evaluate(async () => {
      const response = await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Art GM", color: "#ee9966" }) });
      const room = await response.json(); await fetch(`/api/rooms/${room.id}/permissions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerEditing: true }) }); return room;
    });
    for (const [index, page] of pages.entries()) await page.evaluate(async ({ room, index }) => {
      const state = index ? await (await fetch(`/api/rooms/${room.id}/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invite: room.invite, name: "Art player", color: "#6677ee" }) })).json() : await (await fetch(`/api/rooms/${room.id}/state`)).json();
      window.notices = []; window.status = "offline";
      window.engine = new GoblinArtworkTest.TableEngine(document.querySelector("canvas"), v => window.view = v, message => notices.push(message));
      engine.addShape("circle");
      window.client = new GoblinArtworkTest.RoomClient(engine, state, (s, status) => { window.roomState = s; window.status = status; }, message => notices.push(message));
      window.imageFile = async (color, type = "image/png") => {
        const canvas = document.createElement("canvas"); canvas.width = 32; canvas.height = 24;
        const ctx = canvas.getContext("2d"); ctx.fillStyle = color; ctx.fillRect(0, 0, 32, 24);
        return new File([await new Promise(resolve => canvas.toBlob(resolve, type))], "art." + type.split("/")[1], { type });
      };
    }, { room, index });
    await Promise.all(pages.map(page => wait(page, () => status === "connected")));
    // A map whose embedded representation exceeds the table-update limit still
    // uploads once; geometry operations never include its image bytes.
    const largeSize = await gm.evaluate(async () => {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1536;
      const ctx = canvas.getContext("2d"), pixels = ctx.createImageData(canvas.width, canvas.height); let seed = 713;
      for (let i = 0; i < pixels.data.length; i += 4) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; pixels.data[i] = seed & 255; pixels.data[i + 1] = seed >>> 8 & 255; pixels.data[i + 2] = seed >>> 16 & 255; pixels.data[i + 3] = 255; }
      ctx.putImageData(pixels, 0, 0); const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      await engine.addImages([new File([blob], "Large map.png", { type: "image/png" })]); return blob.size;
    });
    assert.ok(largeSize * 4 / 3 > 8 * 1024 * 1024, String(largeSize));
    await wait(player, () => engine.scene.objects.length === 1);
    await wait(gm, () => status === "connected" && engine.scene.objects[0].image.startsWith("/api/"));
    await wait(player, () => engine.renderer.images.get(engine.scene.objects[0].image)?.naturalWidth === 1536);
    assert.ok(await gm.evaluate(() => [...engine.renderer.images.keys()].every(url => url.startsWith("/api/")) && engine.undoStack.length === 0), "Upload previews do not retain large inline images in renderer caches or unused local history");
    await gm.evaluate(() => { engine.scene.objects[0].x += 35; client.requestSave(); });
    await wait(player, () => engine.scene.objects[0].x === 35);
    for (const type of ["image/jpeg", "image/webp"]) {
      await gm.evaluate(async type => engine.addImages([await imageFile("#44aacc", type)]), type);
      await wait(gm, () => status === "connected" && engine.scene.objects.every(o => o.image.startsWith("/api/")));
    }
    const gif = Buffer.from([71,73,70,56,57,97,1,0,1,0,128,0,0,255,0,0,0,0,255,33,255,11,...Buffer.from("NETSCAPE2.0"),3,1,0,0,0,33,249,4,4,10,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0,33,249,4,4,10,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,76,1,0,59]).toString("base64");
    await gm.evaluate(async gif => engine.addImages([new File([Uint8Array.from(atob(gif), c => c.charCodeAt(0))], "Loop.gif", { type: "image/gif" })]), gif);
    await wait(player, () => engine.scene.objects.length === 4 && engine.scene.objects.some(o => engine.renderer.gifs.get(o.id)?.gif));
    const colors = await player.evaluate(async () => {
      const object = engine.scene.objects.find(o => o.animated), gif = engine.renderer.gifs.get(object.id).gif, colors = new Set();
      for (let i = 0; i < 10; i++) { colors.add([...gif.tick(false).getContext("2d").getImageData(0, 0, 1, 1).data].join(",")); await new Promise(resolve => setTimeout(resolve, 35)); } return [...colors];
    });
    assert.equal(colors.length, 2, "Private GIF URLs preserve animation");
    // Incoming unrelated edits during an upload are rebased before submitting.
    await gm.route("**/assets", async route => { await gm.waitForTimeout(300); await route.continue(); });
    await gm.evaluate(async () => engine.addImages([await imageFile("#118833")]));
    await player.evaluate(() => engine.addShape("hexagon"));
    await wait(player, () => engine.scene.objects.length === 6);
    await wait(gm, () => status === "connected"); await gm.unroute("**/assets");
    // Masked art plus a nested note reuse the original file when duplicated.
    await gm.evaluate(async () => { const token = engine.addShape("circle"); window.tokenId = token.id; await engine.addImages([await imageFile("#6644cc")], undefined, true); });
    await wait(gm, () => status === "connected" && engine.scene.objects.find(o => o.id === tokenId)?.image.startsWith("/api/"));
    await gm.evaluate(() => {
      const text = engine.add("text"); text.parentId = tokenId; text.x = text.y = 0; client.requestSave();
      engine.selection = new Set([tokenId]); const clipboardData = new DataTransfer(); window.dispatchEvent(new ClipboardEvent("copy", { clipboardData, bubbles: true }));
      window.copied = clipboardData.getData("text/plain"); window.copyBefore = engine.scene.objects.length;
      window.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true }));
    });
    await wait(gm, () => status === "connected" && engine.scene.objects.length === copyBefore + 2);
    const copy = await gm.evaluate(() => engine.scene.objects.slice(-2));
    assert.equal(copy[1].parentId, copy[0].id); assert.equal(copy[0].image, await gm.evaluate(() => engine.scene.objects.find(o => o.id === tokenId).image));
    const [download] = await Promise.all([gm.waitForEvent("download"), gm.evaluate(() => engine.exportTable())]);
    const exportedPath = ".test-artifacts/portable-room.goblin.json"; await download.saveAs(exportedPath);
    const exported = JSON.parse(fs.readFileSync(exportedPath, "utf8"));
    assert.ok(exported.snapshot.scene.objects.filter(o => o.image).every(o => o.image.startsWith("data:image/")));
    assert.ok(exported.snapshot.scene.objects.some(o => o.animated && o.image === "data:image/gif;base64," + gif));
    // A lost upload acknowledgement preserves the edit and deduplicates retry.
    let dropped = false;
    await gm.route("**/assets", async route => { if (!dropped) { dropped = true; await route.fetch(); await route.abort("failed"); } else await route.continue(); });
    const count = await gm.evaluate(() => engine.scene.objects.length);
    await gm.evaluate(async () => engine.addImages([await imageFile("#ffaa22")]));
    await wait(gm, () => status === "offline"); await gm.evaluate(() => client.reconnect());
    await wait(gm, n => status === "connected" && engine.scene.objects.length === n + 1 && engine.scene.objects.at(-1).image.startsWith("/api/"), count);
    await gm.unroute("**/assets");
    // Permanent rejection keeps a portable unsent version instead of losing art.
    await gm.route("**/assets", route => route.fulfill({ status: 413, contentType: "application/json", body: JSON.stringify({ error: "Artwork limit reached." }) }));
    await gm.evaluate(async () => engine.addImages([await imageFile("#1199ff")]));
    await wait(gm, () => !!client.rejectedDraft);
    assert.ok(await gm.evaluate(() => client.rejectedDraft.scene.objects.some(o => o.image?.startsWith("data:image/"))));
    await gm.unroute("**/assets");
    const [rejectedDownload] = await Promise.all([gm.waitForEvent("download"), gm.evaluate(() => client.exportRejected())]);
    await rejectedDownload.saveAs(".test-artifacts/unsent-artwork.goblin.json");
    assert.ok(JSON.parse(fs.readFileSync(".test-artifacts/unsent-artwork.goblin.json", "utf8")).snapshot.scene.objects.some(o => o.image?.startsWith("data:image/")));
    assert.ok(operations.every(bytes => bytes < 20000), "Moves, nesting and copies send metadata, never image bytes");
    await gm.evaluate(() => {
      client.close(); engine.leaveRoom(); const clipboardData = new DataTransfer(); clipboardData.setData("text/plain", copied);
      window.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true }));
    });
    await wait(gm, () => engine.scene.objects.length === 3);
    assert.ok(await gm.evaluate(() => engine.scene.objects.find(o => o.image)?.image.startsWith("data:image/")), "Room-to-local clipboard copies become self-contained");
    gm.once("dialog", dialog => dialog.accept());
    await gm.evaluate(async data => { const stored = await GoblinArtworkTest.readTableFile(new File([data], "Portable.goblin.json")); window.portableCount = stored.snapshot.scene.objects.length; await engine.importTable(new File([data], "Portable.goblin.json")); }, JSON.stringify(exported));
    assert.equal(await gm.evaluate(() => portableCount), exported.snapshot.scene.objects.length);
    assert.equal(await gm.evaluate(() => engine.scene.objects.length), exported.snapshot.scene.objects.length);
    assert.deepEqual(errors, []);
    console.log("PASS: real large-map/JPG/WebP/GIF uploads, animated private artwork, small move operations, upload/edit races, masked/nested clipboard copies, portable exports/local import, lost upload acknowledgements and rejected-edit preservation");
  } catch (error) {
    console.error("Artwork browser diagnostic:", JSON.stringify(await Promise.all(pages.map(page => page.evaluate(() => ({ status, notices, scene: engine.scene.objects.map(o => ({ id: o.id, name: o.name, image: o.image?.slice(0, 100) })) })).catch(() => null))))); throw error;
  } finally {
    for (const page of pages) await page.evaluate(() => { window.client?.close(); window.engine?.dispose(); }).catch(() => {});
    await Promise.all(contexts.map(c => c.close()));
  }
};
