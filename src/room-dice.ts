import { diceTypes, diceNotation, randomDie, type DiceSetup, type RollRecord, type DieSides } from "./dice-types.ts";
import { dicePalette } from "./dice-style.ts";
import { parseDiceSetup } from "./presets.ts";
import type { Mood } from "./mood.ts";
import type { RollArea } from "./dice-throw.ts";
export type RoomRoll = RollRecord & { sequence: number; actorId: string; actorName: string; actorColor: string; startedAt: number; seed: number; area: RollArea; duration: number };
export type RoomDice = { sequence: number; rolls: RoomRoll[] };
export type RollReceipt = { id: string; sequence: number };
export type RollRequest = { id: string; setup: DiceSetup; area: RollArea };
export const emptyRoomDice = (): RoomDice => ({ sequence: 0, rolls: [] });
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (n: unknown, min: number, max: number): n is number => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
const text = (s: unknown, max: number): s is string => typeof s === "string" && s.length > 0 && s.length <= max;
const id = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9-]{16,80}$/i.test(v);
const color = (v: unknown): v is string => typeof v === "string" && /^#[a-f0-9]{6}$/i.test(v);
export function validRollArea(v: unknown): v is RollArea {
  return object(v) && finite(v.x, -1e6, 1e6) && finite(v.y, -1e6, 1e6) && finite(v.scale, 8, 640) && finite(v.width, 180, 4096) && finite(v.height, 180, 4096);
}
export function parseRollRequest(value: unknown): RollRequest | null {
  if (!object(value) || Object.keys(value).some(k => !["id", "setup", "area"].includes(k)) || !id(value.id) || !validRollArea(value.area)) return null;
  const setup = parseDiceSetup(value.setup);
  if (!setup || !setup.groups.some(g => Object.values(g.pool).some(n => n && n > 0))) return null;
  return { id: value.id, setup, area: { x: value.area.x, y: value.area.y, scale: value.area.scale, width: value.area.width, height: value.area.height } };
}
export function makeRoll(request: RollRequest, mood: Mood, actor: { id: string; name: string; color: string }, rollId: string, draw: () => number): RollRecord & Pick<RoomRoll, "actorId" | "actorName" | "actorColor"> {
  const dice = request.setup.groups.flatMap(g => {
    const palette = dicePalette(mood, g.color ?? request.setup.color, g.fontColor ?? request.setup.fontColor);
    return diceTypes.flatMap(sides => Array.from({ length: g.pool[sides] ?? 0 }, () => ({ sides, value: randomDie(sides, draw), groupId: g.id, groupName: g.name.trim() || "Group", color: palette.color, fontColor: palette.fontColor })));
  });
  const pool: Partial<Record<DieSides, number>> = {}; for (const die of dice) pool[die.sides] = (pool[die.sides] ?? 0) + 1;
  return { id: rollId, notation: diceNotation(pool), dice, total: dice.reduce((n, d) => n + d.value, 0), actorId: actor.id, actorName: actor.name, actorColor: actor.color };
}
export function validRoomRoll(v: unknown): v is RoomRoll {
  if (!object(v) || !id(v.id) || !text(v.actorId, 80) || !text(v.actorName, 32) || !color(v.actorColor) || !Number.isSafeInteger(v.sequence) || v.sequence < 1 ||
    !Number.isSafeInteger(v.startedAt) || v.startedAt < 0 || !Number.isInteger(v.seed) || !finite(v.seed, 0, 0xffffffff) || !finite(v.duration, .01, 10) || !validRollArea(v.area) ||
    !Array.isArray(v.dice) || v.dice.length < 1 || v.dice.length > 20) return false;
  const pool: Partial<Record<DieSides, number>> = {};
  for (const d of v.dice) {
    if (!object(d) || !diceTypes.includes(d.sides) || !Number.isInteger(d.value) || !finite(d.value, 1, d.sides) || !text(d.groupId, 64) || !text(d.groupName, 24) || !color(d.color) || !color(d.fontColor)) return false;
    pool[d.sides as DieSides] = (pool[d.sides as DieSides] ?? 0) + 1;
  }
  return v.total === v.dice.reduce((n: number, d: { value: number }) => n + d.value, 0) && v.notation === diceNotation(pool);
}
export function parseRoomDice(v: unknown): RoomDice | null {
  if (!object(v) || !Number.isSafeInteger(v.sequence) || v.sequence < 0 || !Array.isArray(v.rolls) || v.rolls.length > 12 || !v.rolls.every(validRoomRoll) ||
    new Set(v.rolls.map(r => r.id)).size !== v.rolls.length || v.rolls.some((r: RoomRoll, i: number) => r.sequence > v.sequence || i > 0 && r.sequence >= v.rolls[i - 1].sequence)) return null;
  return v as RoomDice;
}
export function validRollReceipts(value: unknown, sequence: number): value is RollReceipt[] {
  return Array.isArray(value) && value.length <= 256 && value.every(r => object(r) && id(r.id) && Number.isSafeInteger(r.sequence) && r.sequence > 0 && r.sequence <= sequence);
}
