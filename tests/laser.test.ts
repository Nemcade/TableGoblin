import { test } from "node:test";
import assert from "node:assert/strict";
import { RemoteLaser } from "../src/laser.ts";

test("remote points ease between sparse updates and remain in world coordinates", () => {
  const laser = new RemoteLaser(); laser.update({ x: 0, y: 0 }, 0, 1);
  for (let time = 0; time <= 112; time += 16) laser.step(time);
  laser.update({ x: 100, y: -60 }, 120, 2); laser.step(144);
  const early = laser.points.at(-1)!;
  assert(early.x > 0 && early.x < 100); assert(early.y < 0 && early.y > -60);
  for (let time = 160; time <= 304; time += 16) laser.step(time);
  assert(laser.points.at(-1)!.x > 99); assert(laser.points.length > 3);
});
test("release fades the trail, and another gesture starts a disconnected path", () => {
  const laser = new RemoteLaser(); laser.update({ x: 20, y: 30 }, 0, 1); laser.step(32);
  laser.update(null, 40, 2); laser.step(80); assert(laser.points.length > 0);
  laser.update({ x: 500, y: 600 }, 90, 3); assert.equal(laser.points.at(-1)!.start, true);
  laser.step(120); laser.update(null, 130, 4); laser.step(800);
  assert.equal(laser.points.length, 0); assert.equal(laser.step(801), false);
});
test("stationary keepalives retain the glow, but old snapshots cannot revive an expired laser", () => {
  const laser = new RemoteLaser(); laser.update({ x: 5, y: 8 }, 0, 1);
  for (let time = 0; time <= 1600; time += 20) {
    if (time % 600 === 0) laser.update({ x: 5, y: 8 }, time, time + 1);
    laser.step(time);
  }
  assert(laser.points.length > 0);
  laser.step(2600); laser.step(3300); assert.equal(laser.points.length, 0);
  laser.update({ x: 5, y: 8 }, 3400, 1201); assert.equal(laser.step(3400), false);
  laser.update({ x: 5, y: 8 }, 3500, 3501); assert(laser.step(3500));
});
test("long gestures keep only a bounded fading tail", () => {
  const laser = new RemoteLaser();
  for (let time = 0; time < 60000; time += 10) {
    if (time % 120 === 0) laser.update({ x: time, y: 10 }, time, time);
    laser.step(time); assert(laser.points.length <= 48);
  }
  assert(laser.points.every(p => 59990 - p.time < 650));
  for (let i = 0; i < 500; i++) {
    laser.update(null, 60000 + i, i * 2);
    laser.update({ x: i, y: i }, 60000 + i, i * 2 + 1);
    assert(laser.points.length <= 48, 'The tail is also bounded while animation frames are suspended');
  }
});
