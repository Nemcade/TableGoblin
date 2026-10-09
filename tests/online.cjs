const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");
fs.mkdirSync(path.resolve(".test-artifacts"), { recursive: true });
const data = fs.mkdtempSync(path.resolve(".test-artifacts/rooms-"));
let server, browser, base;
async function start(port = 0) {
  server = spawn(process.execPath, ["scripts/room-server.cjs"], { env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", TABLE_GOBLIN_DATA: data }, windowsHide: true });
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Room server did not start")), 8000);
    server.stdout.on("data", chunk => { const url = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; if (url) { clearTimeout(timeout); resolve(url); } });
    server.stderr.on("data", chunk => process.stderr.write(chunk));
    server.on("error", reject);
  });
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const done = new Promise(resolve => server.once("exit", resolve)); server.kill(); await done;
}
async function api(endpoint, cookie, value, extra = {}) {
  const response = await fetch(base + endpoint, { headers: { ...(value === undefined ? {} : { "Content-Type": "application/json" }), ...(cookie ? { Cookie: cookie } : {}), ...extra },
    ...(value === undefined ? {} : { method: "POST", body: JSON.stringify(value) }) });
  const json = await response.json(); return { status: response.status, json, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
const copy = value => structuredClone(value);
const { tableChanges, expectations } = require("../.server-runtime/room-operations.cjs");
const operation = (state, table, id = require("node:crypto").randomUUID()) => {
  const changes = tableChanges(state.table, table);
  return { id, changes, expected: expectations(state.table, changes, state.versions) };
};
async function operationTests() {
  const gm = await api("/api/rooms", null, { name: "Operations GM", color: "#ff9966" });
  const root = `/api/rooms/${gm.json.id}`;
  const player = await api(root + "/join", null, { name: "Editor", color: "#4466ee", invite: gm.json.invite });
  await api(root + "/permissions", gm.cookie, { playerEditing: true });
  const table = copy(gm.json.table);
  table.scene.objects = ["a", "b"].map((id, index) => ({ id, kind: "shape", shape: "circle", name: id, x: index * 200, y: 0, width: 60, height: 60, rotation: 0, parentId: null, color: "#aabbcc", strokes: [] }));
  const create = operation(gm.json, table);
  let result = await api(root + "/operations", gm.cookie, create); assert.equal(result.status, 200);
  const original = result.json, a = copy(original.table), b = copy(original.table);
  a.scene.objects[0].x = 50; a.scene.objects.push(a.scene.objects.shift());
  b.scene.objects[1].x = 250;
  const moveA = operation(original, a), moveB = operation(original, b);
  const race = await Promise.all([api(root + "/operations", gm.cookie, moveA), api(root + "/operations", player.cookie, moveB)]);
  assert.deepEqual(race.map(r => r.status), [200, 200], "Independent objects accept edits from the same baseline");
  let state = (await api(root + "/state", gm.cookie)).json;
  assert.equal(state.table.scene.objects.find(o => o.id === "a").x, 50);
  assert.equal(state.table.scene.objects.find(o => o.id === "b").x, 250);
  const revision = state.revision;
  assert.equal((await api(root + "/operations", gm.cookie, moveA)).json.revision, revision, "Lost-ack retries do not duplicate an operation");
  assert.equal((await api(root + "/operations", gm.cookie, { ...moveA, changes: [] })).status, 409, "Reusing an identity with another payload is rejected");
  result = await api(root + "/undo", gm.cookie, { id: require("node:crypto").randomUUID() });
  assert.equal(result.status, 200); assert.equal(result.json.table.scene.objects.find(o => o.id === "a").x, 0);
  assert.equal(result.json.table.scene.objects.find(o => o.id === "b").x, 250, "Undo keeps the other actor's object edit");
  const redoId = require("node:crypto").randomUUID();
  result = await api(root + "/redo", gm.cookie, { id: redoId }); assert.equal(result.status, 200);
  assert.equal(result.json.table.scene.objects.find(o => o.id === "a").x, 50);
  assert.equal((await api(root + "/redo", gm.cookie, { id: redoId })).json.revision, result.json.revision, "Redo also deduplicates retries");
  // Multiple edits on the same object can be undone/redone in order, while ABA
  // changes made by another participant still invalidate an old operation.
  state = result.json;
  for (const x of [70, 90]) {
    const next = copy(state.table); next.scene.objects.find(o => o.id === "a").x = x;
    result = await api(root + "/operations", gm.cookie, operation(state, next)); assert.equal(result.status, 200); state = result.json;
  }
  for (const x of [70, 50]) {
    result = await api(root + "/undo", gm.cookie, { id: require("node:crypto").randomUUID() }); assert.equal(result.status, 200); assert.equal(result.json.table.scene.objects.find(o => o.id === "a").x, x);
  }
  for (const x of [70, 90]) {
    result = await api(root + "/redo", gm.cookie, { id: require("node:crypto").randomUUID() }); assert.equal(result.status, 200); assert.equal(result.json.table.scene.objects.find(o => o.id === "a").x, x);
  }
  state = result.json;
  const overlap = copy(state.table); overlap.scene.objects.find(o => o.id === "a").x = 120;
  const stale = operation(state, overlap);
  for (const x of [110, 90]) {
    const next = copy(state.table); next.scene.objects.find(o => o.id === "a").x = x;
    result = await api(root + "/operations", player.cookie, operation(state, next)); assert.equal(result.status, 200); state = result.json;
  }
  assert.equal((await api(root + "/operations", gm.cookie, stale)).status, 409, "Per-entity versions detect another actor's ABA edit");
  assert.equal((await api(root + "/undo", gm.cookie, { id: require("node:crypto").randomUUID() })).status, 409, "Undo does not overwrite another actor's later edit");
  const locked = copy(state.table); locked.scene.objects.find(o => o.id === "b").locked = true;
  state = (await api(root + "/operations", gm.cookie, operation(state, locked))).json;
  const forged = copy(state.table); forged.scene.objects.find(o => o.id === "b").x += 1;
  assert.equal((await api(root + "/operations", player.cookie, operation(state, forged))).status, 403);
  const theme = copy(state.table); theme.mood.hue = 250;
  assert.equal((await api(root + "/operations", player.cookie, operation(state, theme))).status, 403);
  const invalid = copy(state.table); invalid.scene.objects.find(o => o.id === "a").width = -1;
  assert.equal((await api(root + "/operations", gm.cookie, operation(state, invalid))).status, 400);
  const valid = copy(state.table); valid.scene.objects.find(o => o.id === "a").x += 1;
  const missingReads = operation(state, valid); missingReads.expected = [];
  assert.equal((await api(root + "/operations", gm.cookie, missingReads)).status, 409, "Dependencies cannot be omitted by a forged client");
  await api(root + "/permissions", gm.cookie, { playerEditing: false });
  assert.equal((await api(root + "/operations", player.cookie, operation(state, valid))).status, 403, "Revocation applies to operations already prepared by a player");
  const latest = (await api(root + "/state", gm.cookie)).json;
  return { root, cookie: gm.cookie, state: latest, retry: moveA };
}
async function protocolTests() {
  const host = await api("/api/rooms", null, { name: "Same name", color: "#ff0066", title: "Protocol test" });
  assert.equal(host.status, 201); assert.ok(host.cookie.includes("tg_"));
  const id = host.json.id, root = `/api/rooms/${id}`, gmCookie = host.cookie;
  assert.equal((await api(root + "/state")).status, 401);
  assert.equal((await api(root + "/join", null, { name: "Same name", color: "#0044ff", invite: "wrong" })).status, 403);
  const player = await api(root + "/join", null, { name: "Same name", color: "#0044ff", invite: host.json.invite });
  assert.equal(player.status, 200); assert.equal(player.json.me.role, "player"); assert.ok(!("invite" in player.json));
  assert.notEqual(player.json.me.id, host.json.me.id, "Duplicate names are independent identities");
  assert.ok(!JSON.stringify(player.json).includes("tokenHash"));
  assert.equal((await api(root + "/permissions", player.cookie, { playerEditing: true, role: "gm" })).status, 403);
  assert.equal((await api(root + "/table", player.cookie, { revision: 0, table: host.json.table })).status, 403);
  const table = copy(host.json.table);
  const shape = { id: "map", kind: "shape", shape: "rectangle", name: "Map", x: 0, y: 0, width: 400, height: 300, rotation: 0, parentId: null, color: "#aabbcc", strokes: [], locked: true };
  table.scene.objects.push(shape);
  assert.equal((await api(root + "/table", gmCookie, { revision: 0, table })).status, 200);
  assert.equal((await api(root + "/table", gmCookie, { revision: 0, table })).status, 409);
  assert.equal((await api(root + "/permissions", gmCookie, { playerEditing: true })).status, 200);
  const locked = copy(table); locked.scene.objects[0].x = 50;
  assert.equal((await api(root + "/table", player.cookie, { revision: 1, table: locked })).status, 403);
  const unlock = copy(table); unlock.scene.objects[0].locked = false;
  assert.equal((await api(root + "/table", player.cookie, { revision: 1, table: unlock })).status, 403);
  const theme = copy(table); theme.mood.hue = 210;
  assert.equal((await api(root + "/table", player.cookie, { revision: 1, table: theme })).status, 403);
  const free = copy(table); free.scene.objects.push({ ...shape, id: "token", locked: false, x: 100, width: 60, height: 60 });
  assert.equal((await api(root + "/table", player.cookie, { revision: 1, table: free })).status, 200);
  const corrupt = copy(free); corrupt.scene.objects[1].width = null;
  assert.equal((await api(root + "/table", gmCookie, { revision: 2, table: corrupt })).status, 400);
  const blob = copy(free); blob.scene.objects[1].image = "blob:private";
  assert.equal((await api(root + "/table", gmCookie, { revision: 2, table: blob })).status, 400);
  assert.equal((await api(root + "/table", gmCookie, { revision: 2, table: free }, { Origin: "https://other.example" })).status, 403);
  const moved = copy(free); moved.scene.objects[1].x = 120;
  const movedAgain = copy(free); movedAgain.scene.objects[1].x = 180;
  const race = await Promise.all([api(root + "/table", gmCookie, { revision: 2, table: moved }), api(root + "/table", player.cookie, { revision: 2, table: movedAgain })]);
  assert.deepEqual(race.map(r => r.status).sort(), [200, 409], "Concurrent stale edits cannot overwrite one another");
  const reconnect = await api(root + "/state", player.cookie);
  assert.equal(reconnect.json.me.id, player.json.me.id);
  assert.equal(reconnect.json.revision, 3);
  const stored = JSON.parse(fs.readFileSync(path.join(data, `${id}.json`), "utf8"));
  assert.ok(!fs.readFileSync(path.join(data, `${id}.json`), "utf8").includes(gmCookie.split("=")[1]), "Raw reconnect credentials are not persisted");
  assert.equal(stored.members[0].role, "gm");
  return { root, gmCookie, playerCookie: player.cookie, state: reconnect.json };
}
async function browserTests() {
  const gmContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const playerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const gm = await gmContext.newPage(), player = await playerContext.newPage(), errors = [];
  for (const page of [gm, player]) page.on("pageerror", e => errors.push(e.message));
  try {
    await gm.goto(base); await player.goto(base);
    const add = async (page, shape) => {
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await page.getByRole("button", { name: "Shapes Pick a shape, give it a color" }).click();
      await page.getByRole("button", { name: `Add ${shape}`, exact: true }).click();
    };
    await add(gm, "Circle");
    await gm.getByLabel("Local table save status").filter({ hasText: "SAVED LOCALLY" }).waitFor();
    await gm.getByRole("button", { name: "Online room", exact: true }).click();
    await gm.getByRole("textbox", { name: "Your player name", exact: true }).fill("GM");
    await gm.getByRole("textbox", { name: "Room name", exact: true }).fill("Two-browser table");
    await gm.getByRole("button", { name: "Create room", exact: true }).click();
    await gm.getByLabel("Room connection status").filter({ hasText: "ROOM CONNECTED" }).waitFor();
    const invite = await gm.getByRole("textbox", { name: "Player invitation", exact: true }).inputValue();
    const roomId = new URLSearchParams(new URL(invite).hash.slice(1)).get("room");
    const state = async page => page.evaluate(async id => (await (await fetch(`/api/rooms/${id}/state`)).json()), roomId);
    const waitState = async (page, predicate) => {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) { const value = await state(page); if (predicate(value)) return value; await page.waitForTimeout(75); }
      throw new Error("Timed out waiting for the authoritative room state");
    };
    assert.equal((await state(gm)).table.scene.objects.length, 0, "Room starts empty instead of replacing the local table");
    await player.goto(invite);
    await player.getByRole("textbox", { name: "Your player name", exact: true }).fill("Player");
    await player.getByRole("textbox", { name: "Presence color hex", exact: true }).fill("#ee4466");
    await player.getByRole("textbox", { name: "Your player name", exact: true }).click();
    await player.getByRole("button", { name: "Join room", exact: true }).click();
    await player.getByLabel("Room connection status").filter({ hasText: "ROOM CONNECTED" }).waitFor();
    await gm.getByText("Player", { exact: true }).waitFor();
    await gm.getByRole("button", { name: "Close room controls", exact: true }).click();
    await player.getByRole("button", { name: "Close room controls", exact: true }).click();
    await add(gm, "Rectangle");
    await gm.getByLabel("Room connection status").filter({ hasText: "ROOM CONNECTED" }).waitFor();
    await waitState(player, state => state.table.scene.objects.length === 1);
    const savedScene = (await state(player)).table.scene;
    await player.mouse.move(720, 450); await player.mouse.down(); await player.mouse.move(800, 470, { steps: 5 }); await player.mouse.up();
    await player.waitForTimeout(250);
    assert.deepEqual((await state(player)).table.scene, savedScene, "Player cannot drag the table without permission");
    await player.getByRole("button", { name: "Laser", exact: true }).click();
    await player.mouse.move(680, 400); await player.mouse.down();
    await waitState(gm, state => state.presence.some(p => p.laser));
    await gm.screenshot({ path: ".test-artifacts/online-presence.png" });
    await player.mouse.up();
    await gm.getByRole("button", { name: "Online room", exact: true }).click();
    await gm.getByRole("checkbox", { name: "Allow player editing", exact: true }).check();
    await waitState(player, state => state.playerEditing);
    await gm.getByRole("button", { name: "Close room controls", exact: true }).click();
    await player.getByRole("button", { name: "Select", exact: true }).click();
    await player.mouse.move(720, 450); await player.mouse.down(); await player.mouse.move(820, 510, { steps: 5 }); await player.mouse.up();
    await player.waitForTimeout(500);
    assert.equal((await state(gm)).table.scene.objects[0].x, savedScene.objects[0].x + 100, "Allowed player move reaches the authoritative room");
    const identity = (await state(player)).me.id;
    await player.reload(); await player.getByLabel("Room connection status").filter({ hasText: "ROOM CONNECTED" }).waitFor();
    assert.equal((await state(player)).me.id, identity);
    assert.equal((await state(player)).me.color, "#ee4466");
    await gm.mouse.click(820, 510);
    await gm.evaluate(async () => {
      const canvas = document.createElement("canvas"); canvas.width = 32; canvas.height = 32;
      canvas.getContext("2d").fillStyle = "#2233ee"; canvas.getContext("2d").fillRect(0, 0, 32, 32);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      const clipboard = new DataTransfer(); clipboard.items.add(new File([blob], "art.png", { type: "image/png" }));
      window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
    });
    const art = await waitState(player, state => state.table.scene.objects.some(o => o.image));
    assert.match(art.table.scene.objects.find(o => o.image).image, /^data:image\/png;base64,/);
    await gm.getByRole("button", { name: "Add", exact: true }).click();
    await gm.getByRole("button", { name: "Text Notes, labels and annotations", exact: true }).click();
    await gm.getByRole("textbox", { name: "Text content", exact: true }).fill("Shared note");
    await gm.mouse.click(300, 250);
    await waitState(player, state => state.table.scene.objects.some(o => o.text?.content === "Shared note"));
    await playerContext.setOffline(true);
    await player.getByLabel("Room connection status").filter({ hasText: "ROOM OFFLINE" }).waitFor();
    await playerContext.setOffline(false);
    await player.getByLabel("Room connection status").filter({ hasText: "ROOM CONNECTED" }).waitFor();
    assert.equal((await state(player)).me.id, identity, "Network reconnection keeps the participant identity");
    assert.ok((await state(player)).table.scene.objects.some(o => o.text?.content === "Shared note"));
    await gm.getByRole("button", { name: "Online room", exact: true }).click();
    await gm.getByRole("button", { name: "Leave room · return to local table", exact: true }).click();
    await gm.getByLabel("Local table save status").filter({ hasText: "SAVED LOCALLY" }).waitFor();
    const local = await gm.evaluate(async () => {
      const request = indexedDB.open("table-goblin", 1), db = await new Promise(resolve => { request.onsuccess = () => resolve(request.result); });
      const read = db.transaction("tables").objectStore("tables").get("current");
      const result = await new Promise(resolve => { read.onsuccess = () => resolve(read.result); }); db.close(); return result.snapshot.scene;
    });
    assert.equal(local.objects.length, 1); assert.equal(local.objects[0].shape, "circle", "The original local table survived the whole room session");
    assert.deepEqual(errors, []);
  } finally { await gmContext.close(); await playerContext.close(); }
}
(async () => {
  base = await start(); const persistence = await protocolTests();
  console.log("PASS: authenticated roles, separate invite credentials, stable identities, server-side editing/lock/settings checks, payload validation, origins and stale-revision conflicts");
  const operations = await operationTests();
  console.log("PASS: concurrent independent commands, per-entity and ABA conflicts, forged dependencies, permission revocation, actor undo/redo and idempotent retries");
  const port = Number(new URL(base).port); await stop();
  const legacyFile = path.join(data, `${persistence.state.id}.json`), legacy = JSON.parse(fs.readFileSync(legacyFile, "utf8"));
  delete legacy.versions; delete legacy.history; delete legacy.receipts; fs.writeFileSync(legacyFile, JSON.stringify(legacy));
  base = await start(port);
  const restored = await api(persistence.root + "/state", persistence.playerCookie);
  assert.equal(restored.status, 200); assert.deepEqual(restored.json.table, persistence.state.table); assert.equal(restored.json.me.id, persistence.state.me.id);
  const retried = await api(operations.root + "/operations", operations.cookie, operations.retry);
  assert.equal(retried.status, 200); assert.equal(retried.json.revision, operations.state.revision);
  assert.deepEqual(retried.json.table, operations.state.table); assert.deepEqual(retried.json.history, operations.state.history);
  console.log("PASS: server restart restores room contents, permissions, participant roles and reconnect credentials");
  browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : undefined, headless: true });
  await browserTests();
  console.log("PASS: two-browser room creation/join, shared transforms/artwork/text, colored presence, editing permissions, refresh identity, network reconnect and untouched local table");
  await require("./online-sync.cjs")(browser, base);
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { await browser?.close(); await stop(); });
