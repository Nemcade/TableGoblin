const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { spawn } = require('node:child_process'), { chromium } = require('playwright');
let server, browser, data;
(async () => {
  fs.mkdirSync('.test-artifacts', { recursive: true });
  await require('esbuild').build({ stdin: { contents: 'export { TableEngine } from "./src/engine"; export { RoomClient } from "./src/room-client";', resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, format: 'iife', globalName: 'GoblinMusicTest', outfile: '.test-artifacts/online-music.js', define: { 'import.meta.url': '""' },
    plugins: process.env.TABLE_GOBLIN_TEST_PLAYER_SOURCE ? [{ name: 'baseline-player', setup(build) {
      build.onLoad({ filter: /room-player\.ts$/ }, () => ({ contents: fs.readFileSync(process.env.TABLE_GOBLIN_TEST_PLAYER_SOURCE, 'utf8'), loader: 'ts', resolveDir: path.resolve('src') }));
    } }] : [] });
  data = fs.mkdtempSync(path.resolve('.test-artifacts/music-'));
  server = spawn(process.execPath, ['scripts/room-server.cjs'], { env: { ...process.env, HOST: '127.0.0.1', PORT: '0', TABLE_GOBLIN_DATA: data }, windowsHide: true });
  server.stderr.on('data', c => process.stderr.write(c));
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Music test server did not start')), 10000);
    server.on('error', e => { clearTimeout(timer); reject(e); });
    server.on('exit', c => { clearTimeout(timer); reject(Error(`Music test server exit ${c}`)); });
    server.stdout.on('data', c => { const url = c.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; if (url) { clearTimeout(timer); resolve(url); } });
  });
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const contexts = await Promise.all([0, 1].map(() => browser.newContext())), pages = await Promise.all(contexts.map(c => c.newPage()));
  const [gm, player] = pages, errors = [], wait = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 25000 });
  let room;
  for (const page of pages) {
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/music-harness', r => r.fulfill({ contentType: 'text/html', body: '<canvas style="width:100vw;height:100vh"></canvas>' }));
    await page.goto(base + '/music-harness'); await page.addScriptTag({ path: path.resolve('.test-artifacts/online-music.js') });
    room = await page.evaluate(async room => {
      const request = room ? { name: 'Listener', color: '#4477bb', invite: room.invite } : { name: 'GM', color: '#779955' };
      const state = await (await fetch(room ? `/api/rooms/${room.id}/join` : '/api/rooms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })).json();
      window.engine = new GoblinMusicTest.TableEngine(document.querySelector('canvas'), () => {}, () => {});
      await new Promise(r => requestAnimationFrame(r));
      window.client = new GoblinMusicTest.RoomClient(engine, state, (_, value) => window.status = value, () => {}); return state;
    }, room);
    await wait(page, () => status === 'connected');
  }
  const bytes = fs.readFileSync('tests/fixtures/network-music.ogg');
  await gm.evaluate(async encoded => {
    await engine.addFiles([new File([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], 'Network music.ogg', { type: 'audio/ogg' })]);
  }, bytes.toString('base64'));
  await wait(gm, () => engine.scene.objects[0]?.audio?.startsWith('/api/rooms/') && !client.pending && !client.inFlight);
  const audio = await gm.evaluate(() => engine.scene.objects[0].id);
  await wait(player, id => engine.renderer.audios.get(id)?.audio.readyState >= 3, audio);
  await player.mouse.click(5, 5); await player.evaluate(() => engine.enableRoomSound());
  await gm.evaluate(id => engine.restartAudio(id), audio);
  await wait(player, id => !engine.renderer.audios.get(id).audio.paused && engine.renderer.audios.get(id).audio.currentTime > .5, audio);
  await player.evaluate(id => {
    const audio = engine.renderer.audios.get(id).audio;
    window.music = audio; window.seeks = 0; window.delivered = 0; window.delays = [];
    audio.addEventListener('seeking', () => seeks++);
    const receive = client.receiveEvent.bind(client); let tail = Promise.resolve(), index = 0;
    // Preserve SSE ordering, but alternately queue packets and flush a burst,
    // as a busy tunnel or slow connection can do while objects are being edited.
    client.receiveEvent = event => {
      const captured = performance.now(), due = captured + (index++ % 6 === 0 ? 1100 : 0);
      tail = tail.then(async () => {
        await new Promise(r => setTimeout(r, Math.max(0, due - performance.now())));
        delays.push(performance.now() - captured); receive(event); delivered++;
        await new Promise(r => setTimeout(r, 100));
      });
    };
    window.musicStartedAt = audio.currentTime; window.checkStartedAt = performance.now();
  }, audio);
  for (let i = 0; i < 24; i++) {
    await gm.evaluate(i => {
      if (i % 4 === 0) engine.addShape('circle');
      else { const object = engine.scene.objects.at(-1); object.x += 15; client.requestSave(); }
    }, i);
    await new Promise(r => setTimeout(r, 180));
  }
  await wait(player, () => delivered >= 20);
  const result = await player.evaluate(() => ({ seeks, delivered, maximumDelay: Math.max(...delays), elapsed: (performance.now() - checkStartedAt) / 1000,
    progress: music.currentTime - musicStartedAt, ready: music.readyState, paused: music.paused, muted: music.muted, sequence: client.state.playback.sequence }));
  assert(result.maximumDelay >= 1000, 'The listener really received queued updates');
  assert.equal(result.seeks, 0, 'Remote OGG music must not seek while unrelated objects are created/moved');
  assert.equal(result.paused, false); assert.equal(result.muted, false);
  assert(result.progress > result.elapsed - .3 && result.progress < result.elapsed + .3, 'Music progresses continuously');
  assert.equal(result.sequence, await gm.evaluate(() => client.state.playback.sequence), 'Object edits never send playback commands');
  assert.deepEqual(errors, []);
  console.log('PASS: real remote OGG playback stays continuous through ordered 1.1-second update delays and object creation/movement:', JSON.stringify(result));
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server && server.exitCode === null) { const exited = new Promise(r => server.once('exit', r)); server.kill(); await exited; }
  if (data) fs.rmSync(data, { recursive: true, force: true });
});
