const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { spawn } = require('node:child_process'), { chromium } = require('playwright');
let server, browser;
(async () => {
  fs.mkdirSync('.test-artifacts', { recursive: true });
  require('esbuild').buildSync({ stdin: { contents: 'export { TableEngine } from "./src/engine"; export { RoomClient } from "./src/room-client";', resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, format: 'iife', globalName: 'GoblinLiveTest', outfile: '.test-artifacts/online-live.js', define: { 'import.meta.url': '""' } });
  const data = fs.mkdtempSync(path.resolve('.test-artifacts/live-'));
  server = spawn(process.execPath, ['scripts/room-server.cjs'], { env: { ...process.env, HOST: '127.0.0.1', PORT: '0', TABLE_GOBLIN_DATA: data, TABLE_GOBLIN_ICE_SERVERS: '[]' }, windowsHide: true });
  server.stderr.on('data', c => process.stderr.write(c));
  const base = await new Promise((resolve, reject) => { server.on('exit', c => reject(Error(`Test server exit ${c}`))); server.stdout.on('data', c => { const u = c.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; if (u) resolve(u); }); });
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext())), pages = await Promise.all(contexts.map(c => c.newPage()));
  const [gm, player, late] = pages, errors = [], wait = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 25000 });
  async function init(page, room) {
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/live-harness', r => r.fulfill({ contentType: 'text/html', body: '<style>canvas{width:100vw;height:100vh}</style><canvas></canvas>' }));
    await page.goto(base + '/live-harness'); await page.addScriptTag({ path: path.resolve('.test-artifacts/online-live.js') });
    return page.evaluate(async room => {
      window.api = async (u, v) => (await fetch(u, v ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) } : {})).json();
      const state = room ? await api(`/api/rooms/${room.id}/join`, { name: 'Listener', color: '#4477bb', invite: room.invite }) : await api('/api/rooms', { name: 'Live GM', color: '#779955' });
      window.notices = []; window.roomStatus = 'offline';
      window.engine = new GoblinLiveTest.TableEngine(document.querySelector('canvas'), v => window.view = v, t => notices.push(t));
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      window.client = new GoblinLiveTest.RoomClient(engine, state, (_, s) => window.roomStatus = s, t => notices.push(t));
      window.capture = (w = 160, h = 90, color = '#dd4411') => {
        const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d'); let n = 0;
        const draw = () => { ctx.fillStyle = color; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#fff'; ctx.fillRect((n++ * 3) % w, 5, 10, 10); };
        draw(); setInterval(draw, 40); return c.captureStream(25);
      }; return state;
    }, room);
  }
  try {
    const room = await init(gm); await wait(gm, () => roomStatus === 'connected');
    await init(player, room); await wait(player, () => roomStatus === 'connected');
    await gm.evaluate(() => api(`/api/rooms/${client.state.id}/permissions`, { playerEditing: true })); await wait(player, () => engine.roomCreating);
    const source = await gm.evaluate(async () => { window.original = capture(); await engine.addCamera(original, 'Test camera'); return engine.scene.objects[0].id; });
    await wait(player, id => engine.media.get(id)?.video.videoWidth === 160 && engine.roomLive.status(id) === 'Live', source);
    assert.equal(await player.evaluate(id => engine.roomLive.canConnect(id), source), false);
    const pixel = await player.evaluate(id => { const c = document.createElement('canvas'); c.width = 160; c.height = 90; const ctx = c.getContext('2d'); ctx.drawImage(engine.media.get(id).video, 0, 0); return [...ctx.getImageData(100, 60, 1, 1).data]; }, source);
    assert.ok(pixel[0] > 180 && pixel[1] < 100, 'Actual WebRTC video frames arrive');
    await gm.evaluate(id => engine.duplicate(new Set([id])), source); await wait(player, () => engine.scene.objects.length === 2);
    assert.equal(await player.evaluate(() => engine.roomLive.peers.size), 1, 'Copies share transport');
    await gm.evaluate(id => { engine.scene.objects.find(o => o.id === id).crop = { x: .1, y: .1, width: .7, height: .7 }; client.requestSave(); }, source);
    await wait(player, id => engine.scene.objects.find(o => o.id === id)?.crop?.x === .1, source);
    await gm.evaluate(async id => { window.replacement = capture(90, 160); await engine.addCamera(replacement, 'Replacement', id); }, source);
    await wait(player, id => engine.media.get(id)?.video.videoWidth === 90, source);
    assert.equal(await gm.evaluate(() => original.getTracks()[0].readyState), 'ended');
    assert.equal(await player.evaluate(id => engine.scene.objects.find(o => o.id === id).crop.x, source), .1);
    await gm.evaluate(id => engine.stopScreen(id), source); await wait(player, id => !engine.media.has(id), source);
    assert.equal(await player.evaluate(() => engine.scene.objects.length), 2);
    await gm.evaluate(async id => { window.reconnected = capture(); await engine.addCamera(reconnected, 'Reconnected', id); }, source);
    await wait(player, id => engine.media.get(id)?.video.videoWidth === 160, source);
    await init(late, room); await wait(late, id => engine.media.get(id)?.video.videoWidth === 160, source);
    await player.evaluate(id => engine.roomLive.retry(id), source); await wait(player, id => engine.media.get(id)?.video.videoWidth === 160, source);
    console.log('Live camera: frames, copies, crop, replacement, stop/reconnect, late join, retry passed.');
    await gm.mouse.click(10, 10);
    const audio = await gm.evaluate(async () => { window.ac = new AudioContext(); await ac.resume(); const o = ac.createOscillator(), d = ac.createMediaStreamDestination(); o.connect(d); o.start(); window.audioStream = d.stream; return engine.audio.add(audioStream, 'Test microphone', 'input'); });
    await wait(player, () => engine.roomLive.remoteAudio().some(s => s.status === 'Live'));
    assert.equal(await player.evaluate(() => engine.roomSoundNeeded), true);
    await player.mouse.click(10, 10); await player.evaluate(() => engine.enableRoomSound());
    await wait(player, id => { const s = engine.roomLive.sources.find(s => s.source === id); return !engine.roomLive.peers.get(`${id}:${s.browser}`).media.video.muted; }, audio);
    await player.evaluate(async id => {
      const s = engine.roomLive.sources.find(s => s.source === id), stream = engine.roomLive.peers.get(`${id}:${s.browser}`).media.stream;
      window.receiverAudio = new AudioContext(); await receiverAudio.resume(); window.meter = receiverAudio.createAnalyser(); receiverAudio.createMediaStreamSource(stream).connect(meter);
    }, audio);
    await wait(player, () => { const buffer = new Uint8Array(meter.fftSize); meter.getByteTimeDomainData(buffer); return buffer.some(n => Math.abs(n - 128) > 10); });
    await player.evaluate(id => engine.roomLive.listen(id, { volume: .2, muted: true }), audio);
    assert.equal(await late.evaluate(id => engine.roomLive.remoteAudio().find(s => s.source === id).volume, audio), .65);
    assert.equal(await gm.evaluate(() => audioStream.getAudioTracks()[0].enabled), true);
    await gm.evaluate(id => engine.audio.set(id, { muted: true }), audio); assert.equal(await gm.evaluate(() => audioStream.getAudioTracks()[0].enabled), false);
    await gm.evaluate(id => engine.audio.stop(id), audio); await wait(player, () => !engine.roomLive.remoteAudio().length);
    console.log('Live audio: tracks, sound gate, personal volume/mute, input mute and cleanup passed.');
    const screen = await gm.evaluate(async () => {
      navigator.mediaDevices.getDisplayMedia = async options => {
        const stream = capture(240, 135);
        if (options.audio) { const d = ac.createMediaStreamDestination(), o = ac.createOscillator(); o.connect(d); o.start(); stream.addTrack(d.stream.getAudioTracks()[0]); }
        window.displayStream = stream; return stream;
      };
      await engine.addScreen(); return engine.scene.objects.at(-1).id;
    });
    await wait(player, id => engine.media.get(id)?.video.videoWidth === 240, screen);
    assert.equal(await player.evaluate(id => engine.scene.objects.find(o => o.id === id).kind, screen), 'screen');
    await gm.evaluate(id => engine.delete(new Set([id])), screen); await wait(player, id => !engine.media.has(id), screen);
    const tabAudio = await gm.evaluate(async () => { await engine.addDisplayAudio(); return engine.audio.list()[0].id; });
    await wait(player, id => engine.roomLive.remoteAudio().some(s => s.source === id && s.status === 'Live'), tabAudio);
    assert.equal(await player.evaluate(id => { const s = engine.roomLive.sources.find(s => s.source === id); return engine.roomLive.peers.get(`${id}:${s.browser}`).media.stream.getVideoTracks().length; }, tabAudio), 0, 'Audio sharing never transmits the picker-required video track');
    await gm.evaluate(id => engine.audio.stop(id), tabAudio); await wait(player, () => !engine.roomLive.remoteAudio().length);
    assert.equal(await gm.evaluate(() => displayStream.getVideoTracks()[0].readyState), 'ended');
    console.log('Screen capture and tab/system audio: shared tracks and capture cleanup passed.');
    await require('./online-live-ui.cjs')({ browser, contexts, pages, base, room, gm, player, late, source, wait, errors });
    const results = await player.evaluate(async source => {
      const s = engine.roomLive.sources.find(s => s.source === source), root = `/api/rooms/${client.state.id}/live`;
      const post = async v => (await fetch(root, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client: client.browser, source, ...v }) })).status;
      return [await post({ action: 'publish', generation: crypto.randomUUID(), kind: 'camera', label: 'Stolen' }), await post({ action: 'stop', generation: s.generation }),
        await post({ action: 'signal', generation: s.generation, peer: crypto.randomUUID(), connection: crypto.randomUUID(), message: { type: 'offer', sdp: 'v=0' } }),
        await post({ action: 'subscribe', generation: crypto.randomUUID(), connection: crypto.randomUUID() })];
    }, source);
    assert.deepEqual(results, [403, 403, 403, 409]); assert.equal((await fetch(`${base}/api/rooms/${room.id}/live`)).status, 401);
    const saved = fs.readFileSync(path.join(data, `${room.id}.json`), 'utf8'); assert.ok(!saved.includes('a=ice-') && !saved.includes('generation') && !saved.includes('Test microphone'));
    await gm.evaluate(() => engine.delete(new Set(engine.scene.objects.map(o => o.id)))); await wait(player, () => !engine.media.size && !engine.roomLive.sources.length);
    assert.equal(await gm.evaluate(() => reconnected.getTracks()[0].readyState), 'ended');
    const playerSource = await player.evaluate(async () => { window.playerCapture = capture(); await engine.addCamera(playerCapture, 'Player camera'); return engine.scene.objects.at(-1).id; });
    await wait(gm, id => engine.media.get(id)?.video.videoWidth === 160, playerSource);
    const playerId = await player.evaluate(() => client.state.me.id);
    await gm.evaluate(async member => {
      const state = await api(`/api/rooms/${client.state.id}/state`);
      await api(`/api/rooms/${client.state.id}/manage`, { id: crypto.randomUUID(), kind: 'remove', invite: state.invite, member });
    }, playerId);
    await wait(player, () => roomStatus === 'removed');
    await wait(gm, id => !engine.media.has(id), playerSource);
    assert.equal(await player.evaluate(() => playerCapture.getTracks()[0].readyState), 'ended', 'Removal stops a real publishing capture');
    assert.equal(await player.evaluate(() => engine.roomLive), null);
    console.log('Player publication and active capture/session revocation passed.');
    const finalSource = await gm.evaluate(async () => { window.finalCapture = capture(); await engine.addCamera(finalCapture, 'Leave test'); return engine.scene.objects.at(-1).id; });
    await wait(late, id => engine.media.get(id)?.video.videoWidth === 160, finalSource);
    await gm.evaluate(() => { client.close(); engine.leaveRoom(); }); await wait(late, () => !engine.media.size && !engine.roomLive.sources.length);
    assert.equal(await gm.evaluate(() => finalCapture.getTracks()[0].readyState), 'ended'); assert.deepEqual(errors, []);
    console.log('Live ownership, stale signals, ephemeral signaling, last-copy cleanup and room leave passed.');
  } catch (error) {
    for (const [i, p] of pages.entries()) console.error('Browser', i, await p.evaluate(() => ({ notices, roomStatus, sources: engine.roomLive?.sources, peers: engine.roomLive && [...engine.roomLive.peers.values()].map(p => ({ status: p.status, state: p.pc.connectionState, signaling: p.pc.signalingState })) })).catch(() => ({})));
    throw error;
  } finally { await Promise.all(contexts.map(c => c.close())); }
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { await browser?.close(); if (server?.exitCode === null) { const ended = new Promise(r => server.once('exit', r)); server.kill(); await ended; } });
