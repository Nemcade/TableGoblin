import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultDiceGroup } from "../src/dice-types.ts";
import { defaultMood } from "../src/mood.ts";
import { diceThrow } from "../src/dice-throw.ts";
import { makeRoll, parseRollRequest, parseRoomDice, type RoomRoll } from "../src/room-dice.ts";
import { simulateDice } from "../src/dice-physics.ts";
import { TableDice } from "../src/dice-controller.ts";
const request = () => ({ id: "01234567-89ab-cdef-0123-456789abcdef", setup: { color: "#8844cc", fontColor: "#ffffff", groups: [{ ...defaultDiceGroup(), pool: { 6: 2, 100: 1 } }] }, area: { x: 300, y: -150, scale: 80, width: 1000, height: 600 } });
test("room rolls accept bounded selections and reject fabricated results and geometry", () => {
  assert.ok(parseRollRequest(request()));
  for (const patch of [{ seed: 7 }, { results: [20] }, { actor: "gm" }, { id: "" }, { area: { ...request().area, x: Infinity } }, { area: { ...request().area, width: 1 } }]) assert.equal(parseRollRequest({ ...request(), ...patch }), null);
  const many = request(); many.setup.groups[0].pool = { 6: 21, 100: 0 }; assert.equal(parseRollRequest(many), null);
  const empty = request(); empty.setup.groups[0].pool = { 6: 0, 100: 0 }; assert.equal(parseRollRequest(empty), null);
});
test("server-chosen outcomes preserve groups and colors and pass strict history validation", () => {
  const value = parseRollRequest(request())!, actor = { id: "player", name: "Player", color: "#112233" };
  const record = makeRoll(value, defaultMood, actor, value.id, () => 0);
  assert.equal(record.notation, "2d6 + 1d100"); assert.deepEqual(record.dice.map(d => d.value), [1, 1, 1]); assert.equal(record.total, 3);
  assert.ok(record.dice.every(d => d.color === "#8844cc" && d.fontColor === "#ffffff"));
  const roll = { ...record, area: value.area, sequence: 1, startedAt: 1000, duration: 3, seed: 123 };
  assert.ok(parseRoomDice({ sequence: 1, rolls: [roll] }));
  for (const patch of [{ total: 99 }, { notation: "d99" }, { actorColor: "red" }, { dice: [{ ...record.dice[0], value: 7 }] }]) assert.equal(parseRoomDice({ sequence: 1, rolls: [{ ...roll, ...patch }] }), null);
  assert.equal(parseRoomDice({ sequence: 1, rolls: [roll, roll] }), null);
});
test("one shared throw produces identical world positions and physical results for different views", () => {
  const value = parseRollRequest(request())!, record = makeRoll(value, defaultMood, { id: "player", name: "Player", color: "#112233" }, value.id, () => 99);
  const physics = simulateDice(diceThrow(record.dice, value.area, 7788)), again = simulateDice(diceThrow(record.dice, value.area, 7788));
  assert.deepEqual(physics.frames, again.frames); assert.deepEqual(physics.resultFaces, again.resultFaces);
  const roll: RoomRoll = { ...record, area: value.area, sequence: 1, startedAt: 1000, duration: (physics.frameCount - 1) / physics.fps, seed: 7788 };
  const controllers = [new TableDice(() => {}), new TableDice(() => {})];
  for (const [i, dice] of controllers.entries()) {
    dice.toggle(true); dice.setSound(false); dice.state.color = i ? "#00ff00" : "#ff0000"; dice.playShared(roll, 1000);
    dice.step(performance.now() + (roll.duration + .1) * 1000, { x: i * 250, y: i * 70, zoom: i ? 2 : .5 }, 1440, 900);
    assert.equal(dice.state.result?.total, record.total);
  }
  const bodies = (dice: TableDice) => (dice as any).bodies as { position: unknown; q: unknown; labels: string[]; resultFace: number; color: string; fixedAppearance: boolean }[];
  assert.deepEqual(bodies(controllers[0]), bodies(controllers[1]));
  assert.ok(bodies(controllers[0]).every(b => b.color === "#8844cc" && b.fixedAppearance));
  const shown = bodies(controllers[0]).map(b => Number(b.labels[b.resultFace]));
  assert.deepEqual(shown.slice(0, 2), record.dice.slice(0, 2).map(d => d.value));
  assert.equal((shown[2] + shown[3]) || 100, record.dice[2].value);
  for (const dice of controllers) dice.dispose();
});
