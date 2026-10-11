const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
require("esbuild").buildSync({
  stdin: { contents: 'export { TableEngine } from "./src/engine"; export { RoomClient } from "./src/room-client";', resolveDir: process.cwd(), loader: "ts" },
  bundle: true, format: "iife", globalName: "GoblinRoomControlTest", outfile: ".test-artifacts/online-management.js", define: { "import.meta.url": '""' },
});
const wait = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 10000 });
const post = (page, url, value) => page.evaluate(async ({ url, value }) => {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }); return { status: response.status, json: await response.json() };
}, { url, value });

async function productionUI(browser, base) {
  const contexts = await Promise.all([browser.newContext({ viewport: { width: 1440, height: 900 } }), browser.newContext()]);
  const gm = await contexts[0].newPage(), player = await contexts[1].newPage(), gmTab = await contexts[0].newPage(), errors = [], requests = [];
  try {
    for (const [i, page] of [gm, player, gmTab].entries()) {
      page.on("pageerror", e => errors.push(e.message));
      page.on("request", request => { if (/\/(operations|manage|permissions)$/.test(request.url())) requests.push({ page: i, url: request.url(), body: request.postDataJSON() }); });
    }
    const add = async page => {
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await page.getByRole("button", { name: "Shapes Pick a shape, give it a color" }).click();
      await page.getByRole("button", { name: "Add Circle", exact: true }).click();
    };
    await gm.goto(base); await player.goto(base); await add(player);
    await player.getByLabel("Local table save status").filter({ hasText: "SAVED LOCALLY" }).waitFor();
    const local = await player.evaluate(async () => {
      const request = indexedDB.open("table-goblin", 1), db = await new Promise(r => request.onsuccess = () => r(request.result));
      const read = db.transaction("tables").objectStore("tables").get("current"), value = await new Promise(r => read.onsuccess = () => r(read.result)); db.close(); return value.snapshot.scene;
    });
    await gm.getByRole("button", { name: "Online room", exact: true }).click();
    await gm.getByLabel("Your player name", { exact: true }).fill("GM");
    await gm.getByLabel("Room name", { exact: true }).fill("Room controls");
    await gm.getByRole("button", { name: "Create room", exact: true }).click();
    await gm.getByLabel("Room connection status").filter({ hasText: "ROOM CONNECTED" }).waitFor();
    const invitation = gm.getByLabel("Player invitation", { exact: true }), oldLink = await invitation.inputValue();
    const id = new URLSearchParams(new URL(oldLink).hash.slice(1)).get("room"), root = `/api/rooms/${id}`;
    await player.goto(oldLink); await player.getByLabel("Your player name", { exact: true }).fill("Player");
    await player.getByRole("button", { name: "Join room", exact: true }).click();
    await player.getByLabel("Room connection status").filter({ hasText: "ROOM CONNECTED" }).waitFor();
    await gm.getByRole("button", { name: "Remove Player from room", exact: true }).waitFor();
    assert.equal(await player.getByRole("button", { name: "Replace invitation", exact: true }).count(), 0);
    assert.equal(await gm.getByRole("button", { name: "Remove GM from room", exact: true }).count(), 0);
    await gmTab.goto(base + "/#room=" + id); await gmTab.getByLabel("Room connection status").filter({ hasText: "ROOM CONNECTED" }).waitFor();
    await gmTab.getByRole("button", { name: "Online room", exact: true }).click();
    await gm.getByRole("button", { name: "Replace invitation", exact: true }).click();
    await gm.getByRole("button", { name: "Cancel", exact: true }).click(); assert.equal(await invitation.inputValue(), oldLink);
    await gm.getByRole("button", { name: "Replace invitation", exact: true }).click();
    await gm.getByRole("button", { name: "Replace link", exact: true }).click();
    await wait(gm, old => document.querySelector('input[aria-label="Player invitation"]').value !== old, oldLink);
    const newLink = await invitation.inputValue();
    await wait(gmTab, link => document.querySelector('input[aria-label="Player invitation"]').value === link, newLink);
    const invalid = await post(player, root + "/join", { invite: new URLSearchParams(new URL(oldLink).hash.slice(1)).get("invite"), name: "Player", color: "#eeaa77" }); assert.equal(invalid.status, 403);
    assert.match(await player.getByLabel("Room connection status").innerText(), /ROOM CONNECTED/);
    await gm.getByRole("checkbox", { name: "Allow players to add objects and draw", exact: true }).check();
    await player.getByText(/You can also add objects and draw on the canvas/).waitFor();
    await player.getByRole("button", { name: "Close room controls", exact: true }).click();
    await add(player);
    let before;
    const savedBy = Date.now() + 10000;
    do {
      before = await gm.evaluate(async root => (await (await fetch(root + "/state")).json()), root);
      if (before.table.scene.objects.length === 1) break;
      await player.waitForTimeout(25);
    } while (Date.now() < savedBy);
    await player.getByLabel("Room connection status").filter({ hasText: "ROOM CONNECTED" }).waitFor();
    assert.equal(before.table.scene.objects.length, 1);
    await gm.getByRole("button", { name: "Remove Player from room", exact: true }).click();
    await gm.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal((await player.evaluate(async root => (await fetch(root + "/state")).status, root)), 200);
    await gm.getByRole("button", { name: "Remove Player from room", exact: true }).click();
    await gm.screenshot({ path: ".test-artifacts/online-room-management.png" });
    await gm.getByRole("button", { name: "Remove player", exact: true }).click();
    await player.getByLabel("Room connection status").filter({ hasText: "ROOM ACCESS ENDED" }).waitFor();
    assert.equal(await player.getByRole("button", { name: "Rejoin room", exact: true }).count(), 0);
    await gmTab.getByRole("button", { name: "Remove Player from room", exact: true }).waitFor({ state: "detached" });
    const after = await gm.evaluate(async root => (await (await fetch(root + "/state")).json()), root);
    assert.deepEqual(after.table, before.table); assert.equal(after.access[`object:${after.table.scene.objects[0].id}`].owner, after.me.id);
    assert.notEqual(await invitation.inputValue(), newLink);
    await player.getByRole("button", { name: "Return to local table", exact: true }).click();
    await player.getByLabel("Local table save status").filter({ hasText: "SAVED LOCALLY" }).waitFor();
    const restored = await player.evaluate(async () => {
      const request = indexedDB.open("table-goblin", 1), db = await new Promise(r => request.onsuccess = () => r(request.result));
      const read = db.transaction("tables").objectStore("tables").get("current"), value = await new Promise(r => read.onsuccess = () => r(read.result)); db.close(); return value.snapshot.scene;
    });
    assert.deepEqual(restored, local); assert.equal(new URL(player.url()).hash, ""); assert.deepEqual(errors, []);
    console.log("PASS: production Online popup confirmation/cancel, synchronized GM tabs, replaced links, player removal, preserved objects and restoration of the player's local table");
  } catch (error) { console.error("Room controls UI diagnostic:", JSON.stringify({ requests, errors })); throw error; }
  finally { await Promise.all(contexts.map(c => c.close())); }
}

async function clientRaces(browser, base) {
  const contexts = await Promise.all([browser.newContext(), browser.newContext({ acceptDownloads: true })]);
  const pages = await Promise.all(contexts.map(c => c.newPage())), [gm, player] = pages, errors = [];
  let releaseState;
  try {
    for (const page of pages) {
      page.on("pageerror", e => errors.push(e.message));
      await page.route("**/management-harness", route => route.fulfill({ contentType: "text/html", body: "<html><canvas width=1200 height=800></canvas></html>" }));
      await page.goto(base + "/management-harness"); await page.addScriptTag({ path: path.resolve(".test-artifacts/online-management.js") });
    }
    const room = (await post(gm, "/api/rooms", { name: "Controls GM", color: "#eeaa77" })).json, root = `/api/rooms/${room.id}`;
    await post(gm, root + "/permissions", { playerEditing: true });
    const joined = (await post(player, root + "/join", { name: "Draft player", color: "#6677ee", invite: room.invite })).json;
    for (const [i, page] of pages.entries()) await page.evaluate(async ({ root, i }) => {
      const state = await (await fetch(root + "/state")).json();
      window.notices = []; window.status = "offline";
      window.engine = new GoblinRoomControlTest.TableEngine(document.querySelector("canvas"), v => window.view = v, text => notices.push(text));
      window.client = new GoblinRoomControlTest.RoomClient(engine, state, (_, status) => window.status = status, text => notices.push(text));
    }, { root, i });
    await Promise.all(pages.map(p => wait(p, () => status === "connected")));
    // Lose the HTTP acknowledgement after commit. SSE receipts still settle the control.
    const before = await gm.evaluate(() => client.state.revision);
    await gm.route("**/manage", async route => { await route.fetch(); await route.abort(); });
    await gm.evaluate(async () => client.manage("invitation"));
    await wait(gm, revision => status === "connected" && client.state.revision === revision + 1, before);
    assert.deepEqual(await gm.evaluate(() => notices), []); await gm.unroute("**/manage");
    // Keep an old authenticated GET response in flight until after removal.
    let held = false; const stateGate = new Promise(r => releaseState = r);
    await player.route("**/state", async route => { const response = await route.fetch(); held = true; await stateGate; await route.fulfill({ response }); });
    await player.evaluate(() => { window.reconnect = client.reconnect(); });
    const deadline = Date.now() + 5000; while (!held && Date.now() < deadline) await gm.waitForTimeout(10); assert.equal(held, true);
    await player.evaluate(() => {
      const note = engine.addText(); window.noteId = note.id;
      engine.saveText(note.id, { ...note.text, content: "Unsent note must survive removal" }, 300);
    });
    await gm.evaluate(async id => client.manage("remove", id), joined.me.id);
    await wait(player, () => status === "removed"); releaseState();
    await player.evaluate(() => window.reconnect);
    assert.equal(await player.evaluate(() => status), "removed");
    assert.equal(await player.evaluate(() => engine.objectEditable(noteId)), false, "A late response cannot re-enable editing");
    assert.equal(await player.evaluate(() => client.rejectedDraft.scene.objects.find(o => o.id === noteId).text.content), "Unsent note must survive removal");
    assert.equal(await player.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }), true);
    const downloadEvent = player.waitForEvent("download"); await player.evaluate(() => client.exportRejected());
    const download = await downloadEvent, file = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
    assert.equal(file.snapshot.scene.objects.find(o => o.text)?.text.content, "Unsent note must survive removal");
    const requests = [];
    player.on("request", request => { if (request.url().includes(root)) requests.push(request.url()); });
    await player.evaluate(async () => { await client.reconnect(); window.dispatchEvent(new Event("online")); window.dispatchEvent(new Event("offline")); });
    await player.waitForTimeout(1300); assert.deepEqual(requests, [], "A removed browser stops reconnecting and renewing presence/claims");
    // Recovery export retains private image references without trying to fetch
    // artwork after access has ended. It is explicitly not a portable import.
    await gm.evaluate(async () => {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 32;
      canvas.getContext("2d").fillRect(0, 0, 32, 32);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      await engine.addImages([new File([blob], "Room art.png", { type: "image/png" })]);
    });
    await wait(gm, () => status === "connected" && client.state.table.scene.objects.some(o => o.image?.startsWith("/api/")));
    const invitation = await gm.evaluate(() => client.state.invite);
    const rejoined = (await post(player, root + "/join", { name: "Draft player", color: "#6677ee", invite: invitation })).json;
    await player.evaluate(state => {
      client.close(); engine.leaveRoom();
      window.client = new GoblinRoomControlTest.RoomClient(engine, state, (_, next) => window.status = next, text => notices.push(text));
    }, rejoined);
    await wait(player, () => status === "connected");
    await player.evaluate(() => { const note = engine.addText(); engine.saveText(note.id, { ...note.text, content: "Recover this note and the image reference" }, 300); });
    await gm.evaluate(async id => client.manage("remove", id), rejoined.me.id);
    await wait(player, () => status === "removed");
    const recoveryEvent = player.waitForEvent("download"); await player.evaluate(() => client.exportRejected());
    const recoveryDownload = await recoveryEvent, recovery = JSON.parse(fs.readFileSync(await recoveryDownload.path(), "utf8"));
    assert.equal(recovery.app, "table-goblin-recovery");
    assert.equal(recovery.original.snapshot.scene.objects.find(o => o.text).text.content, "Recover this note and the image reference");
    assert.match(recovery.original.snapshot.scene.objects.find(o => o.image).image, /^\/api\/rooms\//);
    assert.deepEqual(errors, []);
    console.log("PASS: lost room-control acknowledgements, late authenticated responses, read-only removed clients, unsent inline note preservation, portable/recovery exports and stopped reconnect loops");
  } finally {
    releaseState?.();
    for (const page of pages) await page.evaluate(() => { window.client?.close(); window.engine?.dispose(); }).catch(() => {});
    await Promise.all(contexts.map(c => c.close()));
  }
}
module.exports = async (browser, base) => { await productionUI(browser, base); await clientRaces(browser, base); };
