const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), { randomUUID } = require("node:crypto");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPioAAAAASUVORK5CYII=", "base64");
module.exports = async (base, api, operation, data) => {
  const gm = await api("/api/rooms", null, { name: "Artwork GM", color: "#ccaa55" }), root = `/api/rooms/${gm.json.id}`;
  const player = await api(root + "/join", null, { invite: gm.json.invite, name: "Reader", color: "#5577cc" });
  const other = await api("/api/rooms", null, { name: "Other GM", color: "#ccaa55" });
  const upload = async (cookie, bytes = png, type = "image/png", extra = {}) => {
    const response = await fetch(base + root + "/assets", { method: "POST", headers: { "Content-Type": type, ...(cookie ? { Cookie: cookie } : {}), ...extra }, body: bytes });
    return { status: response.status, value: await response.json() };
  };
  assert.equal((await upload(null)).status, 401); assert.equal((await upload(player.cookie)).status, 403);
  for (const [bytes, type] of [[Buffer.from("<svg></svg>"), "image/svg+xml"], [Buffer.from("<html>hello</html>"), "image/png"], [png.subarray(0, 40), "image/png"], [png, "image/jpeg"]]) assert.equal((await upload(gm.cookie, bytes, type)).status, 415);
  assert.equal((await upload(gm.cookie, Buffer.alloc(20 * 1024 * 1024 + 1))).status, 413);
  assert.equal((await upload(gm.cookie, png, "image/png", { Origin: "https://elsewhere.test" })).status, 403);
  const image = (await upload(gm.cookie)).value.image;
  assert.match(image, /^\/api\/rooms\/[a-f0-9]{16}\/assets\/[a-f0-9]{64}\.png$/);
  assert.equal((await upload(gm.cookie)).value.image, image);
  const directory = path.join(data, "assets", gm.json.id); assert.equal(fs.readdirSync(directory).length, 1, "Duplicate uploads store one file");
  const get = (cookie, extra = {}, method = "GET") => fetch(base + image, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...extra } });
  assert.equal((await get(null)).status, 401); assert.equal((await get(other.cookie)).status, 401);
  const response = await get(player.cookie); assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "image/png"); assert.match(response.headers.get("cache-control"), /private/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  const etag = response.headers.get("etag"); assert.equal((await get(player.cookie, { "If-None-Match": etag })).status, 304);
  assert.equal((await get(null, { "If-None-Match": etag })).status, 401, "Authentication runs before conditional caching");
  assert.equal((await get(player.cookie, {}, "HEAD")).status, 200);
  let state = (await api(root + "/state", gm.cookie)).json;
  const table = structuredClone(state.table), piece = { id: "stored-artwork", kind: "shape", shape: "circle", name: "Token", x: 0, y: 0, width: 100, height: 100, rotation: 0, parentId: null, color: "#aabbcc", image, strokes: [] };
  table.scene.objects.push(piece);
  const embedded = structuredClone(table); embedded.scene.objects[0].image = "data:image/png;base64," + png.toString("base64");
  assert.equal((await api(root + "/operations", gm.cookie, operation(state, embedded))).status, 400, "Image bytes cannot bypass separate uploads");
  state = (await api(root + "/operations", gm.cookie, operation(state, table))).json;
  for (const invalid of [image.replace(gm.json.id, other.json.id), image.replace(/\/[a-f0-9]{64}\./, "/" + "f".repeat(64) + ".")]) {
    const forged = structuredClone(state.table); forged.scene.objects[0].image = invalid;
    assert.equal((await api(root + "/operations", gm.cookie, operation(state, forged))).status, 400);
  }
  assert.equal((await api(root + "/undo", gm.cookie, { id: randomUUID() })).status, 200);
  state = (await api(root + "/redo", gm.cookie, { id: randomUUID() })).json;
  assert.equal(state.table.scene.objects[0].image, image);
  await api(root + "/access", gm.cookie, { ids: [piece.id], policy: { owner: gm.json.me.id, shared: true, editors: [] }, revision: state.revision });
  assert.equal((await upload(player.cookie)).status, 200, "Shared-object editors can upload without general creation permission");
  assert.ok(fs.readFileSync(path.join(data, `${gm.json.id}.json`), "utf8").length < 5000, "Room state and undo use compact references");
  const old = await api("/api/rooms", null, { name: "Old artwork", color: "#ccaa55" }), oldRoot = `/api/rooms/${old.json.id}`, legacy = structuredClone(old.json.table);
  const oldUpload = await fetch(base + oldRoot + "/assets", { method: "POST", headers: { Cookie: old.cookie, "Content-Type": "image/png" }, body: png });
  const oldImage = (await oldUpload.json()).image;
  legacy.scene.objects.push({ ...piece, image: oldImage });
  const imported = (await api(oldRoot + "/operations", old.cookie, operation(old.json, legacy))).json;
  // Simulate an earlier server's embedded table and history on its private disk.
  const oldFile = path.join(data, `${old.json.id}.json`), oldRecord = JSON.parse(fs.readFileSync(oldFile, "utf8").replaceAll(oldImage, "data:image/png;base64," + png.toString("base64")));
  const broken = { ...piece, id: "unreadable-old-artwork", image: "data:image/png;base64,dGVzdA==" };
  oldRecord.table.scene.objects.push(broken); oldRecord.access[`object:${broken.id}`] = { owner: old.json.me.id, shared: false, editors: [] }; oldRecord.versions[`object:${broken.id}`] = oldRecord.revision;
  const original = JSON.stringify(oldRecord);
  fs.writeFileSync(oldFile, original);
  return { async afterRestart(newBase, request) {
    const restored = (await request(root + "/state", player.cookie)).json; assert.equal(restored.table.scene.objects[0].image, image);
    assert.deepEqual(Buffer.from(await (await fetch(newBase + image, { headers: { Cookie: player.cookie } })).arrayBuffer()), png);
    const migrated = (await request(oldRoot + "/state", old.cookie)).json;
    assert.equal(migrated.revision, imported.revision); assert.equal(migrated.table.scene.objects[0].image, oldImage);
    assert.equal(fs.readFileSync(path.join(data, "backups", `${old.json.id}.before-assets.json`), "utf8"), original);
    assert.equal((await request(oldRoot + "/undo", old.cookie, { id: randomUUID() })).status, 200);
    const redone = await request(oldRoot + "/redo", old.cookie, { id: randomUUID() }); assert.equal(redone.status, 200); assert.equal(redone.json.table.scene.objects.find(o => o.id === piece.id).image, migrated.table.scene.objects.find(o => o.id === piece.id).image);
    assert.equal(redone.json.table.scene.objects.find(o => o.id === broken.id).image, broken.image, "Unreadable older artwork remains a manageable object");
    const remove = structuredClone(redone.json.table); remove.scene.objects = remove.scene.objects.filter(o => o.id !== broken.id);
    assert.equal((await request(oldRoot + "/operations", old.cookie, operation(redone.json, remove))).status, 200);
    const restoreBroken = await request(oldRoot + "/undo", old.cookie, { id: randomUUID() }); assert.equal(restoreBroken.status, 200); assert.equal(restoreBroken.json.table.scene.objects.find(o => o.id === broken.id).image, broken.image);
    console.log("PASS: private room artwork uploads, deduplication, authenticated reads/cache, size/type/foreign-reference rejection, editor grants, compact undo, restart persistence and backed-up legacy migration");
  } };
};
