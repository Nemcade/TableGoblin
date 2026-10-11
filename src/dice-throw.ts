import type { Camera } from "./render";
import type { DieResult } from "./dice-types.ts";
import type { PhysicsRequest } from "./dice-physics.ts";
export type RollArea = { x: number; y: number; scale: number; width: number; height: number };
export function diceArea(camera: Camera, width: number, height: number): RollArea {
  const right = width > 700 ? width - 330 : width - 25, bottom = Math.max(260, height - 145);
  return { x: ((25 + right) / 2 - camera.x) / camera.zoom, y: ((100 + bottom) / 2 - camera.y) / camera.zoom,
    scale: 64 / camera.zoom, width: Math.max(180, Math.min(4096, right - 25)), height: Math.max(180, Math.min(4096, bottom - 100)) };
}
export function displayDice(dice: DieResult[]) {
  return dice.flatMap(die => die.sides === 100 ? [
    { die, sides: 10, desired: Math.floor(die.value % 100 / 10), labels: Array.from({ length: 10 }, (_, i) => String(i * 10).padStart(2, "0")) },
    { die, sides: 10, desired: die.value % 10, labels: Array.from({ length: 10 }, (_, i) => String(i)) },
  ] : [{ die, sides: die.sides, desired: die.value - 1, labels: Array.from({ length: die.sides }, (_, i) => String(i + 1)) }]);
}
/** One immutable seed and area describe a throw in world space for all viewers. */
export function diceThrow(dice: DieResult[], area: RollArea, seed: number): PhysicsRequest {
  let value = seed | 0 || 0x6d2b79f5;
  const random = () => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return (value >>> 0) / 0x100000000; };
  const between = (a: number, b: number) => a + (b - a) * random();
  const bounds = { left: -area.width / 128, right: area.width / 128, top: -area.height / 128, bottom: area.height / 128 };
  const heading = between(0, Math.PI * 2), direction = { x: Math.cos(heading), y: Math.sin(heading) };
  const items = displayDice(dice), columns = Math.ceil(Math.sqrt(items.length * area.width / area.height)), rows = Math.ceil(items.length / columns);
  const gapX = Math.min(1.15, (area.width / 64 - 1.4) / Math.max(1, columns - 1)), gapY = Math.min(1.15, (area.height / 64 - 1.4) / Math.max(1, rows - 1));
  const specs = items.map(({ sides }, i) => {
    const radius = between(.47, .53), speed = between(2.1, 4.8), spread = between(-.8, .8);
    const a = random(), b = between(0, Math.PI * 2), c = between(0, Math.PI * 2);
    return { sides, radius, position: {
      x: Math.max(bounds.left + .65, Math.min(bounds.right - .65, -direction.x * area.width / 64 * .12 + ((i % columns) - (columns - 1) / 2) * gapX + between(-.08, .08))),
      y: Math.max(bounds.top + .65, Math.min(bounds.bottom - .65, -direction.y * area.height / 64 * .12 + (Math.floor(i / columns) - (rows - 1) / 2) * gapY + between(-.08, .08))), z: between(2, 3.7) },
      velocity: { x: direction.x * speed - direction.y * spread, y: direction.y * speed + direction.x * spread, z: between(-.2, 2.8) },
      spin: { x: between(-17, 17), y: between(-17, 17), z: between(-12, 12) },
      q: { x: Math.sqrt(1 - a) * Math.sin(b), y: Math.sqrt(1 - a) * Math.cos(b), z: Math.sqrt(a) * Math.sin(c), w: Math.sqrt(a) * Math.cos(c) }, damping: between(.12, .26) };
  });
  return { specs, bounds, seed };
}
