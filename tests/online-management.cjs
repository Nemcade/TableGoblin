const assert = require("node:assert/strict"), http = require("node:http"), { randomUUID } = require("node:crypto");
const { expectations } = require("../.server-runtime/room-operations.cjs");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPioAAAAASUVORK5CYII=", "base64");

// The server has entered its authenticated handler before emitting 100 Continue.
// Hold the final bytes to test revocation while a body is still being received.
function heldRequest(base, endpoint, cookie, bytes, type) {
  let finish;
  const response = new Promise((resolve, reject) => {
    const req = http.request(base + endpoint, { method: "POST", headers: { Cookie: cookie, "Content-Type": type, "Content-Length": bytes.length, Expect: "100-continue" } }, res => {
      const chunks = []; res.on("data", c => chunks.push(c)); res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks)) }));
    });
    req.on("error", reject); req.on("continue", () => { req.write(bytes.subarray(0, 10)); finish = () => req.end(bytes.subarray(10)); }); req.flushHeaders();
  });
  return { response, async ready() { while (!finish) await new Promise(r => setTimeout(r, 5)); }, finish() { finish(); } };
}

module.exports = async (base, api, operation) => {
  const gm = await api("/api/rooms", null, { name: "Room GM", color: "#eeaa77" }), root = `/api/rooms/${gm.json.id}`;
  const join = (invite, cookie) => api(root + "/join", cookie, { name: "Same name", color: "#6688cc", invite });
  const player = await join(gm.json.invite), peer = await join(gm.json.invite);
  const manage = (kind, state, member) => ({ id: randomUUID(), kind, invite: state.invite, ...(member ? { member } : {}) });
  const rotation = manage("invitation", gm.json);
  assert.equal((await api(root + "/manage", player.cookie, rotation)).status, 403, "Players cannot forge GM controls");
  const rotated = await api(root + "/manage", gm.cookie, rotation); assert.equal(rotated.status, 200);
  assert.notEqual(rotated.json.invite, gm.json.invite);
  const rotationRetry = (await api(root + "/manage", gm.cookie, rotation)).json;
  assert.equal(rotationRetry.invite, rotated.json.invite); assert.equal(rotationRetry.revision, rotated.json.revision, "Recent invitation retries keep the same link and revision");
  assert.equal((await api(root + "/manage", gm.cookie, { ...rotation, kind: "remove", member: player.json.me.id })).status, 409);
  assert.equal((await api(root + "/manage", gm.cookie, manage("invitation", gm.json))).status, 409, "A stale GM confirmation cannot replace a newer invitation");
  assert.equal((await join(gm.json.invite)).status, 403);
  assert.equal((await api(root + "/state", player.cookie)).json.me.id, player.json.me.id, "Rotation keeps joined identities");
  assert.equal((await api(root + "/manage", gm.cookie, manage("remove", rotated.json, gm.json.me.id))).status, 400);
  assert.equal((await api(root + "/manage", gm.cookie, manage("remove", rotated.json, "missing"))).status, 400);
  await api(root + "/permissions", gm.cookie, { playerEditing: true });
  let state = (await api(root + "/state", gm.cookie)).json;
  const piece = (id, parentId = null) => ({ id, parentId, kind: "shape", shape: "circle", name: id, x: 0, y: 0, width: 100, height: 100, rotation: 0, color: "#aabbcc", strokes: [] });
  let table = structuredClone(state.table); table.scene.objects.push(piece("parent"), piece("child", "parent"), piece("deleted"));
  table.scene.strokes.push({ id: "ink", points: [{ x: 10, y: 20 }, { x: 20, y: 30 }], width: 2, color: "#aabbcc", highlight: false });
  let result = await api(root + "/operations", player.cookie, operation(state, table)); assert.equal(result.status, 200); state = result.json;
  table = structuredClone(state.table); table.scene.objects = table.scene.objects.filter(o => o.id !== "deleted");
  state = (await api(root + "/operations", player.cookie, operation(state, table))).json;
  table = structuredClone(state.table); table.scene.objects.push(piece("editor-grant"));
  state = (await api(root + "/operations", gm.cookie, operation(state, table))).json;
  state = (await api(root + "/access", gm.cookie, { ids: ["editor-grant"], policy: { owner: gm.json.me.id, shared: false, editors: [player.json.me.id, peer.json.me.id] }, revision: state.revision })).json;
  state = (await api(root + "/state", gm.cookie)).json;
  const upload = await fetch(base + root + "/assets", { method: "POST", headers: { Cookie: player.cookie, "Content-Type": "image/png" }, body: png });
  assert.equal(upload.status, 200); const image = (await upload.json()).image;
  const browserIds = [randomUUID(), randomUUID()], readers = [];
  for (const client of browserIds) {
    const response = await fetch(base + root + `/events?client=${client}`, { headers: { Cookie: player.cookie }, signal: AbortSignal.timeout(15000) });
    const reader = response.body.getReader(); await reader.read(); readers.push(reader);
  }
  const changes = [{ key: "object:parent", value: state.table.scene.objects[0] }];
  assert.equal((await api(root + "/leases", player.cookie, { action: "claim", client: browserIds[0], ids: ["parent"], expected: expectations(state.table, changes, state.versions) })).status, 200);
  await api(root + "/presence", player.cookie, { selection: ["parent"], laser: { x: 3, y: 4 } });
  const delayed = heldRequest(base, root + "/presence", player.cookie, Buffer.from(JSON.stringify({ selection: ["parent"], laser: { x: 5, y: 6 } })), "application/json");
  const delayedUpload = heldRequest(base, root + "/assets", player.cookie, png, "image/png");
  await Promise.all([delayed.ready(), delayedUpload.ready()]);
  const before = (await api(root + "/state", gm.cookie)).json, removal = manage("remove", before, player.json.me.id);
  const removed = await api(root + "/manage", gm.cookie, removal); assert.equal(removed.status, 200); state = removed.json;
  delayed.finish(); delayedUpload.finish();
  for (const response of await Promise.all([delayed.response, delayedUpload.response])) { assert.equal(response.status, 403); assert.equal(response.json.code, "ROOM_REMOVED"); }
  assert.deepEqual(state.table, before.table, "Removal preserves the entire table");
  assert.equal(state.participants.some(p => p.id === player.json.me.id), false);
  assert.equal(state.participants.some(p => p.id === peer.json.me.id), true, "A matching display name is not removed");
  assert.deepEqual(state.presence, []); assert.deepEqual(state.leases, []);
  for (const key of ["object:parent", "object:child", "object:deleted", "stroke:ink"]) { assert.equal(state.access[key].owner, gm.json.me.id); assert.equal(state.versions[key], state.revision); }
  assert.deepEqual(state.access["object:editor-grant"].editors, [peer.json.me.id]);
  assert.notEqual(state.invite, before.invite);
  assert.ok(!JSON.stringify(state).includes("tokenHash") && !JSON.stringify(state).includes("removed\": ["));
  for (const reader of readers) {
    let frames = ""; for (;;) { const { value, done } = await reader.read(); if (done) break; frames += Buffer.from(value).toString(); }
    assert.match(frames, /event: removed/, "All browser connections are notified and ended");
  }
  for (const endpoint of ["state", "events"]) { const response = await api(root + "/" + endpoint, player.cookie); assert.equal(response.status, 403); assert.equal(response.json.code, "ROOM_REMOVED"); }
  for (const endpoint of ["operations", "table", "undo", "redo", "presence", "leases", "rolls", "permissions", "access", "manage"]) assert.equal((await api(root + "/" + endpoint, player.cookie, { id: randomUUID() })).status, 403, `Removed session cannot call ${endpoint}`);
  assert.equal((await fetch(base + image, { headers: { Cookie: player.cookie } })).status, 403);
  assert.equal((await join(before.invite, player.cookie)).status, 403, "Old invitations cannot restore the removed identity");
  const retried = (await api(root + "/manage", gm.cookie, removal)).json; assert.equal(retried.invite, state.invite); assert.equal(retried.revision, state.revision);
  const changed = structuredClone(before.table); changed.scene.objects[0].color = "#112233";
  assert.equal((await api(root + "/operations", peer.cookie, operation(before, changed))).status, 409, "Stale edits cannot overwrite changed ownership");
  const returning = await join(state.invite, player.cookie); assert.equal(returning.status, 200); assert.notEqual(returning.json.me.id, player.json.me.id);
  assert.equal(returning.json.access["object:parent"].owner, gm.json.me.id, "Deliberate re-invitation gets a new identity without old grants");
  assert.ok(!("invite" in returning.json));
  console.log("PASS: GM-only room controls, invitation replacement, stable joined identities, duplicate names, preserved hierarchy/drawings, ownership transfer, editor cleanup, revoked streams/requests/artwork, body/upload races and idempotent controls");
  return { async afterRestart(request) {
    assert.equal((await request(root + "/state", player.cookie)).json.code, "ROOM_REMOVED");
    const restored = (await request(root + "/state", gm.cookie)).json; assert.equal(restored.invite, state.invite); assert.deepEqual(restored.table, state.table); assert.deepEqual(restored.access, state.access);
    assert.equal((await request(root + "/manage", gm.cookie, removal)).json.invite, state.invite);
    assert.equal((await request(root + "/state", returning.cookie)).json.me.id, returning.json.me.id);
    console.log("PASS: room-control receipts, replaced invitations, removed sessions and transferred ownership survive restart");
  } };
};
