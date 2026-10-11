const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http"), { randomUUID } = require("node:crypto");
module.exports = async (base, api, operation, data) => {
  const gm = await api("/api/rooms", null, { name: "Media GM", color: "#aa8844" }), root = `/api/rooms/${gm.json.id}`;
  const player = await api(root + "/join", null, { name: "Listener", color: "#4466aa", invite: gm.json.invite });
  const mp4 = fs.readFileSync(path.join(__dirname, "fixtures/audio-only.mp4"));
  const upload = async (cookie, bytes = mp4, type = "video/mp4") => {
    const response = await fetch(base + root + "/media", { method: "POST", headers: { "Content-Type": type, ...(cookie ? { Cookie: cookie } : {}) }, body: bytes });
    return { status: response.status, json: await response.json() };
  };
  assert.equal((await upload(null)).status, 401); assert.equal((await upload(player.cookie)).status, 403);
  for (const [bytes, type] of [[Buffer.from("<html>bad</html>"), "video/mp4"], [mp4.subarray(0, mp4.length - 1), "video/mp4"], [mp4, "audio/wav"], [mp4, "image/png"]]) assert.equal((await upload(gm.cookie, bytes, type)).status, 415);
  const media = (await upload(gm.cookie)).json.media;
  assert.match(media, /^\/api\/rooms\/[a-f0-9]{16}\/media\/[a-f0-9]{64}\.mp4$/);
  assert.equal((await upload(gm.cookie, mp4, "audio/mp4")).json.media, media);
  assert.equal(fs.readdirSync(path.join(data, "media", gm.json.id)).length, 1);
  const read = (cookie, headers = {}, method = "GET") => fetch(base + media, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } });
  assert.equal((await read(null, { Range: "bytes=0-15" })).status, 401);
  const whole = await read(player.cookie), tag = whole.headers.get("etag");
  assert.equal(whole.status, 200); assert.equal(whole.headers.get("content-type"), "video/mp4"); assert.deepEqual(Buffer.from(await whole.arrayBuffer()), mp4);
  for (const [range, start, end] of [["bytes=0-15", 0, 15], ["bytes=32-", 32, mp4.length - 1], ["bytes=-24", mp4.length - 24, mp4.length - 1]]) {
    const response = await read(player.cookie, { Range: range }); assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), `bytes ${start}-${end}/${mp4.length}`); assert.deepEqual(Buffer.from(await response.arrayBuffer()), mp4.subarray(start, end + 1));
  }
  assert.equal((await read(player.cookie, { Range: `bytes=${mp4.length}-` })).status, 416);
  assert.equal((await read(player.cookie, { Range: "bytes=40-10" })).status, 416);
  assert.equal((await read(player.cookie, { "If-None-Match": tag })).status, 304);
  assert.equal((await read(null, { "If-None-Match": tag })).status, 401);
  assert.equal((await read(player.cookie, {}, "HEAD")).headers.get("content-length"), String(mp4.length));
  assert.equal((await read(player.cookie, { Range: "bytes=0-15", "If-Range": '"stale"' })).status, 200);
  const table = structuredClone(gm.json.table), obj = { id: "room-audio", name: "Audio-only MP4", filename: "mobile.mp4", kind: "audio", audio: media, paused: true, loop: false, volume: .65,
    x: 0, y: 0, width: 300, height: 100, rotation: 0, parentId: null, color: "#aabbcc", strokes: [] }; table.scene.objects.push(obj);
  let state = (await api(root + "/operations", gm.cookie, operation(gm.json, table))).json; assert.equal(state.table.scene.objects[0].audio, media);
  assert.equal((await api(root + "/operations", player.cookie, operation(state, { ...table, scene: { objects: [{ ...obj, x: 100 }], strokes: [] } }))).status, 403);
  for (const ref of [media.replace(gm.json.id, "f".repeat(16)), media.replace(/\/[a-f0-9]{64}\./, "/" + "f".repeat(64) + "."), "blob:local-only", "asset:unuploaded"]) {
    const forged = structuredClone(table); forged.scene.objects[0].audio = ref;
    assert.equal((await api(root + "/operations", gm.cookie, operation(state, forged))).status, 400);
  }
  assert.equal((await api(root + "/undo", gm.cookie, { id: randomUUID() })).status, 200);
  state = (await api(root + "/redo", gm.cookie, { id: randomUUID() })).json; assert.equal(state.table.scene.objects[0].audio, media);
  await api(root + "/access", gm.cookie, { ids: [obj.id], policy: { owner: gm.json.me.id, shared: true, editors: [] }, revision: state.revision });
  assert.equal((await upload(player.cookie)).status, 200);
  // Hold an authenticated upload while the GM removes its participant.
  let finish;
  const pending = new Promise((resolve, reject) => {
    const req = http.request(base + root + "/media", { method: "POST", headers: { Cookie: player.cookie, "Content-Type": "video/mp4", "Content-Length": mp4.length, Expect: "100-continue" } }, res => {
      const chunks = []; res.on("data", c => chunks.push(c)); res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks)) }));
    }); req.on("error", reject); req.on("continue", () => { req.write(mp4.subarray(0, 16)); finish = () => req.end(mp4.subarray(16)); }); req.flushHeaders();
  });
  const deadline = Date.now() + 5000; while (!finish && Date.now() < deadline) await new Promise(r => setTimeout(r, 5)); assert.ok(finish);
  await api(root + "/manage", gm.cookie, { id: randomUUID(), kind: "remove", member: player.json.me.id, invite: state.invite });
  finish(); const ended = await pending; assert.equal(ended.status, 403); assert.equal(ended.json.code, "ROOM_REMOVED");
  assert.equal((await read(player.cookie, { Range: "bytes=0-15" })).status, 403);
  console.log("PASS: private file media uploads, container rejection, deduplication, byte-range seeking, ownership checks, undo, removed credentials and in-progress upload revocation");
  return { async afterRestart(newBase, request) {
    assert.equal((await request(root + "/state", gm.cookie)).json.table.scene.objects[0].audio, media);
    const response = await fetch(newBase + media, { headers: { Cookie: gm.cookie, Range: "bytes=0-15" } });
    assert.equal(response.status, 206); assert.deepEqual(Buffer.from(await response.arrayBuffer()), mp4.subarray(0, 16));
    assert.equal((await fetch(newBase + media, { headers: { Cookie: player.cookie } })).status, 403);
  } };
};
