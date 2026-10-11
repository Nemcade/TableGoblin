const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHmac } = require('node:crypto');
const { createIce } = require('../scripts/room-ice.cjs');
const { setup, settings } = require('../deploy/setup.cjs');
const secret = 'a'.repeat(64);
const urls = ['turn:table.example.com:3478?transport=udp', 'turn:table.example.com:3478?transport=tcp'];

test('coturn credentials are signed, expire, and differ by room/member', () => {
  let time = 1_800_000_000_000;
  const config = createIce({ TABLE_GOBLIN_TURN_SECRET: secret, TABLE_GOBLIN_TURN_URLS: JSON.stringify(urls) }, () => time);
  const value = config({ id: 'room-a' }, { id: 'member-a' });
  const server = value.iceServers[0];
  assert.deepEqual(server.urls, urls);
  assert.equal(value.iceExpiresAt, time + 86400000);
  assert.equal(server.username, `${value.iceExpiresAt / 1000}:room-a:member-a`);
  assert.equal(server.credential, createHmac('sha1', secret).update(server.username).digest('base64'));
  assert(!JSON.stringify(value).includes(secret));
  assert.notEqual(config({ id: 'room-b' }, { id: 'member-a' }).iceServers[0].credential, server.credential);
  assert.notEqual(config({ id: 'room-a' }, { id: 'member-b' }).iceServers[0].credential, server.credential);
  time += 86400000;
  assert.equal(config({ id: 'room-a' }, { id: 'member-a' }).iceExpiresAt, time + 86400000);
});

test('static ICE settings remain supported; broken relay settings fail without leaking secrets', () => {
  assert.deepEqual(createIce({})(), { iceServers: [] });
  const staticServers = [{ urls: 'stun:example.com:3478' }, { urls: 'turn:example.com:3478', username: 'user', credential: 'password' }];
  assert.deepEqual(createIce({ TABLE_GOBLIN_ICE_SERVERS: JSON.stringify(staticServers) })(), { iceServers: staticServers });
  const invalid = [
    { TABLE_GOBLIN_TURN_SECRET: secret },
    { TABLE_GOBLIN_TURN_URLS: JSON.stringify(urls) },
    { TABLE_GOBLIN_TURN_SECRET: secret, TABLE_GOBLIN_TURN_URLS: '["https://example.com"]' },
    { TABLE_GOBLIN_ICE_SERVERS: '[{"urls":"turn:example.com"}]' },
    { TABLE_GOBLIN_ICE_SERVERS: secret },
  ];
  for (const env of invalid) {
    assert.throws(() => createIce(env), e => { assert(!e.message.includes(secret)); return true; });
  }
});

test('deployment setup supports public/private mapping and preserves existing configuration', t => {
  fs.mkdirSync('.test-artifacts', { recursive: true });
  const folder = fs.mkdtempSync(path.resolve('.test-artifacts/deployment-setup-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const destination = path.join(folder, '.env');
  assert.deepEqual(settings('TABLE.EXAMPLE.COM', '203.0.113.20', '10.0.0.5'), {
    domain: 'table.example.com', relayIp: '10.0.0.5', externalIp: '203.0.113.20/10.0.0.5' });
  setup(['table.example.com', '203.0.113.20'], destination);
  const initial = fs.readFileSync(destination, 'utf8');
  assert.match(initial, /TURN_SECRET=[a-f0-9]{64}\n/);
  assert.match(initial, /RELAY_IP=203.0.113.20\n/);
  assert.throws(() => setup(['other.example.com', '203.0.113.21'], destination), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(destination, 'utf8'), initial);
  for (const args of [['https://table.example.com', '203.0.113.20'], ['localhost', '203.0.113.20'],
    ['table.example.com\nINJECT=x', '203.0.113.20'], ['table.example.com', '127.0.0.1'], ['table.example.com', '10.0.0.5']])
    assert.throws(() => settings(...args));
});

test('production API exposes credentials only to room members, keeps them off disk and survives restart', async t => {
  fs.mkdirSync('.test-artifacts', { recursive: true });
  const folder = fs.mkdtempSync(path.resolve('.test-artifacts/deployment-api-'));
  let child;
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited;
  }
  t.after(async () => { await stop(); fs.rmSync(folder, { recursive: true, force: true }); });
  async function start() {
    child = spawn(process.execPath, ['scripts/room-server.cjs'], { windowsHide: true,
      env: { ...process.env, PORT: '0', HOST: '127.0.0.1', NODE_ENV: 'production', TABLE_GOBLIN_DATA: folder,
        TABLE_GOBLIN_ICE_SERVERS: '', TABLE_GOBLIN_TURN_SECRET: secret, TABLE_GOBLIN_TURN_URLS: JSON.stringify(urls) } });
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Deployment test server did not start')), 10000);
      child.once('error', e => { clearTimeout(timer); reject(e); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Deployment test server exited: ${code}`)); });
      child.stdout.on('data', chunk => { const url = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
        if (url) { clearTimeout(timer); resolve(url); } });
      child.stderr.on('data', chunk => process.stderr.write(chunk));
    });
  }
  let base = await start();
  async function api(endpoint, cookie, payload) {
    const r = await fetch(base + endpoint, { headers: { ...(cookie ? { Cookie: cookie } : {}),
      ...(payload ? { 'Content-Type': 'application/json' } : {}) }, ...(payload ? { method: 'POST', body: JSON.stringify(payload) } : {}) });
    return { status: r.status, body: await r.json(), cookie: r.headers.get('set-cookie') };
  }
  const gm = await api('/api/rooms', null, { name: 'Deployment GM', color: '#aabbcc' });
  assert.equal(gm.status, 201); assert.match(gm.cookie, /Secure/);
  const root = `/api/rooms/${gm.body.id}`, gmCookie = gm.cookie.split(';')[0];
  assert.equal((await api(root + '/live')).status, 401);
  const stranger = await api('/api/rooms', null, { name: 'Other GM', color: '#aabbcc' });
  assert.equal((await api(root + '/live', stranger.cookie.split(';')[0])).status, 401);
  const player = await api(root + '/join', null, { name: 'Player', color: '#aabbcc', invite: gm.body.invite });
  const playerCookie = player.cookie.split(';')[0];
  const gmConfig = await api(root + '/live', gmCookie), playerConfig = await api(root + '/live', playerCookie);
  assert.equal(gmConfig.status, 200); assert.equal(playerConfig.status, 200);
  assert.notEqual(gmConfig.body.iceServers[0].credential, playerConfig.body.iceServers[0].credential);
  assert(!JSON.stringify(gm.body).includes('iceServers'));
  assert(!JSON.stringify(gmConfig.body).includes(secret));
  await stop();
  for (const file of fs.readdirSync(folder).filter(f => f.endsWith('.json'))) {
    const saved = fs.readFileSync(path.join(folder, file), 'utf8');
    assert(!saved.includes(secret)); assert(!saved.includes(gmConfig.body.iceServers[0].credential)); assert(!saved.includes('iceServers'));
  }
  base = await start();
  const restored = await api(root + '/live', gmCookie);
  assert.equal(restored.status, 200); assert.deepEqual(restored.body.iceServers[0].urls, urls);
  assert.equal((await api(root + '/state', playerCookie)).status, 200);
  const removed = await api(root + '/manage', gmCookie, { id: require('node:crypto').randomUUID(), kind: 'remove',
    invite: gm.body.invite, member: player.body.me.id });
  assert.equal(removed.status, 200);
  const revoked = await api(root + '/live', playerCookie);
  assert.equal(revoked.status, 403); assert.equal(revoked.body.code, 'ROOM_REMOVED');
  assert.equal(revoked.body.iceServers, undefined);
});
