const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
require("esbuild").buildSync({
  stdin: { contents: 'export { TableEngine } from "./src/engine"; export { RoomClient } from "./src/room-client";', resolveDir: process.cwd(), loader: "ts" },
  bundle: true, format: "iife", globalName: "GoblinMediaTest", outfile: ".test-artifacts/online-media.js", define: { "import.meta.url": '""' },
});
module.exports = async (browser, base) => {
  const contexts = await Promise.all([browser.newContext({ acceptDownloads: true }), browser.newContext()]);
  const gmUI = await contexts[0].newPage(), playerUI = await contexts[1].newPage(), gm = await contexts[0].newPage(), player = await contexts[1].newPage();
  const pages = [gmUI, playerUI, gm, player], errors = [], operations = [];
  const wait = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 20000 });
  try {
    for (const page of pages) {
      page.on("pageerror", e => errors.push(e.message));
      page.on("request", req => { if (req.url().endsWith("/operations")) operations.push(req.postDataBuffer().length); });
    }
    await gmUI.goto(base); await gmUI.getByRole("button", { name: "Online room", exact: true }).click();
    await gmUI.getByLabel("Your player name", { exact: true }).fill("Media GM");
    await gmUI.getByRole("button", { name: "Create room", exact: true }).click();
    await gmUI.getByLabel("Room connection status").filter({ hasText: "ROOM CONNECTED" }).waitFor();
    const id = new URLSearchParams(new URL(gmUI.url()).hash.slice(1)).get("room"), root = `/api/rooms/${id}`;
    await gmUI.getByRole("checkbox", { name: "Allow players to add objects and draw" }).check();
    const room = await gmUI.evaluate(async root => (await (await fetch(root + "/state")).json()), root);
    for (const [i, page] of [gm, player].entries()) {
      await page.route("**/media-harness", route => route.fulfill({ contentType: "text/html", body: '<html><style>body{margin:0}canvas{width:100vw;height:100vh}</style><canvas></canvas></html>' }));
      await page.goto(base + "/media-harness"); await page.addScriptTag({ path: path.resolve(".test-artifacts/online-media.js") });
      await page.evaluate(async ({ room, root, i }) => {
        const state = i ? await (await fetch(root + "/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Listener", color: "#5577bb", invite: room.invite }) })).json() : await (await fetch(root + "/state")).json();
        window.notices = []; window.status = "offline";
        window.engine = new GoblinMediaTest.TableEngine(document.querySelector("canvas"), v => window.view = v, text => notices.push(text));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        engine.addShape("circle"); window.localScene = structuredClone(engine.scene);
        window.client = new GoblinMediaTest.RoomClient(engine, state, (_, next) => window.status = next, text => notices.push(text));
      }, { room, root, i });
      await wait(page, () => status === "connected");
    }
    await playerUI.goto(base + "/#room=" + id);
    await playerUI.getByLabel("Room connection status").filter({ hasText: "ROOM CONNECTED" }).waitFor();
    await gmUI.getByRole("button", { name: "Close room controls", exact: true }).click();
    await gmUI.getByRole("button", { name: "Audio sources", exact: true }).click();
    const wav = Buffer.alloc(64044); wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
    for (let at = 44; at < wav.length; at += 2) wav.writeInt16LE(Math.round(Math.sin((at - 44) / 2 / 8000 * Math.PI * 440) * 1000), at);
    await gmUI.getByLabel("Import audio files", { exact: true }).setInputFiles({ name: "Campfire.wav", mimeType: "audio/wav", buffer: wav });
    await wait(player, () => engine.scene.objects.some(o => o.audio?.startsWith("/api/") && engine.renderer.audios.get(o.id)?.audio.readyState >= 2));
    const audioId = await player.evaluate(() => engine.scene.objects.find(o => o.audio).id);
    const beforePlay = await gm.evaluate(() => client.state.revision);
    await playerUI.getByRole("button", { name: "Audio sources", exact: true }).click();
    assert.equal(await playerUI.getByRole("button", { name: "Remove Campfire.wav", exact: true }).isDisabled(), true, "Listening does not grant object deletion");
    await playerUI.getByRole("button", { name: "Play Campfire.wav", exact: true }).click();
    await playerUI.getByRole("button", { name: "Pause Campfire.wav", exact: true }).waitFor();
    await playerUI.getByRole("slider", { name: "Campfire.wav file volume", exact: true }).fill("25");
    await playerUI.getByRole("button", { name: "Loop off", exact: true }).click();
    assert.equal(await gm.evaluate(id => engine.scene.objects.find(o => o.id === id).paused, audioId), true);
    assert.equal(await gm.evaluate(() => client.state.revision), beforePlay, "Listening changes do not become room commands");
    await player.evaluate(() => engine.addShape("hexagon"));
    await wait(gm, () => engine.scene.objects.some(o => o.shape === "hexagon"));
    await playerUI.getByRole("button", { name: "Pause Campfire.wav", exact: true }).waitFor();
    assert.equal(await playerUI.getByRole("slider", { name: "Campfire.wav file volume", exact: true }).inputValue(), "25", "Remote edits preserve personal listening preferences");
    await playerUI.getByRole("button", { name: "Pause Campfire.wav", exact: true }).click();
    await gmUI.getByLabel("Import audio files", { exact: true }).setInputFiles({ name: "Mobile.mp4", mimeType: "video/mp4", buffer: fs.readFileSync(path.join(__dirname, "fixtures/audio-only.mp4")) });
    await wait(player, () => engine.scene.objects.some(o => o.filename === "Mobile.mp4" && o.kind === "audio" && o.width > 0 && o.height > 0 && engine.renderer.audios.get(o.id)?.audio.readyState >= 2));
    await gm.evaluate(async () => {
      const bytes = await (await fetch(engine.scene.objects.find(o => o.filename === "Mobile.mp4").audio)).blob();
      await engine.addFiles([new File([bytes], "Legacy.m4a", { type: "audio/x-m4a" })]);
    });
    await wait(player, () => engine.scene.objects.some(o => o.filename === "Legacy.m4a" && o.audio?.startsWith("/api/") && engine.renderer.audios.get(o.id)?.audio.readyState >= 2));
    await gmUI.getByRole("button", { name: "Close audio panel", exact: true }).click();
    // Real locally recorded video exercises decoding and Range-backed playback in both browsers.
    const codecs = await gm.evaluate(async () => {
      const result = [];
      for (const mime of ["video/webm;codecs=vp8", "video/mp4"]) {
        if (!MediaRecorder.isTypeSupported(mime)) continue;
        const canvas = document.createElement("canvas"); canvas.width = 160; canvas.height = 90;
        const ctx = canvas.getContext("2d"), stream = canvas.captureStream(20), chunks = [], recorder = new MediaRecorder(stream, { mimeType: mime });
        recorder.ondataavailable = e => chunks.push(e.data); const done = new Promise(resolve => recorder.onstop = resolve); recorder.start();
        let frame = 0; const timer = setInterval(() => { ctx.fillStyle = frame++ % 2 ? "#aabbcc" : "#cc7755"; ctx.fillRect(0, 0, 160, 90); }, 30);
        await new Promise(resolve => setTimeout(resolve, 450)); recorder.stop(); await done; clearInterval(timer); stream.getTracks().forEach(t => t.stop());
        const type = mime.split(";")[0]; await engine.addFiles([new File(chunks, type === "video/mp4" ? "Scene.mp4" : "Scene.webm", { type })]); result.push(type);
      }
      return result;
    });
    assert.ok(codecs.includes("video/webm"));
    await wait(player, count => engine.scene.objects.filter(o => o.video?.startsWith("/api/") && engine.renderer.videos.get(o.id)?.video.readyState >= 2).length === count, codecs.length);
    await wait(gm, () => status === "connected");
    assert.ok(await player.evaluate(() => engine.scene.objects.filter(o => o.video).every(o => {
      const video = engine.renderer.videos.get(o.id).video; return video.muted && video.loop && Math.abs(o.width / o.height - 16 / 9) < .001;
    })));
    const videoId = await player.evaluate(() => engine.scene.objects.find(o => o.video).id);
    await player.evaluate(id => engine.togglePlayback(id), videoId);
    assert.equal(await player.evaluate(id => engine.renderer.videos.get(id).video.paused, videoId), true);
    assert.equal(await gm.evaluate(id => engine.scene.objects.find(o => o.id === id).paused, videoId), false);
    await gm.evaluate(id => engine.saveCrop(id, { x: .1, y: .1, width: .8, height: .8 }), videoId);
    await wait(player, id => engine.scene.objects.find(o => o.id === id).crop?.width === .8, videoId);
    assert.equal(await player.evaluate(id => engine.scene.objects.find(o => o.id === id).paused, videoId), true);
    const current = await gm.evaluate(() => engine.scene.objects.length);
    await gm.evaluate(id => { engine.selection = new Set([id]); engine.duplicate(); }, audioId);
    await wait(player, count => engine.scene.objects.length === count + 1, current);
    const copiedRef = await gm.evaluate(() => engine.scene.objects.at(-1).audio), originalRef = await gm.evaluate(id => engine.scene.objects.find(o => o.id === id).audio, audioId);
    assert.equal(copiedRef, originalRef, "Copies reuse the stored audio file");
    // Pending local blob previews survive unrelated incoming changes while uploading.
    let delayed = false;
    await gm.route("**/media", async route => { delayed = true; await gm.waitForTimeout(300); await route.continue(); });
    const another = Buffer.from(wav); another.writeInt16LE(234, 44);
    await gm.evaluate(async encoded => engine.addFiles([new File([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], "Another.wav", { type: "audio/wav" })]), another.toString("base64"));
    await wait(gm, () => status === "saving");
    await player.evaluate(() => { const shape = engine.scene.objects.find(o => o.shape === "hexagon"); shape.x += 47; client.requestSave(); });
    await wait(gm, () => status === "connected" && engine.scene.objects.some(o => o.filename === "Another.wav" && o.audio.startsWith("/api/")));
    assert.equal(await gm.evaluate(() => engine.scene.objects.find(o => o.shape === "hexagon").x), await player.evaluate(() => engine.scene.objects.find(o => o.shape === "hexagon").x));
    assert.ok(delayed, "A real upload overlapped the remote edit");
    await gm.unroute("**/media");
    let lost = false;
    await gm.route("**/media", async route => { if (!lost) { lost = true; await route.fetch(); await route.abort(); } else await route.continue(); });
    const retry = Buffer.from(wav); retry.writeInt16LE(100, 46);
    await gm.evaluate(async encoded => engine.addFiles([new File([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], "Retry.wav", { type: "audio/wav" })]), retry.toString("base64"));
    await wait(gm, () => status === "offline"); await gm.evaluate(() => client.reconnect());
    await wait(gm, () => status === "connected" && engine.scene.objects.every(o => !o.audio?.startsWith("blob:")));
    await gm.unroute("**/media");
    const [download] = await Promise.all([gm.waitForEvent("download"), gm.evaluate(() => engine.exportTable())]);
    const file = ".test-artifacts/portable-room-media.goblin.json"; await download.saveAs(file);
    const portable = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.ok(portable.assets.length >= 4); assert.ok(!JSON.stringify(portable).includes("/api/rooms/"));
    assert.ok(portable.snapshot.scene.objects.filter(o => o.audio || o.video).every(o => (o.audio ?? o.video).startsWith("asset:")));
    await playerUI.reload(); await playerUI.getByLabel("Room connection status").filter({ hasText: "ROOM CONNECTED" }).waitFor();
    await playerUI.getByRole("button", { name: "Audio sources", exact: true }).click();
    await playerUI.getByRole("button", { name: "Play Campfire.wav", exact: true }).first().waitFor();
    await playerUI.screenshot({ path: ".test-artifacts/online-file-media.png" });
    assert.ok(operations.every(bytes => bytes < 20000), "Room edits contain compact references, never file bytes");
    // Private media clipboard copies into a local table download portable bytes first.
    await gm.evaluate(id => {
      engine.selection = new Set([id]); const transfer = new DataTransfer(); window.dispatchEvent(new ClipboardEvent("copy", { clipboardData: transfer, bubbles: true }));
      window.copied = transfer.getData("text/plain"); client.close(); engine.leaveRoom();
      const paste = new DataTransfer(); paste.setData("text/plain", copied); window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: paste, bubbles: true }));
    }, audioId);
    await wait(gm, () => engine.scene.objects.some(o => o.audio?.startsWith("blob:")));
    assert.equal(await gm.evaluate(() => engine.scene.objects[0].shape), "circle", "Local table survives the shared media session");
    const [localExport] = await Promise.all([gm.waitForEvent("download"), gm.evaluate(() => engine.exportTable())]);
    const local = JSON.parse(fs.readFileSync(await localExport.path(), "utf8")); assert.equal(local.assets.length, 1);
    // A portable room can also be imported back online and upload its media once.
    await gm.evaluate(async ({ root, encoded }) => {
      const state = await (await fetch(root + "/state")).json(); window.client = new GoblinMediaTest.RoomClient(engine, state, (_, next) => window.status = next, text => notices.push(text));
      await new Promise(resolve => setTimeout(resolve, 100)); window.confirm = () => true;
      await engine.importTable(new File([encoded], "portable.goblin.json", { type: "application/json" }));
    }, { root, encoded: JSON.stringify(portable) });
    await wait(gm, () => status === "connected" && engine.scene.objects.every(o => !o.audio?.startsWith("blob:") && !o.video?.startsWith("blob:")));
    // A permanent rejection exports the pending bytes rather than discarding them.
    await gm.route("**/media", route => route.fulfill({ status: 413, contentType: "application/json", body: JSON.stringify({ error: "Media limit reached." }) }));
    const variant = Buffer.from(wav); variant.writeInt16LE(1234, 48);
    await gm.evaluate(async encoded => engine.addFiles([new File([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], "Rejected.wav", { type: "audio/wav" })]), variant.toString("base64"));
    await wait(gm, () => !!client.rejectedDraft); await gm.unroute("**/media");
    assert.ok(await gm.evaluate(() => client.rejectedDraft.scene.objects.some(o => o.filename === "Rejected.wav" && o.audio.startsWith("blob:"))));
    const [rejected] = await Promise.all([gm.waitForEvent("download"), gm.evaluate(() => client.exportRejected())]);
    const recovery = JSON.parse(fs.readFileSync(await rejected.path(), "utf8"));
    assert.ok(recovery.assets.some(a => a.data === "data:audio/wav;base64," + variant.toString("base64")));
    const count = await gm.evaluate(() => engine.scene.objects.length);
    await gm.evaluate(async () => engine.addFiles([new File(["not a media file"], "Broken.mp4", { type: "video/mp4" })]));
    assert.equal(await gm.evaluate(() => engine.scene.objects.length), count, "Unreadable drops never create invisible objects");
    assert.deepEqual(errors, []);
    console.log("PASS: real shared WAV/audio-only MP4/WebM/MP4 files, personal playback/volume, crops, duplicate references, refresh, upload races/retries, portable export/import/clipboard and rejected-file recovery");
  } finally {
    for (const page of [gm, player]) await page.evaluate(() => { window.client?.close(); window.engine?.dispose(); }).catch(() => {});
    await Promise.all(contexts.map(c => c.close()));
  }
};
