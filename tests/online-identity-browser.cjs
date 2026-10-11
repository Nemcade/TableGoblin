const assert = require("node:assert/strict"), path = require("node:path");
require("esbuild").buildSync({
  stdin: { contents: 'export { TableEngine } from "./src/engine"; export { RoomClient } from "./src/room-client";', resolveDir: process.cwd(), loader: "ts" },
  bundle: true, format: "iife", globalName: "GoblinIdentityTest", outfile: ".test-artifacts/online-identity.js", define: { "import.meta.url": '""' },
});
const post = (page, url, value) => page.evaluate(async ({ url, value }) => {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
  return { status: response.status, json: await response.json() };
}, { url, value });
const state = (page, root) => page.evaluate(async root => (await (await fetch(root + "/state")).json()), root);
async function untilState(page, root, predicate) {
  const deadline = Date.now() + 10000;
  do { const value = await state(page, root); if (predicate(value)) return value; await page.waitForTimeout(30); } while (Date.now() < deadline);
  throw new Error("Expected participant state did not arrive");
}
const connected = page => page.getByLabel("Room connection status").filter({ hasText: "ROOM CONNECTED" }).waitFor();
async function productionUI(browser, base) {
  const contexts = await Promise.all([browser.newContext({ viewport: { width: 1440, height: 900 } }), browser.newContext({ viewport: { width: 900, height: 1000 } })]);
  const gm = await contexts[0].newPage(), player = await contexts[1].newPage(), gmTab = await contexts[0].newPage(), errors = [];
  try {
    for (const page of [gm, player, gmTab]) page.on("pageerror", e => errors.push(e.message));
    await gm.goto(base); await gm.getByRole("button", { name: "Online room", exact: true }).click();
    await gm.getByLabel("Your player name", { exact: true }).fill("Guide");
    await gm.getByRole("button", { name: "Create room", exact: true }).click(); await connected(gm);
    const link = await gm.getByLabel("Player invitation", { exact: true }).inputValue(), id = new URLSearchParams(new URL(link).hash.slice(1)).get("room"), root = `/api/rooms/${id}`;
    await player.goto(link); await player.getByLabel("Your player name", { exact: true }).fill("Player");
    await player.getByRole("button", { name: "Join room", exact: true }).click(); await connected(player);
    const initial = await untilState(gm, root, s => s.presence.length === 2 && s.presence.every(p => p.view));
    const gmId = initial.me.id, playerId = initial.participants.find(p => p.id !== gmId).id;
    await gm.getByRole("button", { name: "Close room controls", exact: true }).click();
    await gm.mouse.move(700, 440); await gm.mouse.wheel(0, 400);
    await gm.mouse.down({ button: "middle" }); await gm.mouse.move(350, 650, { steps: 5 }); await gm.mouse.up({ button: "middle" });
    await untilState(gm, root, s => Math.abs(s.presence.find(p => p.id === gmId)?.view?.x ?? 0) > 100);
    // Presence is sent during gestures too; capture the settled view after the final pointer update.
    await gm.waitForTimeout(250);
    const panned = await state(gm, root);
    const source = panned.presence.find(p => p.id === gmId).view;
    const beforePlayer = panned.presence.find(p => p.id === playerId).view;
    await player.getByRole("button", { name: "Go to Guide's view", exact: true }).click();
    const moved = await untilState(player, root, s => Math.abs(s.presence.find(p => p.id === playerId)?.view?.x - source.x) < 1e-6);
    const target = moved.presence.find(p => p.id === playerId).view;
    assert.ok(Math.abs(target.y - source.y) < 1e-6);
    assert.ok(target.width >= source.width - 1e-6 && target.height >= source.height - 1e-6, "Navigation fits the peer view into a different aspect ratio");
    assert.notDeepEqual(target, beforePlayer); assert.deepEqual(moved.presence.find(p => p.id === gmId).view, source);
    assert.equal(moved.revision, initial.revision); assert.deepEqual(moved.table, initial.table); assert.deepEqual(moved.history, initial.history);
    assert.equal(await player.getByLabel("Online room controls").count(), 0, "View navigation dismisses the popup");
    await player.mouse.move(500, 500); await player.mouse.down({ button: "middle" }); await player.mouse.move(650, 600); await player.mouse.up({ button: "middle" });
    const independent = await untilState(player, root, s => Math.abs(s.presence.find(p => p.id === playerId)?.view?.x - source.x) > 10);
    assert.deepEqual(independent.presence.find(p => p.id === gmId).view, source);
    await gm.getByRole("button", { name: "Online room", exact: true }).click();
    await gm.getByRole("button", { name: "Edit identity", exact: true }).click();
    await gm.getByLabel("Your room name", { exact: true }).fill("Cancelled");
    await gm.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal((await state(gm, root)).me.name, "Guide");
    await gm.getByRole("button", { name: "Edit identity", exact: true }).click();
    await gm.getByLabel("Your room name", { exact: true }).fill("Game master");
    await gm.getByLabel("Pointer color hex", { exact: true }).fill("#aa44dd");
    await gm.getByLabel("Pointer color hex", { exact: true }).press("Enter");
    assert.equal((await state(gm, root)).me.name, "Guide", "Committing a hex input must not submit the form");
    await gm.getByRole("button", { name: "Save identity", exact: true }).click();
    await gm.getByText("Identity updated.", { exact: true }).waitFor();
    await player.getByRole("button", { name: "Online room", exact: true }).click();
    await player.getByRole("button", { name: "Go to Game master's view", exact: true }).waitFor();
    const row = player.locator(`[data-participant="${gmId}"]`);
    assert.equal(await row.locator("i").evaluate(el => el.style.background), "rgb(170, 68, 221)");
    assert.equal(await gm.evaluate(() => JSON.parse(localStorage.getItem("table-goblin-identity")).color), "#aa44dd");
    await gmTab.goto(base + "/#room=" + id); await connected(gmTab);
    await gmTab.getByRole("button", { name: "Online room", exact: true }).click();
    await gmTab.getByRole("button", { name: "Edit identity", exact: true }).click();
    await gmTab.getByLabel("Your room name", { exact: true }).fill("Stale draft");
    await gm.getByRole("button", { name: "Edit identity", exact: true }).click();
    await gm.getByLabel("Your room name", { exact: true }).fill("Newer name");
    await gm.getByRole("button", { name: "Save identity", exact: true }).click(); await gm.getByText("Identity updated.", { exact: true }).waitFor();
    await gmTab.getByRole("button", { name: "Save identity", exact: true }).click();
    await gmTab.getByRole("alert").filter({ hasText: "another window" }).waitFor();
    assert.equal(await gmTab.getByLabel("Your room name", { exact: true }).inputValue(), "Stale draft");
    assert.match(await gmTab.locator(".room-role").innerText(), /Newer name/);
    assert.equal((await state(gmTab, root)).me.name, "Newer name");
    await gmTab.getByRole("button", { name: "Save identity", exact: true }).click(); await gmTab.getByText("Identity updated.", { exact: true }).waitFor();
    await player.getByRole("button", { name: "Go to Stale draft's view", exact: true }).waitFor();
    await gmTab.getByRole("button", { name: "Edit identity", exact: true }).click();
    await gmTab.screenshot({ path: ".test-artifacts/online-room-identity.png" });
    await contexts[1].setOffline(true);
    await player.getByLabel("Room connection status").filter({ hasText: "ROOM OFFLINE" }).waitFor();
    assert.equal(await player.getByRole("button", { name: "Edit identity", exact: true }).isDisabled(), true);
    await contexts[1].setOffline(false); await connected(player);
    await player.reload(); await connected(player);
    await player.getByRole("button", { name: "Online room", exact: true }).click();
    await player.getByRole("button", { name: "Go to Stale draft's view", exact: true }).waitFor();
    assert.equal((await state(player, root)).me.id, playerId); assert.deepEqual(errors, []);
    console.log("PASS: compact identity UI, hex commit/cancel, two-tab conflicts, live name/color updates, optional view navigation at different window sizes and independent pan/zoom");
  } finally { await Promise.all(contexts.map(c => c.close())); }
}

async function clientRaces(browser, base) {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]), pages = await Promise.all(contexts.map(c => c.newPage())), [gm, player] = pages, errors = [];
  let releaseView, releaseRemoval;
  try {
    for (const page of pages) {
      page.on("pageerror", e => errors.push(e.message));
      await page.route("**/identity-harness", route => route.fulfill({ contentType: "text/html", body: '<html><style>body{margin:0}canvas{width:100vw;height:100vh}</style><canvas></canvas></html>' }));
      await page.goto(base + "/identity-harness"); await page.addScriptTag({ path: path.resolve(".test-artifacts/online-identity.js") });
    }
    const room = (await post(gm, "/api/rooms", { name: "GM", color: "#eeaa77" })).json, root = `/api/rooms/${room.id}`;
    await post(gm, root + "/permissions", { playerEditing: true });
    const joined = (await post(player, root + "/join", { name: "Player", color: "#6677ee", invite: room.invite })).json;
    for (const page of pages) await page.evaluate(async root => {
      const state = await (await fetch(root + "/state")).json(); window.notices = []; window.status = "offline";
      window.engine = new GoblinIdentityTest.TableEngine(document.querySelector("canvas"), v => window.view = v, text => notices.push(text));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      engine.camera = { x: 700, y: 500, zoom: 1.2 }; window.localCamera = { ...engine.camera };
      window.client = new GoblinIdentityTest.RoomClient(engine, state, (_, next) => window.status = next, text => notices.push(text));
    }, root);
    for (const page of pages) await page.waitForFunction(() => status === "connected");
    // Identity metadata must preserve a live inline note, its content and rollback baseline.
    await player.evaluate(() => { const note = engine.addText(); window.noteId = note.id; engine.saveText(note.id, { ...note.text, content: "Typing survives metadata" }, 300); });
    assert.equal(await player.evaluate(() => engine.editingId), await player.evaluate(() => noteId));
    await gm.evaluate(async () => client.updateProfile("Renamed GM", "#aabbcc", 0));
    await player.waitForFunction(() => client.state.participants.some(p => p.name === "Renamed GM"));
    assert.equal(await player.evaluate(() => engine.scene.objects.find(o => o.id === noteId).text.content), "Typing survives metadata");
    assert.equal(await player.evaluate(() => engine.editingId), await player.evaluate(() => noteId));
    const camera = await player.evaluate(() => engine.camera);
    assert.equal(await player.evaluate(() => engine.goToRoomView({ x: 5000, y: 4000, width: 800, height: 600 })), false);
    assert.deepEqual(await player.evaluate(() => engine.camera), camera);
    await player.evaluate(() => engine.closeEditor());
    await player.waitForFunction(() => status === "connected" && client.state.table.scene.objects.some(o => o.id === noteId));
    await player.evaluate(() => { engine.gesture = { kind: "pan", start: { x: 0, y: 0 }, camera: { ...engine.camera } }; });
    await gm.evaluate(async () => client.updateProfile("Another name", "#aabbcc", 1));
    await player.waitForFunction(() => client.state.participants.some(p => p.name === "Another name"));
    assert.equal(await player.evaluate(() => engine.gesture?.kind), "pan");
    assert.equal(await player.evaluate(() => engine.goToRoomView({ x: 5000, y: 4000, width: 800, height: 600 })), false);
    await player.evaluate(() => engine.gesture = null);
    // Lose a committed HTTP reply; the SSE receipt acknowledges it without a second save.
    const revision = await player.evaluate(() => client.state.revision);
    await player.route("**/profile", async route => { await route.fetch(); await player.waitForFunction(() => client.state.me.name === "Lost reply"); await route.abort(); });
    await player.evaluate(async () => client.updateProfile("Lost reply", "#123456", 0));
    await player.waitForFunction(() => status === "connected");
    assert.equal(await player.evaluate(() => client.state.revision), revision + 1); await player.unroute("**/profile");
    // A request that never arrives retains its immutable payload and request ID until reconnect.
    const requests = []; let abortFirst = true;
    await player.route("**/profile", async route => { requests.push(route.request().postDataJSON()); if (abortFirst) { abortFirst = false; await route.abort(); } else await route.continue(); });
    const interrupted = await player.evaluate(async () => { try { await client.updateProfile("Retry once", "#654321", 1); return "unexpected"; } catch (e) { return e.message; } });
    assert.match(interrupted, /interrupted/);
    await player.evaluate(async () => client.reconnect());
    await player.waitForFunction(() => status === "connected" && client.state.me.name === "Retry once");
    assert.equal(requests.length, 2); assert.deepEqual(requests[0], requests[1]);
    assert.equal(await player.evaluate(() => client.state.me.profileVersion), 2); await player.unroute("**/profile");
    assert.equal(await player.evaluate(() => engine.goToRoomView({ x: 6000, y: -4000, width: 1600, height: 1200 })), true);
    // A late HTTP acknowledgement must keep views received through newer SSE presence.
    let viewHeld = false;
    const viewGate = new Promise(resolve => releaseView = resolve);
    await player.route("**/profile", async route => { const response = await route.fetch(); viewHeld = true; await viewGate; await route.fulfill({ response }); });
    await player.evaluate(() => { window.profileWork = client.updateProfile("Delayed reply", "#654321", 2); });
    const viewDeadline = Date.now() + 5000; while (!viewHeld && Date.now() < viewDeadline) await player.waitForTimeout(10); assert.equal(viewHeld, true);
    await player.waitForFunction(() => client.state.me.name === "Delayed reply");
    await gm.evaluate(() => engine.goToRoomView({ x: 5000, y: 3000, width: 1600, height: 1200 }));
    await player.waitForFunction(() => client.state.presence.some(p => p.id !== client.state.me.id && Math.abs(p.view?.x - 5000) < 1e-6));
    releaseView(); await player.evaluate(() => profileWork);
    assert.equal(await player.evaluate(() => client.state.presence.find(p => p.id !== client.state.me.id).view.x), 5000);
    await player.unroute("**/profile");
    // A profile response already in flight cannot restore access after removal.
    let held = false;
    const gate = new Promise(resolve => releaseRemoval = resolve);
    await player.route("**/profile", async route => { const response = await route.fetch(); held = true; await gate; await route.fulfill({ response }); });
    await player.evaluate(() => { window.profileWork = client.updateProfile("Late reply", "#654321", 3); });
    const deadline = Date.now() + 5000; while (!held && Date.now() < deadline) await player.waitForTimeout(10); assert.equal(held, true);
    await gm.evaluate(async id => client.manage("remove", id), joined.me.id);
    await player.waitForFunction(() => status === "removed"); releaseRemoval(); await player.evaluate(() => profileWork);
    assert.equal(await player.evaluate(() => status), "removed");
    assert.equal(await player.evaluate(() => engine.goToRoomView({ x: 5000, y: 4000, width: 800, height: 600 })), false);
    await player.evaluate(async () => client.settle());
    // Leaving restores the original local camera, rather than the navigated room camera.
    await player.evaluate(() => { client.close(); engine.leaveRoom(); });
    assert.deepEqual(await player.evaluate(() => engine.camera), await player.evaluate(() => localCamera));
    assert.deepEqual(errors, []);
    console.log("PASS: identity updates preserve active typing/gestures, navigation protects current edits, lost-reply/reconnect deduplication and original local camera restoration");
  } finally {
    releaseView?.(); releaseRemoval?.();
    for (const page of pages) await page.evaluate(() => { window.client?.close(); window.engine?.dispose(); }).catch(() => {});
    await Promise.all(contexts.map(c => c.close()));
  }
}
module.exports = async (browser, base) => { await productionUI(browser, base); await clientRaces(browser, base); };
