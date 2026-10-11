const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
module.exports = async function diceTests(api, operation) {
  const gm = await api("/api/rooms", null, { name: "Dice GM", color: "#aa8844" }), root = `/api/rooms/${gm.json.id}`;
  const player = await api(root + "/join", null, { invite: gm.json.invite, name: "Dice player", color: "#4488aa" });
  const payload = color => ({ id: randomUUID(), setup: { color, fontColor: "#ffffff", groups: [{ id: "main", name: "Main", pool: { 6: 2, 100: 1 }, color: null, fontColor: null }, { id: "damage", name: "Damage", pool: { 8: 1 }, color: "#cc5533", fontColor: "#111111" }] }, area: { x: 200, y: -100, scale: 64, width: 1000, height: 600 } });
  const first = payload("#7755aa"), revision = gm.json.revision;
  assert.equal((await api(root + "/rolls", null, first)).status, 401);
  for (const bad of [{ ...first, actor: gm.json.me.id }, { ...first, results: [20] }, { ...first, area: { ...first.area, scale: 1e6 } }, { ...first, setup: { ...first.setup, groups: [{ ...first.setup.groups[0], pool: { 6: 21 } }] } }]) assert.equal((await api(root + "/rolls", player.cookie, bad)).status, 400);
  const second = payload("#4477aa");
  const results = await Promise.all([api(root + "/rolls", gm.cookie, first), api(root + "/rolls", player.cookie, second), api(root + "/rolls", gm.cookie, first)]);
  assert.ok(results.every(r => r.status === 200), JSON.stringify(results));
  const state = (await api(root + "/state", gm.cookie)).json;
  assert.equal(state.dice.sequence, 2); assert.equal(state.revision, revision, "Rolls do not change table versions or undo history"); assert.deepEqual(state.history, { undo: false, redo: false });
  const shared = (await api(root + "/state", player.cookie)).json; assert.deepEqual(shared.dice, state.dice);
  assert.equal(state.diceAccepted.length, 1); assert.equal(shared.diceAccepted.length, 1);
  for (const roll of state.dice.rolls) {
    assert.equal(roll.dice.length, 4); assert.equal(roll.total, roll.dice.reduce((n, d) => n + d.value, 0));
    assert.ok(roll.dice.every(d => d.value >= 1 && d.value <= d.sides)); assert.ok(roll.duration > 0 && roll.duration <= 10);
    assert.equal(roll.actorName, roll.actorId === gm.json.me.id ? "Dice GM" : "Dice player");
    assert.equal(roll.dice.find(d => d.groupId === "damage").color, "#cc5533");
  }
  assert.equal((await api(root + "/rolls", gm.cookie, { ...first, area: { ...first.area, x: 300 } })).status, 409);
  assert.equal((await api(root + "/rolls", gm.cookie, first)).json.dice.sequence, 2, "Saved retries keep exactly one outcome");
  assert.equal((await api(root + "/rolls", player.cookie, payload("#4477aa"))).status, 409, "One participant cannot spam overlapping throws");
  const table = structuredClone(state.table); table.scene.objects.push({ id: "dice-test-piece", kind: "shape", shape: "circle", name: "Piece", x: 0, y: 0, width: 100, height: 100, rotation: 0, parentId: null, color: "#aabbcc", strokes: [] });
  assert.equal((await api(root + "/operations", gm.cookie, operation(state, table))).status, 200);
  assert.equal((await api(root + "/undo", gm.cookie, { id: randomUUID() })).status, 200);
  assert.deepEqual((await api(root + "/state", gm.cookie)).json.dice, state.dice, "Object undo leaves dice outcomes intact");
  return { root, gm: gm.cookie, player: player.cookie, first, dice: state.dice };
};
