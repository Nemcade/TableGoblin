import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateDice, type PhysicsRequest } from "../src/dice-physics.ts";
import {
  diceTypes,
  dieMesh,
  randomDie,
  diceNotation,
  TableDice,
  turn,
} from "../src/dice.ts";
import {
  defaultGrid,
  measure,
  measurementLabel,
  simplifyLasso,
  polygonArea,
} from "../src/table-widgets.ts";
test("each 3D die has the expected convex faces and outward unit normals", () => {
  for (const s of diceTypes) {
    const mesh = dieMesh(s);
    assert.equal(mesh.faces.length, s === 100 ? 10 : s, `d${s} faces`);
    for (const f of mesh.faces) {
      assert.ok(
        Math.abs(Math.hypot(f.normal.x, f.normal.y, f.normal.z) - 1) < 1e-8,
      );
      assert.ok(
        f.center.x * f.normal.x +
          f.center.y * f.normal.y +
          f.center.z * f.normal.z >
          0,
      );
      assert.equal(
        f.indices.length,
        s === 6 || s === 10 || s === 100 ? 4 : s === 12 ? 5 : 3,
      );
    }
  }
});
test("dice random selection rejects biased overflow and supports percentile 100", () => {
  const draws = [0xffffffff, 11];
  assert.equal(
    randomDie(6, () => draws.shift()!),
    6,
  );
  assert.equal(draws.length, 0);
  assert.equal(
    randomDie(100, () => 99),
    100,
  );
  assert.equal(
    randomDie(4, () => 0),
    1,
  );
  assert.equal(diceNotation({ 6: 2, 20: 1 }), "2d6 + 1d20");
});
test("settled physical faces agree with roll records, including two-die percentiles", () => {
  const dice = new TableDice(() => {}),
    camera = { x: 0, y: 0, zoom: 1 };
  dice.toggle(true);
  for (const s of diceTypes) dice.choose(s);
  dice.choose(6);
  dice.roll(camera, 1440, 900);
  assert.equal(dice.state.rolling, true);
  const start = performance.now();
  for (let t = 0; t <= 10000 && dice.state.rolling; t += 16)
    dice.step(start + t, camera, 1440, 900);
  assert.equal(dice.state.rolling, false);
  assert.equal(dice.state.history.length, 1);
  assert.equal(dice.state.result!.dice.length, 8);
  assert.equal(
    dice.state.result!.total,
    dice.state.result!.dice.reduce((n, d) => n + d.value, 0),
  );
  const bodies = (
    dice as unknown as {
      bodies: {
        sides: number;
        labels: string[];
        resultFace: number;
        q: { x: number; y: number; z: number; w: number };
        mesh: ReturnType<typeof dieMesh>;
        position: { x: number; y: number; z: number };
        size: number;
      }[];
    }
  ).bodies;
  assert.equal(bodies.length, 9);
  for (const b of bodies) {
    const floor = Math.min(
      ...b.mesh.vertices.map((v) => turn(v, b.q).z * b.size + b.position.z),
    );
    assert.ok(
      floor > -0.5 && floor < 1.92,
      `d${b.sides} touches the table, rather than resting on another die`,
    );
    const normal = turn(b.mesh.faces[b.resultFace].normal, b.q);
    assert.ok(Math.abs(normal.z - (b.sides === 4 ? -1 : 1)) < 0.005);
  }
  let index = 0;
  for (const d of dice.state.result!.dice) {
    const b = bodies[index++],
      normal = turn(b.mesh.faces[b.resultFace].normal, b.q);
    assert.ok(
      Math.abs(normal.z - (d.sides === 4 ? -1 : 1)) < 0.005,
      `d${d.sides} rests flat`,
    );
    if (d.sides === 100) {
      const units = bodies[index++],
        combined =
          Number(b.labels[b.resultFace]) +
          Number(units.labels[units.resultFace]);
      assert.equal(combined || 100, d.value);
    } else assert.equal(Number(b.labels[b.resultFace]), d.value);
  }
  dice.toggle(false);
  assert.equal((dice as unknown as { bodies: unknown[] }).bodies.length, 0);
  assert.equal(dice.state.history.length, 1);
});
test("rigid-body trajectories settle at varied times with reproducible floor contacts", () => {
  const request: PhysicsRequest = {
    seed: 82437,
    bounds: { left: 0, right: 12, top: 0, bottom: 8 },
    specs: diceTypes.map((sides, i) => ({
      sides,
      radius: 0.5,
      position: {
        x: 3 + (i % 4) * 1.2,
        y: 3 + Math.floor(i / 4) * 1.2,
        z: 2 + i * 0.15,
      },
      velocity: { x: 1.5 + i * 0.2, y: 0.8 - i * 0.2, z: 0.4 },
      spin: { x: 11 - i, y: 5 + i, z: i - 3 },
      q: { x: 0.5, y: 0.5, z: 0.5, w: 0.5 },
      damping: 0.2,
    })),
  };
  const a = simulateDice(request),
    b = simulateDice(request);
  assert.deepEqual(a.frames, b.frames);
  assert.deepEqual(a.impacts, b.impacts);
  assert.ok(
    a.impacts.length > a.count,
    "Bounces and rolling contacts produce multiple impacts",
  );
  assert.ok(new Set(a.impacts.map((i) => i.strength.toFixed(1))).size > 3);
  for (let i = 0; i < a.impacts.length; i++) {
    const impact = a.impacts[i];
    assert.ok(
      impact.time >= (a.impacts[i - 1]?.time ?? 0) &&
        impact.time < a.frameCount / a.fps,
    );
    assert.ok(impact.strength >= 0.22 && Number.isFinite(impact.x));
    assert.ok(impact.die >= 0 && impact.die < a.count);
  }
  assert.ok(
    new Set(a.sleepTimes.map((t) => t.toFixed(1))).size > 1,
    "Dice do not share a uniform settling timeline",
  );
  for (let i = 0; i < a.count; i++) {
    const spec = request.specs[i],
      mesh = dieMesh(spec.sides),
      offset = ((a.frameCount - 1) * a.count + i) * 7;
    const q = {
      x: a.frames[offset + 3],
      y: a.frames[offset + 4],
      z: a.frames[offset + 5],
      w: a.frames[offset + 6],
    };
    assert.ok(a.sleepTimes[i] > 0);
    assert.ok(mesh.faces.some((f) => turn(f.normal, q).z < -0.995));
    const floor = Math.min(
      ...mesh.vertices.map(
        (v) => turn(v, q).z * spec.radius + a.frames[offset + 2],
      ),
    );
    assert.ok(floor > -0.005 && floor < 0.03);
  }
});
test("settled dice fade away while preserving results, selection and history", () => {
  const dice = new TableDice(() => {}),
    camera = { x: 0, y: 0, zoom: 1 };
  dice.toggle(true);
  dice.choose(6);
  dice.setSound(false);
  dice.roll(camera, 1440, 900);
  const internal = dice as unknown as {
    start: number;
    frames: { frameCount: number; fps: number } | null;
    opacity: number;
    bodies: unknown[];
  };
  const end =
    internal.start +
    ((internal.frames!.frameCount - 1) / internal.frames!.fps) * 1000;
  dice.step(end, camera, 1440, 900);
  assert.equal(dice.state.rolling, false);
  const result = dice.state.result,
    history = dice.state.history,
    pool = dice.state.pool;
  assert.equal(dice.state.visible, true);
  assert.equal(dice.step(end + 3999, camera, 1440, 900), false);
  assert.equal(internal.opacity, 1);
  assert.equal(dice.step(end + 4450, camera, 1440, 900), true);
  assert.ok(Math.abs(internal.opacity - 0.5) < 1e-6);
  assert.equal(dice.step(end + 4901, camera, 1440, 900), true);
  assert.equal(dice.state.visible, false);
  assert.equal(internal.bodies.length, 0);
  assert.equal(internal.frames, null);
  assert.equal(dice.state.result, result);
  assert.equal(dice.state.history, history);
  assert.equal(dice.state.pool, pool);
  assert.equal(dice.state.sound, false);
  assert.equal(dice.step(end + 5000, camera, 1440, 900), false);
  dice.toggle(false);
  dice.toggle(true);
  assert.equal(dice.state.sound, false);
  dice.dispose();
});
test("dice sounds follow playback contacts and skip stale impacts after a pause", () => {
  const dice = new TableDice(() => {}),
    camera = { x: 0, y: 0, zoom: 1 };
  const internal = dice as unknown as {
    start: number;
    frames: { impacts: { time: number }[] };
    sound: { play: (impact: unknown, pan: number) => void };
  };
  const played: unknown[] = [];
  internal.sound.play = (impact) => played.push(impact);
  dice.toggle(true);
  dice.choose(6);
  dice.roll(camera, 1440, 900);
  dice.step(internal.start, camera, 1440, 900);
  assert.equal(played.length, 0);
  dice.step(
    internal.start + internal.frames.impacts[0].time * 1000 + 0.01,
    camera,
    1440,
    900,
  );
  assert.equal(played.length, 1);
  dice.step(internal.start + 10000, camera, 1440, 900);
  assert.equal(
    played.length,
    1,
    "Old collisions do not burst out when a paused tab resumes",
  );
  assert.equal(dice.state.rolling, false);
  dice.dispose();
});
test("ruler uses arbitrary square scale without rotation or grid visibility affecting distance", () => {
  const line = { start: { x: 0, y: 0 }, end: { x: 240, y: 320 } },
    grid = { ...defaultGrid, size: 80, units: 1 };
  assert.equal(measure(line, grid), 5);
  assert.equal(measurementLabel(line, grid), "5 m");
  assert.equal(measure(line, { ...grid, angle: 67, opacity: 0 }), 5);
  assert.equal(
    measurementLabel(line, { ...grid, units: 3, unit: "paces" }),
    "15 paces",
  );
  assert.equal(measure(line, { ...grid, size: 40 }), 10);
});
test("lasso simplification retains deliberate corners and rejects negligible areas", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 20, y: 0.1 },
    { x: 50, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
    { x: 0, y: 0 },
  ];
  const simplified = simplifyLasso(points, 1);
  assert.equal(simplified.length, 5);
  assert.equal(polygonArea(simplified), 10000);
  assert.equal(
    polygonArea([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]),
    0,
  );
});
