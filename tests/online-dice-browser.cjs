const assert = require("node:assert/strict");
const path = require("node:path");
require("esbuild").buildSync({
  stdin: { contents: 'export { TableEngine } from "./src/engine"; export { RoomClient } from "./src/room-client";', resolveDir: process.cwd(), loader: "ts" },
  bundle: true, format: "iife", globalName: "GoblinDiceTest", outfile: ".test-artifacts/online-dice.js", define: { "import.meta.url": '""' },
});
module.exports = async function diceBrowserTests(browser, base) {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]), pages = await Promise.all(contexts.map(c => c.newPage())), [gm, player] = pages, errors = [];
  const wait = (page, fn, arg = null) => page.waitForFunction(fn, arg, { timeout: 20000 });
  try {
    for (const page of pages) {
      page.on("pageerror", e => errors.push(e.message));
      await page.route("**/dice-harness", route => route.fulfill({ contentType: "text/html", body: '<html><style>body{margin:0}canvas{display:block;width:100vw;height:100vh}</style><canvas></canvas></html>' }));
      await page.goto(base + "/dice-harness"); await page.addScriptTag({ path: path.resolve(".test-artifacts/online-dice.js") });
    }
    const room = await gm.evaluate(async () => (await (await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Dice GM", color: "#ee9966" }) })).json()));
    for (const [i, page] of pages.entries()) await page.evaluate(async ({ room, i }) => {
      const state = i ? await (await fetch(`/api/rooms/${room.id}/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invite: room.invite, name: "Dice player", color: "#6688ee" }) })).json() : await (await fetch(`/api/rooms/${room.id}/state`)).json();
      window.notices = []; window.status = "offline";
      window.engine = new GoblinDiceTest.TableEngine(document.querySelector("canvas"), v => window.view = v, message => notices.push(message));
      engine.dice.toggle(true); engine.dice.choose(4); engine.dice.state.history = [{ id: "local", notation: "1d4", dice: [{ sides: 4, value: 3 }], total: 3 }];
      window.localSetup = JSON.stringify(engine.dice.setup());
      window.client = new GoblinDiceTest.RoomClient(engine, state, (s, status) => { window.roomState = s; window.status = status; }, message => notices.push(message));
      engine.camera = { ...engine.camera, x: i ? 200 : 600, y: i ? 100 : 400, zoom: i ? 2 : .8 };
      engine.dice.clearPool(); engine.dice.setSound(false); engine.dice.setAppearance({ color: i ? "#3377cc" : "#aa6633", fontColor: "#ffffff" });
      if (i) engine.dice.choose(20);
      else { engine.dice.choose(6); engine.dice.choose(6); engine.dice.addGroup(); engine.dice.renameGroup("Damage"); engine.dice.setAppearance({ color: "#cc3344", fontColor: "#ffffff" }); engine.dice.choose(100); }
    }, { room, i });
    await Promise.all(pages.map(p => wait(p, () => status === "connected")));
    const settings = await Promise.all(pages.map(p => p.evaluate(() => JSON.stringify(engine.dice.setup()))));
    await Promise.all(pages.map(p => p.evaluate(() => engine.rollDice())));
    await Promise.all(pages.map(p => wait(p, () => client.state.dice.sequence === 2)));
    const first = await gm.evaluate(() => client.state.dice);
    assert.deepEqual(first, await player.evaluate(() => client.state.dice)); assert.equal(first.rolls.length, 2);
    assert.equal(await gm.evaluate(() => client.state.revision), 0); assert.equal(await player.evaluate(() => client.state.playerEditing), false);
    assert.ok(first.rolls.some(r => r.actorName === "Dice player") && first.rolls.some(r => r.actorName === "Dice GM"));
    await Promise.all(pages.map(p => wait(p, () => engine.dice.state.history.length === 2 && !engine.dice.state.rolling)));
    assert.deepEqual(await gm.evaluate(() => engine.dice.state.history), await player.evaluate(() => engine.dice.state.history));
    assert.deepEqual(await Promise.all(pages.map(p => p.evaluate(() => JSON.stringify(engine.dice.setup())))), settings, "Remote rolls preserve personal dice selections and colors");
    const bodies = page => page.evaluate(() => [...engine.roomThrows].map(([id, d]) => ({ id, bodies: d.bodies.map(b => ({ position: b.position, q: b.q, size: b.size, color: b.color, labels: b.labels, resultFace: b.resultFace })) })).sort((a, b) => a.id.localeCompare(b.id)));
    assert.deepEqual(await bodies(gm), await bodies(player), "Different pan/zoom and presets show exactly the same world poses and face labels");
    assert.deepEqual(await gm.evaluate(() => notices), []); assert.deepEqual(await player.evaluate(() => notices), []);
    // Reconnect a window while the previous throws are still visible. The
    // replay catches up to the server timeline instead of rolling from scratch.
    await player.evaluate(async () => {
      client.close(); const state = await (await fetch(`/api/rooms/${roomState.id}/state`)).json();
      window.client = new GoblinDiceTest.RoomClient(engine, state, (s, status) => { roomState = s; window.status = status; }, message => notices.push(message));
    });
    await wait(player, () => status === "connected");
    assert.equal(await player.evaluate(() => JSON.stringify(engine.dice.setup())), settings[1], "Room dice preferences survive rejoining");
    await wait(player, () => engine.roomThrows.size === 0);
    assert.equal(await player.evaluate(() => engine.dice.state.history.length), 2);
    // Drop the HTTP acknowledgement after SSE has confirmed the saved roll.
    const before = await gm.evaluate(() => client.state.dice.sequence);
    await gm.route("**/rolls", async route => { await route.fetch(); await gm.waitForTimeout(150); await route.abort("failed"); });
    await gm.evaluate(() => engine.rollDice());
    await wait(player, seq => client.state.dice.sequence === seq + 1, before);
    await gm.waitForTimeout(200); await gm.evaluate(() => client.reconnect());
    await gm.unroute("**/rolls"); await wait(gm, () => status === "connected" && !client.rollFlight);
    assert.equal(await gm.evaluate(() => client.state.dice.sequence), before + 1);
    await wait(gm, () => !engine.dice.state.rolling);
    // Lose both the acknowledgement and stream event. Reconnect recognizes the
    // saved request from receipts rather than generating a replacement result.
    await gm.evaluate(() => client.source.close());
    const next = await gm.evaluate(() => client.state.dice.sequence);
    await gm.route("**/rolls", async route => { await route.fetch(); await route.abort("failed"); });
    await gm.evaluate(() => engine.rollDice()); await wait(gm, () => status === "offline");
    assert.equal(await gm.evaluate(() => !!client.rollFlight), true);
    await gm.evaluate(() => client.reconnect());
    await wait(gm, () => status === "connected" && !client.rollFlight);
    assert.equal(await gm.evaluate(() => client.state.dice.sequence), next + 1);
    await gm.unroute("**/rolls");
    // Expired throws stay in history and do not produce a new visual or sound.
    await wait(player, () => engine.roomThrows.size === 0);
    await player.evaluate(async () => client.reconnect());
    assert.equal(await player.evaluate(() => engine.roomThrows.size), 0);
    assert.equal(await player.evaluate(() => engine.dice.state.history.length), 4);
    for (const page of pages) {
      await page.evaluate(() => { client.close(); engine.leaveRoom(); });
      assert.equal(await page.evaluate(() => JSON.stringify(engine.dice.setup()) === localSetup), true);
      assert.equal(await page.evaluate(() => engine.dice.state.history[0].id), "local", "Leaving restores personal local dice history");
    }
    assert.deepEqual(errors, []);
    console.log("PASS: two-browser shared dice animations/results, concurrent throws, identical world poses at different zooms, group colors, personal settings, lost acknowledgements, reconnect catch-up, expired history and local-table restoration");
  } catch (error) {
    console.error("Dice browser diagnostic:", JSON.stringify(await Promise.all(pages.map(p => p.evaluate(() => ({ status, dice: engine.dice.state, room: client.state.dice, pending: client.rollFlight, notices })).catch(() => null)))));
    throw error;
  } finally {
    for (const page of pages) await page.evaluate(() => { window.client?.close(); window.engine?.dispose(); }).catch(() => {});
    await Promise.all(contexts.map(c => c.close()));
  }
};
