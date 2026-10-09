const assert = require("node:assert/strict");
const path = require("node:path");
require("esbuild").buildSync({
  stdin: { contents: 'export { TableEngine } from "./src/engine"; export { RoomClient } from "./src/room-client"; export { tableChanges, expectations } from "./src/room-operations";', resolveDir: process.cwd(), loader: "ts" },
  bundle: true, format: "iife", globalName: "GoblinSyncTest", outfile: ".test-artifacts/online-sync.js", define: { "import.meta.url": '""' },
});
module.exports = async function syncTests(browser, base) {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map(c => c.newPage())), [gm, player] = pages;
  const errors = [];
  const wait = async (page, fn) => page.waitForFunction(fn, null, { timeout: 10000 });
  try {
    for (const page of pages) {
      page.on("pageerror", e => errors.push(e.message));
      await page.route("**/sync-harness", route => route.fulfill({ contentType: "text/html", body: '<html><style>body{margin:0}canvas{width:100vw;height:100vh;display:block}</style><canvas></canvas></html>' }));
      await page.goto(base + "/sync-harness");
      await page.addScriptTag({ path: path.resolve(".test-artifacts/online-sync.js") });
    }
    const room = await gm.evaluate(async () => {
      const post = async (url, value) => (await (await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) })).json());
      const state = await post("/api/rooms", { name: "Sync GM", color: "#ee9966" });
      const table = structuredClone(state.table);
      table.scene.objects = ["a", "b"].map((id, i) => ({ id, name: id, kind: "shape", shape: "circle", x: i ? 200 : -200, y: 0, width: 100, height: 100, rotation: 0, parentId: null, color: "#aabbcc", strokes: [] }));
      const changes = GoblinSyncTest.tableChanges(state.table, table);
      await post(`/api/rooms/${state.id}/operations`, { id: crypto.randomUUID(), changes, expected: GoblinSyncTest.expectations(state.table, changes, state.versions) });
      await post(`/api/rooms/${state.id}/permissions`, { playerEditing: true });
      return state;
    });
    for (const [index, page] of pages.entries()) await page.evaluate(async ({ room, index }) => {
      const state = index ? await (await fetch(`/api/rooms/${room.id}/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invite: room.invite, name: "Sync player", color: "#6688ee" }) })).json() : await (await fetch(`/api/rooms/${room.id}/state`)).json();
      window.notices = []; window.status = "offline";
      window.engine = new GoblinSyncTest.TableEngine(document.querySelector("canvas"), view => window.view = view, text => notices.push(text));
      window.client = new GoblinSyncTest.RoomClient(engine, state, (s, status) => { window.roomState = s; window.status = status; }, text => notices.push(text));
    }, { room, index });
    await Promise.all(pages.map(p => wait(p, () => status === "connected")));
    for (const page of pages) await page.evaluate(() => { engine.camera.zoom = 1; engine.invalidate(); });
    const point = async (page, id) => page.evaluate(id => {
      const obj = engine.scene.objects.find(o => o.id === id); return { x: engine.camera.x + obj.x * engine.camera.zoom, y: engine.camera.y + obj.y * engine.camera.zoom };
    }, id);
    let release;
    const gate = new Promise(resolve => release = resolve);
    let arrivals = 0;
    for (const page of pages) await page.route("**/operations", async route => { arrivals++; await gate; await route.continue(); });
    await Promise.all(pages.map(async (p, i) => {
      const pos = await point(p, i ? "b" : "a");
      await p.mouse.move(pos.x, pos.y); await p.mouse.down(); await p.mouse.move(pos.x + (i ? -40 : 40), pos.y + 30, { steps: 4 }); await p.mouse.up();
    }));
    const deadline = Date.now() + 10000;
    while (arrivals < 2 && Date.now() < deadline) await gm.waitForTimeout(25);
    assert.equal(arrivals, 2, "Both edits are in flight before either arrives at the server"); release();
    await Promise.all(pages.map(p => wait(p, () => status === "connected" && engine.scene.objects.find(o => o.id === "a").x === -160 && engine.scene.objects.find(o => o.id === "b").x === 160)));
    for (const page of pages) await page.unroute("**/operations");
    assert.deepEqual(await gm.evaluate(() => notices), []); assert.deepEqual(await player.evaluate(() => notices), []);
    await gm.evaluate(() => engine.undo());
    await Promise.all(pages.map(p => wait(p, () => engine.scene.objects.find(o => o.id === "a").x === -200 && engine.scene.objects.find(o => o.id === "b").x === 160)));
    await gm.evaluate(() => engine.redo());
    await Promise.all(pages.map(p => wait(p, () => engine.scene.objects.find(o => o.id === "a").x === -160)));
    // An unrelated remote edit must not cancel a drag or undo its saved content
    // when the local pointer gesture is subsequently cancelled with Escape.
    const pos = await point(gm, "a"); await gm.mouse.move(pos.x, pos.y); await gm.mouse.down(); await gm.mouse.move(pos.x + 20, pos.y + 20);
    await player.evaluate(() => { engine.selection = new Set(["b"]); engine.setSurfaceColor("#1133aa"); });
    await wait(gm, () => engine.scene.objects.find(o => o.id === "b").color === "#1133aa");
    assert.equal(await gm.evaluate(() => engine.gesture?.kind), "move");
    await gm.keyboard.press("Escape"); await gm.mouse.up();
    assert.equal(await gm.evaluate(() => engine.scene.objects.find(o => o.id === "b").color), "#1133aa");
    assert.equal(await gm.evaluate(() => engine.scene.objects.find(o => o.id === "a").x), -160);
    await gm.evaluate(() => { const note = engine.addText(); engine.saveText(note.id, { ...note.text, content: "Typing while another player edits" }, 300); window.noteId = note.id; });
    assert.equal(await gm.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }), true, "Unfinished room text cannot be discarded by a silent refresh");
    await player.evaluate(() => { engine.selection = new Set(["b"]); engine.setSurfaceColor("#2244bb"); });
    await wait(gm, () => engine.scene.objects.find(o => o.id === "b").color === "#2244bb");
    assert.equal(await gm.evaluate(() => engine.editingId === noteId), true, "Unrelated events keep the inline text editor open");
    await gm.evaluate(() => engine.closeEditor());
    await wait(player, () => engine.scene.objects.some(o => o.text?.content === "Typing while another player edits"));
    await wait(gm, () => status === "connected");
    assert.equal(await gm.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }), false, "Saved room text no longer blocks refresh");
    await gm.evaluate(() => engine.setTool("pen"));
    await gm.mouse.move(50, 50); await gm.mouse.down(); await gm.mouse.move(90, 90, { steps: 5 });
    await player.evaluate(() => { engine.selection = new Set(["b"]); engine.setSurfaceColor("#3355cc"); });
    await wait(gm, () => engine.scene.objects.find(o => o.id === "b").color === "#3355cc");
    assert.equal(await gm.evaluate(() => engine.gesture?.kind), "stroke");
    const count = await gm.evaluate(() => engine.gesture.stroke.points.length);
    await gm.mouse.move(130, 80, { steps: 5 }); await gm.mouse.up();
    await wait(player, () => engine.scene.strokes.length === 1);
    assert.ok(await player.evaluate(n => engine.scene.strokes[0].points.length > n, count), "Brush samples keep their live stroke reference after merging");
    // Drop the HTTP acknowledgement after the server has persisted the edit.
    // SSE/reconnect receipts must recognize the already-saved request.
    const before = await gm.evaluate(() => client.state.revision);
    let aborted = false;
    await gm.route("**/operations", async route => { if (aborted) return route.continue(); aborted = true; await route.fetch(); await route.abort("failed"); });
    await gm.evaluate(() => { engine.selection = new Set(["a"]); engine.setSurfaceColor("#5577dd"); });
    await wait(player, () => engine.scene.objects.find(o => o.id === "a").color === "#5577dd");
    await gm.waitForTimeout(250); await gm.evaluate(() => client.reconnect());
    await wait(gm, () => status === "connected");
    await gm.unroute("**/operations");
    assert.equal(await gm.evaluate(() => client.state.revision), before + 1, "A lost save acknowledgement does not create a second revision");
    assert.equal(await gm.evaluate(() => client.rejectedDraft), null);
    // Hold an old HTTP ack while both another local edit and a remote edit arrive.
    let finish, held = false;
    const hold = new Promise(resolve => finish = resolve);
    await gm.route("**/operations", async route => {
      if (held) return route.continue(); held = true; const response = await route.fetch(); await hold; await route.fulfill({ response });
    });
    await gm.evaluate(() => { engine.selection = new Set(["a"]); engine.setSurfaceColor("#6688dd"); });
    await wait(player, () => engine.scene.objects.find(o => o.id === "a").color === "#6688dd");
    await gm.evaluate(() => engine.setSurfaceColor("#7799dd"));
    await player.evaluate(() => { engine.selection = new Set(["b"]); engine.setSurfaceColor("#4466cc"); });
    await wait(gm, () => engine.scene.objects.find(o => o.id === "b").color === "#4466cc");
    finish();
    await Promise.all(pages.map(p => wait(p, () => status === "connected" && engine.scene.objects.find(o => o.id === "a").color === "#7799dd" && engine.scene.objects.find(o => o.id === "b").color === "#4466cc")));
    await gm.unroute("**/operations");
    assert.equal(await gm.evaluate(() => client.rejectedDraft), null);
    // Delay a rejection response until a newer remote edit has already arrived.
    // Preserve both that newer state and the original rejected draft.
    let receive, send;
    const incoming = new Promise(resolve => receive = resolve), outgoing = new Promise(resolve => send = resolve);
    let rejectResponse, rejectedReady;
    const ready = new Promise(resolve => rejectedReady = resolve);
    await gm.route("**/operations", async route => { await incoming; rejectResponse = await route.fetch(); rejectedReady(); await outgoing; await route.fulfill({ response: rejectResponse }); });
    await gm.evaluate(() => engine.setSurfaceColor("#8899aa"));
    await gm.waitForTimeout(220);
    await player.evaluate(() => { engine.selection = new Set(["a"]); engine.setSurfaceColor("#bb6677"); });
    await wait(gm, () => engine.scene.objects.find(o => o.id === "a").color === "#bb6677");
    receive(); await ready;
    assert.equal(rejectResponse.status(), 409);
    await player.evaluate(() => { engine.selection = new Set(["b"]); engine.setSurfaceColor("#5577cc"); });
    await wait(gm, () => engine.scene.objects.find(o => o.id === "b").color === "#5577cc");
    send();
    await wait(gm, () => status === "connected"); await gm.unroute("**/operations");
    assert.equal(await gm.evaluate(() => engine.scene.objects.find(o => o.id === "b").color), "#5577cc", "A late rejection cannot load an older snapshot over a newer remote edit");
    assert.equal(await gm.evaluate(() => client.rejectedDraft.scene.objects.find(o => o.id === "a").color), "#8899aa", "The original conflicting edit remains available for export");
    assert.deepEqual(errors, []);
    console.log("PASS: real concurrent browser drags, actor undo/redo, preserved dragging/typing/brush references, lost acknowledgements and late HTTP replies");
  } catch (error) {
    console.error("Sync browser diagnostic:", JSON.stringify(await Promise.all(pages.map(p => p.evaluate(() => ({ status, scene: window.engine?.scene, revision: window.client?.state.revision, notices: window.notices })).catch(() => null)))));
    throw error;
  } finally {
    for (const page of pages) await page.evaluate(() => { window.client?.close(); window.engine?.dispose(); }).catch(() => {});
    await Promise.all(contexts.map(c => c.close()));
  }
};
