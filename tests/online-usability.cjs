const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
module.exports = async (browser, base) => {
  require('esbuild').buildSync({ stdin: { contents: 'export { TableEngine } from "./src/engine"; export { RoomClient } from "./src/room-client"; export { worldTransform } from "./src/model";', resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, format: 'iife', globalName: 'UsabilityTest', outfile: '.test-artifacts/online-usability.js', define: { 'import.meta.url': '""' } });
  const contexts = await Promise.all([browser.newContext({ viewport: { width: 1000, height: 720 } }), browser.newContext({ viewport: { width: 1000, height: 720 }, deviceScaleFactor: 3 })]);
  const [gm, player] = await Promise.all(contexts.map(c => c.newPage()));
  const errors = [], wait = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 20000 });
  let room;
  try {
    for (const [i, page] of [gm, player].entries()) {
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/usability-harness', r => r.fulfill({ contentType: 'text/html', body: '<style>body{margin:0}canvas{width:100vw;height:100vh}</style><canvas></canvas>' }));
      await page.goto(base + '/usability-harness'); await page.addScriptTag({ path: path.resolve('.test-artifacts/online-usability.js') });
      const value = await page.evaluate(async ({ room, i }) => {
        const state = await (await fetch(room ? `/api/rooms/${room.id}/join` : '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: i ? 'Blue player' : 'Orange GM', color: i ? '#558fe5' : '#ed8039', ...(room ? { invite: room.invite } : {}) }) })).json();
        window.engine = new UsabilityTest.TableEngine(document.querySelector('canvas'), () => {}, () => {});
        await new Promise(r => requestAnimationFrame(r));
        window.client = new UsabilityTest.RoomClient(engine, state, (_, value) => window.status = value, () => {});
        return state;
      }, { room, i });
      if (!room) room = value;
      await wait(page, () => status === 'connected');
    }
    await gm.evaluate(() => engine.setMood({ motion: 'still' }));
    await wait(gm, () => !client.pending && !client.inFlight);
    await player.evaluate(() => { engine.camera = { x: 420, y: 300, zoom: .6 }; engine.invalidate(); });
    const beforeTable = await gm.evaluate(() => JSON.stringify(client.state.table));
    await gm.evaluate(() => engine.setTool('laser'));
    await gm.mouse.move(350, 360); await gm.mouse.down();
    for (const [x, y] of [[410, 370], [490, 390], [550, 350], [620, 330], [700, 400]]) {
      await gm.mouse.move(x, y, { steps: 5 }); await gm.waitForTimeout(140);
    }
    await wait(player, id => engine.roomLasers.get(id)?.points.length > 6, room.me.id);
    const pixel = (page, remote) => page.evaluate(({ remote, id }) => {
      const point = remote ? engine.roomLasers.get(id).points.at(-1) : engine.lasers.at(-1), c = engine.camera;
      const dpr = Math.min(devicePixelRatio, 2), x = (point.x * c.zoom + c.x + 3) * dpr, y = (point.y * c.zoom + c.y) * dpr;
      return [...engine.canvas.getContext('2d').getImageData(Math.floor(x), Math.floor(y), 1, 1).data];
    }, { remote, id: room.me.id });
    const own = await pixel(gm, false), received = await pixel(player, true);
    assert(own[0] > own[1] && own[1] > own[2]); assert(received[0] > received[1] && received[1] > received[2], 'Remote laser matches the sender color across zoom and DPR');
    await player.screenshot({ path: '.test-artifacts/remote-laser.png' });
    await gm.evaluate(() => client.updateProfile('Green GM', '#79b85a', client.state.me.profileVersion ?? 0));
    await wait(player, () => engine.roomPeers.some(p => p.person.name === 'Green GM' && p.person.color === '#79b85a'));
    await gm.waitForTimeout(150);
    const greenOwn = await pixel(gm, false), greenRemote = await pixel(player, true);
    assert(greenOwn[1] > greenOwn[0] && greenRemote[1] > greenRemote[0], 'A profile change recolors both local and remote active trails');
    await gm.mouse.up();
    await wait(player, id => !engine.roomLasers.get(id)?.points.length, room.me.id);
    assert.equal(await gm.evaluate(() => JSON.stringify(client.state.table)), beforeTable, 'Lasers leave table/history untouched');
    const bytes = fs.readFileSync('tests/fixtures/network-music.ogg');
    await gm.evaluate(async encoded => engine.addFiles([new File([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], 'Music.ogg', { type: 'audio/ogg' })]), bytes.toString('base64'));
    await wait(gm, () => engine.scene.objects.some(o => o.audio?.startsWith('/api/rooms/')) && !client.pending && !client.inFlight);
    const audio = await gm.evaluate(() => engine.scene.objects.find(o => o.audio).id);
    await wait(player, id => engine.renderer.audios.get(id)?.audio.readyState >= 3, audio);
    await gm.evaluate(id => engine.restartAudio(id), audio);
    await wait(player, id => !engine.renderer.audios.get(id).audio.paused, audio);
    const indicator = () => player.evaluate(id => {
      const object = engine.scene.objects.find(o => o.id === id), t = UsabilityTest.worldTransform(engine.scene, object), c = engine.camera, dpr = Math.min(devicePixelRatio, 2);
      const x = (t.x * c.zoom + c.x + t.width * c.zoom * .3) * dpr, y = (t.y * c.zoom + c.y - t.height * c.zoom * .2) * dpr;
      const w = Math.ceil(t.width * c.zoom * .19 * dpr), h = Math.ceil(t.height * c.zoom * .4 * dpr);
      return [...engine.canvas.getContext('2d').getImageData(Math.floor(x), Math.floor(y), w, h).data].join(',');
    }, audio);
    const first = await indicator(); await player.waitForTimeout(400); assert.notEqual(await indicator(), first, 'Playback indicator animates on a still table');
    await gm.evaluate(id => engine.togglePlayback(id), audio); await wait(player, id => engine.renderer.audios.get(id).audio.paused, audio);
    await player.waitForTimeout(200); const paused = await indicator(); await player.waitForTimeout(350); assert.equal(await indicator(), paused, 'Paused indicator is still');
    await gm.evaluate(id => engine.restartAudio(id), audio);
    const ui = await contexts[1].newPage(); ui.on('pageerror', e => errors.push(e.message));
    await ui.goto(`${base}/#room=${room.id}`);
    const listen = ui.getByRole('button', { name: 'Enable room sound', exact: true }); await listen.waitFor();
    assert.match(await listen.innerText(), /Room audio available/);
    await ui.screenshot({ path: '.test-artifacts/audio-listen-desktop.png' });
    await ui.setViewportSize({ width: 390, height: 780 });
    const bounds = await listen.boundingBox(), tools = await ui.getByRole('navigation', { name: 'Table tools', exact: true }).boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y + bounds.height < tools.y, 'Mobile sound prompt stays clear of the toolbar');
    const hints = await ui.locator('.navigation-hint').boundingBox();
    if (hints) assert(bounds.y + bounds.height < hints.y, 'The sound prompt leaves navigation hints readable');
    await ui.screenshot({ path: '.test-artifacts/audio-listen-mobile.png' });
    const revision = await gm.evaluate(() => client.state.revision);
    await listen.click(); await listen.waitFor({ state: 'hidden' });
    assert.equal(await gm.evaluate(() => client.state.revision), revision, 'Listening permission remains personal');
    await ui.reload(); await ui.getByRole('button', { name: 'Enable room sound', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: smoothed/fading remote lasers, live identity colors, zoom/DPR alignment, still-table audio activity, pause, and desktop/mobile personal sound prompts');
  } finally { await Promise.all(contexts.map(c => c.close())); }
};
