import {
  World,
  Body,
  Plane,
  Box,
  Vec3,
  Quaternion,
  ConvexPolyhedron,
  GSSolver,
  SAPBroadphase,
  type ContactEquation,
} from "cannon-es";
import { dieMesh, turn, type Q, type V3 } from "./dice-geometry.ts";
export type PhysicsSpec = {
  sides: number;
  radius: number;
  position: V3;
  velocity: V3;
  spin: V3;
  q: Q;
  damping: number;
};
export type PhysicsRequest = {
  specs: PhysicsSpec[];
  bounds: { left: number; right: number; top: number; bottom: number };
  seed: number;
};
export type PhysicsRoll = {
  frames: Float32Array;
  count: number;
  frameCount: number;
  fps: number;
  resultFaces: number[];
  sleepTimes: number[];
  impacts: DiceImpact[];
};
export type DiceImpact = {
  time: number;
  strength: number;
  die: number;
  x: number;
  kind: "table" | "dice" | "edge";
};
const RATE = 120;
function simulateAttempt(request: PhysicsRequest): PhysicsRoll {
  let seed = request.seed | 0;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0x100000000;
  };
  const world = new World({ gravity: new Vec3(0, 0, -18), allowSleep: true });
  world.broadphase = new SAPBroadphase(world);
  (world.solver as GSSolver).iterations = 20;
  (world.solver as GSSolver).tolerance = 1e-7;
  world.defaultContactMaterial.friction = 0.42;
  world.defaultContactMaterial.restitution = 0.33;
  world.defaultContactMaterial.contactEquationStiffness = 1e7;
  world.defaultContactMaterial.contactEquationRelaxation = 3;
  const floor = new Body({ mass: 0, shape: new Plane() });
  world.addBody(floor);
  const { left, right, top, bottom } = request.bounds;
  for (const [position, size] of [
    [
      new Vec3(left - 0.25, (top + bottom) / 2, 2),
      new Vec3(0.25, (bottom - top) / 2 + 1, 3),
    ],
    [
      new Vec3(right + 0.25, (top + bottom) / 2, 2),
      new Vec3(0.25, (bottom - top) / 2 + 1, 3),
    ],
    [
      new Vec3((left + right) / 2, top - 0.25, 2),
      new Vec3((right - left) / 2 + 1, 0.25, 3),
    ],
    [
      new Vec3((left + right) / 2, bottom + 0.25, 2),
      new Vec3((right - left) / 2 + 1, 0.25, 3),
    ],
  ])
    world.addBody(new Body({ mass: 0, position, shape: new Box(size) }));
  const dice = request.specs.map((spec) => {
    const mesh = dieMesh(spec.sides),
      shape = new ConvexPolyhedron({
        vertices: mesh.vertices.map(
          (v) =>
            new Vec3(v.x * spec.radius, v.y * spec.radius, v.z * spec.radius),
        ),
        faces: mesh.faces.map((f) => [...f.indices]),
      });
    const body = new Body({
      mass: 1,
      shape,
      position: new Vec3(spec.position.x, spec.position.y, spec.position.z),
      velocity: new Vec3(spec.velocity.x, spec.velocity.y, spec.velocity.z),
      angularVelocity: new Vec3(spec.spin.x, spec.spin.y, spec.spin.z),
      quaternion: new Quaternion(spec.q.x, spec.q.y, spec.q.z, spec.q.w),
      linearDamping: 0.08,
      angularDamping: spec.damping,
      sleepSpeedLimit: 0.09,
      sleepTimeLimit: 0.28,
    });
    world.addBody(body);
    return body;
  });
  const frames: number[] = [],
    sleepTimes = dice.map(() => 0);
  const impacts: DiceImpact[] = [],
    lastImpact = dice.map(() => -1);
  const indices = new Map(dice.map((body, i) => [body.id, i]));
  const contacts = new Map<number, Omit<DiceImpact, "time">>();
  const queueContact = (contact: ContactEquation) => {
    const a = indices.get(contact.bi.id),
      b = indices.get(contact.bj.id);
    if (a === undefined && b === undefined) return;
    const die = a === undefined ? b! : b === undefined ? a : Math.min(a, b);
    const other = contact.bi === dice[die] ? contact.bj : contact.bi;
    const strength = Math.abs(contact.getImpactVelocityAlongNormal());
    if (strength < 0.22 || strength <= (contacts.get(die)?.strength ?? 0))
      return;
    contacts.set(die, {
      die,
      strength,
      x: dice[die].position.x,
      kind: other === floor ? "table" : other.mass ? "dice" : "edge",
    });
  };
  dice.forEach((body) =>
    body.addEventListener("collide", (event: { contact: ContactEquation }) =>
      queueContact(event.contact),
    ),
  );
  const snapshot = () =>
    dice.forEach((b) =>
      frames.push(
        b.position.x,
        b.position.y,
        b.position.z,
        b.quaternion.x,
        b.quaternion.y,
        b.quaternion.z,
        b.quaternion.w,
      ),
    );
  snapshot();
  const restingFlat = (b: Body, i: number) => {
    const mesh = dieMesh(request.specs[i].sides);
    return (
      mesh.faces.some((f) => turn(f.normal, b.quaternion).z < -0.995) &&
      Math.min(
        ...mesh.vertices.map(
          (v) =>
            turn(v, b.quaternion).z * request.specs[i].radius + b.position.z,
        ),
      ) < 0.03
    );
  };
  for (let step = 1; step <= RATE * 9; step++) {
    contacts.clear();
    world.step(1 / RATE);
    // New impacts and face-to-face rolling contacts share the same playback timeline.
    world.contacts.forEach(queueContact);
    contacts.forEach((impact, i) => {
      const time = step / RATE;
      if (time - lastImpact[i] >= 0.055) {
        impacts.push({ ...impact, time });
        lastImpact[i] = time;
      }
    });
    dice.forEach((b, i) => {
      if (b.sleepState === Body.SLEEPING) {
        if (!sleepTimes[i]) sleepTimes[i] = step / RATE;
      } else sleepTimes[i] = 0;
      // A very rare cocked or stacked die gets a small physical nudge, not a forced pose.
      if (
        step > RATE * 2 &&
        b.sleepState === Body.SLEEPING &&
        step % (RATE / 2) === 0
      ) {
        if (!restingFlat(b, i)) {
          b.wakeUp();
          b.applyImpulse(
            new Vec3((random() - 0.5) * 1.2, (random() - 0.5) * 1.2, 0.9),
          );
          b.angularVelocity.x += (random() - 0.5) * 1.4;
          b.angularVelocity.y += (random() - 0.5) * 1.4;
          sleepTimes[i] = 0;
        }
      }
    });
    if (step % 2 === 0) snapshot();
    if (
      step > RATE * 0.7 &&
      dice.every(
        (b, i) =>
          b.sleepState === Body.SLEEPING &&
          sleepTimes[i] > 0 &&
          restingFlat(b, i),
      )
    )
      break;
  }
  // Keep the exact physical final pose, including its contact points.
  snapshot();
  const resultFaces = dice.map((b, i) => {
    const mesh = dieMesh(request.specs[i].sides),
      sign = request.specs[i].sides === 4 ? -1 : 1;
    return mesh.faces.reduce(
      (best, f, index) =>
        turn(f.normal, b.quaternion).z * sign >
        turn(mesh.faces[best].normal, b.quaternion).z * sign
          ? index
          : best,
      0,
    );
  });
  return {
    frames: new Float32Array(frames),
    count: dice.length,
    frameCount: frames.length / (dice.length * 7),
    fps: RATE / 2,
    resultFaces,
    sleepTimes,
    impacts,
  };
}

/** Retry cocked/stacked throws before playback, using gentler throws if needed. */
export function simulateDice(request: PhysicsRequest): PhysicsRoll {
  let seed = request.seed | 0;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0x100000000;
  };
  let candidate = request;
  for (let attempt = 0; ; attempt++) {
    const roll = simulateAttempt(candidate);
    const resting = candidate.specs.every((spec, i) => {
      const offset = ((roll.frameCount - 1) * roll.count + i) * 7;
      const q = {
        x: roll.frames[offset + 3],
        y: roll.frames[offset + 4],
        z: roll.frames[offset + 5],
        w: roll.frames[offset + 6],
      };
      const mesh = dieMesh(spec.sides);
      return (
        roll.sleepTimes[i] > 0 &&
        mesh.faces.some((f) => turn(f.normal, q).z < -0.995) &&
        Math.min(
          ...mesh.vertices.map(
            (v) => turn(v, q).z * spec.radius + roll.frames[offset + 2],
          ),
        ) < 0.03
      );
    });
    if (resting || attempt >= 19) return roll;
    const energy = Math.pow(0.7, Math.max(0, attempt - 2));
    candidate = {
      ...request,
      seed: (random() * 0xffffffff) >>> 0,
      specs: request.specs.map((spec) => {
        const a = random(),
          b = random() * Math.PI * 2,
          c = random() * Math.PI * 2;
        return {
          ...spec,
          q: {
            x: Math.sqrt(1 - a) * Math.sin(b),
            y: Math.sqrt(1 - a) * Math.cos(b),
            z: Math.sqrt(a) * Math.sin(c),
            w: Math.sqrt(a) * Math.cos(c),
          },
          velocity: {
            x: (spec.velocity.x + (random() - 0.5) * 2) * energy,
            y: (spec.velocity.y + (random() - 0.5) * 2) * energy,
            z: spec.velocity.z,
          },
          spin: {
            x: (random() - 0.5) * 34 * energy,
            y: (random() - 0.5) * 34 * energy,
            z: (random() - 0.5) * 24 * energy,
          },
        };
      }),
    };
  }
}
