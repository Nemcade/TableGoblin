import { defaultMood, type Mood } from "./mood.ts";
import type { GridSettings } from "./table-widgets.ts";
import { diceTypes, type DiceSetup } from "./dice-types.ts";
import { isHexColor } from "./colors.ts";

export type Preset<T> = { id: string; name: string; value: T };
type StorageLike = Pick<Storage, "getItem" | "setItem">;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const range = (v: unknown, low: number, high: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= low && v <= high;
const color = (v: unknown) => v === null || (typeof v === "string" && isHexColor(v));
export function parseMood(v: unknown): Mood | null {
  if (!object(v)) return null;
  const limits = { hue: [0, 360], saturation: [0, 100], lightness: [0, 100], gradient: [0, 1], texture: [0, 1], amount: [0, 4], speed: [0, 2], spread: [.25, 2], variation: [0, 2] };
  for (const [key, [low, high]] of Object.entries(limits)) if (!range(v[key], low, high)) return null;
  if (typeof v.motion !== "string" || !["still", "campfire", "canopy"].includes(v.motion) || typeof v.campfireColor !== "string" || !isHexColor(v.campfireColor) || typeof v.canopyColor !== "string" || !isHexColor(v.canopyColor)) return null;
  return Object.fromEntries(Object.keys(defaultMood).map((key) => [key, v[key]])) as Mood;
}
export type GridSetup = Omit<GridSettings, "enabled">;
export function parseGrid(v: unknown): GridSetup | null {
  if (!object(v) || !range(v.size, 12, 240) || !range(v.units, .001, 1000000) || !range(v.angle, -180, 180) || !range(v.opacity, 0, .6) || typeof v.unit !== "string" || v.unit.length > 24) return null;
  return { size: v.size, units: v.units, angle: v.angle, opacity: v.opacity, unit: v.unit };
}
export function gridSetup(grid: GridSettings): GridSetup {
  const { enabled: _, ...setup } = grid;
  return setup;
}
export function parseDiceSetup(v: unknown): DiceSetup | null {
  if (!object(v) || !color(v.color) || !color(v.fontColor) || !Array.isArray(v.groups) || !v.groups.length || v.groups.length > 6) return null;
  const ids = new Set<string>();
  let count = 0;
  for (const g of v.groups) {
    if (!object(g) || typeof g.id !== "string" || !g.id || g.id.length > 64 || ids.has(g.id) || typeof g.name !== "string" || g.name.length > 24 || !object(g.pool) || !color(g.color) || !color(g.fontColor)) return null;
    ids.add(g.id);
    for (const [sides, n] of Object.entries(g.pool)) {
      if (String(Number(sides)) !== sides || !diceTypes.includes(Number(sides) as typeof diceTypes[number]) || !range(n, 0, 20) || !Number.isInteger(n)) return null;
      count += n;
    }
  }
  if (count > 20 || v.groups[0].id !== "main" || v.groups[0].color !== null || v.groups[0].fontColor !== null) return null;
  return { color: v.color as string | null, fontColor: v.fontColor as string | null, groups: structuredClone(v.groups) } as DiceSetup;
}
export function readPresets<T>(storage: StorageLike, key: string, parse: (value: unknown) => T | null): Preset<T>[] {
  try {
    const saved = JSON.parse(storage.getItem(`table-goblin.presets.${key}.v1`) ?? "[]");
    if (!Array.isArray(saved)) return [];
    const ids = new Set<string>();
    return saved.slice(0, 30).flatMap((p) => {
      if (!object(p) || typeof p.id !== "string" || !p.id || ids.has(p.id) || typeof p.name !== "string" || !p.name.trim() || p.name.length > 40) return [];
      const value = parse(p.value);
      if (!value) return [];
      ids.add(p.id);
      return [{ id: p.id, name: p.name, value }];
    });
  } catch { return []; }
}
export function writePresets<T>(storage: StorageLike, key: string, presets: Preset<T>[]) {
  try { storage.setItem(`table-goblin.presets.${key}.v1`, JSON.stringify(presets)); return true; }
  catch { return false; }
}
