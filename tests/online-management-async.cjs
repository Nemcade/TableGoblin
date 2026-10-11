const assert = require("node:assert/strict"), { spawn } = require("node:child_process"), { randomUUID } = require("node:crypto"), fs = require("node:fs"), path = require("node:path");

if (process.argv[2] === "hold-dice") {
  // A test-only gate after actual physics finishes exercises the asynchronous
  // commit boundary deterministically, without a timing hook in production.
  const service = require("../scripts/dice-service.cjs"), simulate = service.simulate;
  let release; const gate = new Promise(resolve => release = resolve);
  service.simulate = async input => { const result = await simulate(input); process.send("dice-ready"); await gate; return result; };
  process.on("message", message => { if (message === "release-dice") release(); });
  require("../scripts/room-server.cjs");
}

module.exports = async () => {
  const data = fs.mkdtempSync(path.resolve(".test-artifacts/revocation-"));
  const child = spawn(process.execPath, [__filename, "hold-dice"], { env: { ...process.env, HOST: "127.0.0.1", PORT: "0", TABLE_GOBLIN_DATA: data }, stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
  try {
    child.stderr.on("data", bytes => process.stderr.write(bytes));
    const base = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Isolated revocation server did not start")), 10000);
      child.stdout.on("data", bytes => { const url = bytes.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; if (url) { clearTimeout(timeout); resolve(url); } }); child.on("error", reject);
    });
    const api = async (url, cookie, value) => {
      const response = await fetch(base + url, { method: value === undefined ? "GET" : "POST", headers: { ...(value === undefined ? {} : { "Content-Type": "application/json" }), ...(cookie ? { Cookie: cookie } : {}) }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
      return { status: response.status, json: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
    };
    const gm = await api("/api/rooms", null, { name: "Async GM", color: "#eeaa77" }), root = `/api/rooms/${gm.json.id}`;
    const player = await api(root + "/join", null, { name: "Pending roller", color: "#6677ee", invite: gm.json.invite });
    const ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Dice never reached the commit gate")), 10000);
      child.on("message", message => { if (message === "dice-ready") { clearTimeout(timeout); resolve(); } });
    });
    const roll = api(root + "/rolls", player.cookie, { id: randomUUID(), setup: { color: null, fontColor: null, groups: [{ id: "main", name: "Main", pool: { 6: 2 }, color: null, fontColor: null }] }, area: { x: 0, y: 0, scale: 64, width: 1000, height: 600 } });
    await ready;
    assert.equal((await api(root + "/manage", gm.cookie, { id: randomUUID(), kind: "remove", member: player.json.me.id, invite: gm.json.invite })).status, 200);
    child.send("release-dice");
    const result = await roll; assert.equal(result.status, 403); assert.equal(result.json.code, "ROOM_REMOVED");
    const state = (await api(root + "/state", gm.cookie)).json; assert.deepEqual(state.dice, { sequence: 0, rolls: [] });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, `${gm.json.id}.json`))).rollReceipts, []);
    console.log("PASS: revocation during asynchronous dice simulation cannot commit a roll or durable receipt");
  } finally {
    child.send?.("release-dice", () => {});
    if (child.exitCode === null) { const exit = new Promise(resolve => child.once("exit", resolve)); child.kill(); await exit; }
  }
};
