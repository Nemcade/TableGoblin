const assert = require("node:assert/strict"), { randomUUID } = require("node:crypto");
module.exports = async (api, operation) => {
  const gm = await api("/api/rooms", null, { name: "View GM", color: "#eeaa77" }), root = `/api/rooms/${gm.json.id}`;
  const player = await api(root + "/join", null, { name: "Player", color: "#6677ee", invite: gm.json.invite });
  await api(root + "/permissions", gm.cookie, { playerEditing: true });
  let table = structuredClone(player.json.table);
  table.scene.objects.push({ id: "token", kind: "shape", shape: "circle", name: "Token", x: 0, y: 0, width: 60, height: 60, rotation: 0, parentId: null, color: "#aabbcc", strokes: [] });
  let before = (await api(root + "/operations", player.cookie, operation(player.json, table))).json;
  const request = { id: randomUUID(), name: "  New player  ", color: "#AABBCC", version: 0, actor: gm.json.me.id, role: "gm" };
  assert.equal((await api(root + "/profile", null, request)).status, 401);
  const updated = await api(root + "/profile", player.cookie, request); assert.equal(updated.status, 200);
  assert.equal(updated.json.me.id, player.json.me.id); assert.equal(updated.json.me.role, "player");
  assert.equal(updated.json.me.name, "New player"); assert.equal(updated.json.me.color, "#aabbcc"); assert.equal(updated.json.me.profileVersion, 1);
  for (const field of ["table", "versions", "access", "history", "dice"]) assert.deepEqual(updated.json[field], before[field], `Identity changes preserve ${field}`);
  assert.equal(updated.json.revision, before.revision + 1);
  const retry = (await api(root + "/profile", player.cookie, request)).json;
  assert.equal(retry.revision, updated.json.revision); assert.equal(retry.me.profileVersion, 1);
  assert.equal((await api(root + "/profile", player.cookie, { ...request, name: "Altered retry" })).status, 409);
  const stale = await api(root + "/profile", player.cookie, { ...request, id: randomUUID(), name: "Stale window" });
  assert.equal(stale.status, 409); assert.equal(stale.json.state.me.name, "New player");
  for (const invalid of [{ name: " " }, { name: "x".repeat(33) }, { color: "red" }, { version: -1 }, { version: 1.5 }]) {
    assert.equal((await api(root + "/profile", player.cookie, { ...request, version: 1, id: randomUUID(), ...invalid })).status, 400);
  }
  const current = (await api(root + "/state", gm.cookie)).json;
  assert.equal(current.me.name, "View GM"); assert.equal(current.me.profileVersion, 0);
  assert.equal(current.participants.find(p => p.id === player.json.me.id).name, "New player");
  // An object command built before a profile update still uses the same entity versions.
  table = structuredClone(before.table); table.scene.objects[0].x = 100;
  assert.equal((await api(root + "/operations", player.cookie, operation(before, table))).status, 200);
  const view = { x: 4200, y: -1300, width: 2400, height: 1600 };
  assert.equal((await api(root + "/presence", player.cookie, { id: gm.json.me.id, selection: ["token", "missing"], laser: null, view })).status, 200);
  const present = (await api(root + "/state", gm.cookie)).json;
  assert.deepEqual(present.presence.map(p => ({ id: p.id, selection: p.selection, view: p.view })), [{ id: player.json.me.id, selection: ["token"], view }]);
  for (const bad of [{ ...view, width: 0 }, { ...view, y: 1e7 }, { ...view, height: "600" }, {}]) assert.equal((await api(root + "/presence", player.cookie, { selection: [], laser: null, view: bad })).status, 400);
  const rejoined = await api(root + "/join", player.cookie, { name: "Rejoined", color: "#112233", invite: gm.json.invite });
  assert.equal(rejoined.json.me.id, player.json.me.id); assert.equal(rejoined.json.me.profileVersion, 2); assert.equal(rejoined.json.me.role, "player");
  assert.equal((await api(root + "/profile", player.cookie, { ...request, id: randomUUID(), version: 1 })).status, 409);
  console.log("PASS: self-only identity updates, stable ownership and object versions, stale-tab protection, retries and validated world-space views");
  return { async afterRestart() {
    const restored = (await api(root + "/state", player.cookie)).json;
    assert.equal(restored.me.name, "Rejoined"); assert.equal(restored.me.color, "#112233"); assert.equal(restored.me.profileVersion, 2);
    assert.equal(restored.me.id, player.json.me.id); assert.deepEqual(restored.presence, []);
    assert.equal((await api(root + "/profile", player.cookie, request)).json.me.profileVersion, 2);
  } };
};
