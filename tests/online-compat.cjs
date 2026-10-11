const assert = require("node:assert/strict");
const http = require("node:http");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
async function runLauncher(port) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/launch-online.cjs"], { env: { ...process.env, PORT: String(port), TABLE_GOBLIN_NO_OPEN: "1" }, windowsHide: true });
    let text = ""; const timeout = setTimeout(() => { child.kill(); reject(new Error("Launcher check timed out")); }, 8000);
    child.stdout.on("data", c => text += c); child.stderr.on("data", c => text += c); child.on("error", reject);
    child.on("exit", code => { clearTimeout(timeout); resolve({ code, text }); });
  });
}
async function launcherTests(upstream) {
  const reuse = await runLauncher(Number(new URL(upstream).port));
  assert.equal(reuse.code, 0); assert.match(reuse.text, /already running/);
  const free = http.createServer(); await new Promise(resolve => free.listen(0, "127.0.0.1", resolve));
  const port = free.address().port; await new Promise(resolve => free.close(resolve));
  const data = fs.mkdtempSync(path.resolve(".test-artifacts/launcher-"));
  const child = spawn(process.execPath, ["scripts/launch-online.cjs"], { env: { ...process.env, PORT: String(port), TABLE_GOBLIN_DATA: data, TABLE_GOBLIN_NO_OPEN: "1" }, windowsHide: true });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Fresh online launcher did not start")), 8000);
      child.stdout.on("data", c => { if (c.toString().includes("Table Goblin online:")) { clearTimeout(timeout); resolve(); } });
      child.stderr.on("data", c => process.stderr.write(c)); child.on("error", reject);
    });
    const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    assert.equal(health.protocol, 4); assert.equal(typeof health.build, "string");
    assert.equal((await runLauncher(port)).code, 0);
  } finally {
    // Terminate only the process tree this test just created, including its
    // server child. No user's running server is targeted.
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else { child.kill("SIGTERM"); await new Promise(resolve => child.once("exit", resolve)); }
  }
}
// Mirror the original server's JSON/SSE wire format, while using an isolated
// current server behind it for durable storage and authenticated identities.
function legacy(value, protocol = 0) {
  if (!value || typeof value !== "object") return value;
  const next = { ...value }; for (const key of ["build", "dice", "diceAccepted", "serverTime", ...(protocol === 3 ? [] : ["access", "leases"]), ...(protocol === 0 ? ["protocol", "versions", "history", "accepted"] : [])]) delete next[key];
  if (protocol > 0 && next.protocol !== undefined) next.protocol = protocol;
  if (next.state) next.state = legacy(next.state, protocol);
  return next;
}
module.exports = async function compatibilityTests(browser, upstream) {
  const target = new URL(upstream), contexts = [], pages = [], errors = [];
  let protocol = 0;
  const proxy = http.createServer((req, res) => {
    const request = http.request({ hostname: target.hostname, port: target.port, path: req.url, method: req.method, headers: req.headers }, incoming => {
      const headers = { ...incoming.headers }; delete headers["content-length"];
      res.writeHead(incoming.statusCode, headers);
      if (incoming.headers["content-type"]?.startsWith("text/event-stream")) {
        let buffer = "";
        incoming.on("data", chunk => {
          buffer += chunk.toString();
          let end;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            let frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const match = frame.match(/^data: (.+)$/m);
            if (match) {
              let value = legacy(JSON.parse(match[1]), protocol);
              if (protocol === 0 && frame.startsWith("event: table")) value = { revision: value.revision, table: value.table, actor: value.actor };
              frame = frame.replace(/^data: .+$/m, "data: " + JSON.stringify(value));
            }
            res.write(frame + "\n\n");
          }
        });
        incoming.on("end", () => res.end()); res.on("close", () => request.destroy());
      } else if (incoming.headers["content-type"]?.startsWith("application/json")) {
        const chunks = []; incoming.on("data", chunk => chunks.push(chunk));
        incoming.on("end", () => res.end(JSON.stringify(legacy(JSON.parse(Buffer.concat(chunks).toString()), protocol))));
      } else incoming.pipe(res);
    });
    request.on("error", () => res.destroy()); req.pipe(request);
  });
  try {
    await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${proxy.address().port}`;
    const request = async (url, cookie, value) => {
      const response = await fetch(base + url, { ...(value ? { method: "POST", body: JSON.stringify(value) } : {}), headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) } });
      return { value: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
    };
    const host = await request("/api/rooms", null, { name: "Legacy GM", color: "#ff9966" }), root = `/api/rooms/${host.value.id}`;
    const table = host.value.table;
    table.scene.objects.push({ id: "legacy-map", kind: "shape", shape: "rectangle", name: "Visible map", x: 0, y: 0, width: 200, height: 140, rotation: 0, parentId: null, color: "#7799bb", strokes: [] });
    await request(root + "/table", host.cookie, { revision: 0, table });
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }); contexts.push(context);
      if (!i) {
        const separator = host.cookie.indexOf("=");
        await context.addCookies([{ name: host.cookie.slice(0, separator), value: host.cookie.slice(separator + 1), url: base + root, httpOnly: true }]);
      }
      const page = await context.newPage(); pages.push(page); page.on("pageerror", e => errors.push(e.message));
      await page.goto(`${base}/#room=${host.value.id}${i ? `&invite=${host.value.invite}` : ""}`);
      if (i) { await page.getByRole("textbox", { name: "Your player name", exact: true }).fill("Legacy Player"); await page.getByRole("button", { name: "Join room", exact: true }).click(); }
      await page.getByLabel("Room connection status").filter({ hasText: "RESTART ROOM SERVER" }).waitFor();
      await page.getByRole("alert").filter({ hasText: "read-only mode" }).waitFor();
      await page.getByRole("button", { name: "Close room controls", exact: true }).click();
      assert.ok(await page.evaluate(() => document.querySelector("canvas").getContext("2d").getImageData(720, 450, 1, 1).data[3]) > 0, "Both GM and player render the old server's existing objects");
      await page.mouse.move(300, 300); await page.mouse.down(); await page.mouse.move(900, 650, { steps: 20 }); await page.mouse.up();
      assert.equal(await page.getByRole("button", { name: "Undo", exact: true }).isEnabled(), false);
    }
    table.scene.objects[0].x = 70;
    await request(root + "/table", host.cookie, { revision: 1, table });
    for (const page of pages) await page.waitForFunction(() => document.querySelector("canvas").getContext("2d").getImageData(880, 450, 1, 1).data[3] > 0);
    await pages[1].reload(); await pages[1].getByLabel("Room connection status").filter({ hasText: "RESTART ROOM SERVER" }).waitFor();
    for (const previous of [2, 3]) {
      protocol = previous;
      for (const page of pages) {
        await page.reload();
        await page.getByLabel("Room connection status").filter({ hasText: "RESTART ROOM SERVER" }).waitFor();
        assert.equal(await page.getByRole("button", { name: "Undo", exact: true }).isEnabled(), false);
        await page.getByRole("button", { name: "Close room controls", exact: true }).click();
        await page.waitForFunction(() => document.querySelector("canvas").getContext("2d").getImageData(880, 450, 1, 1).data[3] > 0);
      }
    }
    assert.deepEqual(errors, [], "Missing history/versions and partial table events cause no uncaught exceptions");
    const launcher = await runLauncher(proxy.address().port);
    assert.equal(launcher.code, 1); assert.match(launcher.text, /Close its existing server window/);
    assert.equal((await request("/api/health")).value.app, "table-goblin", "The launcher never kills an existing room process");
    await launcherTests(upstream);
    console.log("PASS: new browser with legacy server renders both tables, survives partial updates/marquee/refresh, disables edits and explains the required restart; launcher detects the mismatch");
  } finally { await Promise.all(contexts.map(c => c.close())); proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
};
