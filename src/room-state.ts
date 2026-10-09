import { parseSnapshot, type TableSnapshot } from "./table-storage.ts";
import { defaultMood } from "./mood.ts";
import { defaultGrid, defaultObscure } from "./table-widgets.ts";
import { defaultDiceGroup } from "./dice-types.ts";
import type { Point, Scene } from "./model.ts";

export type SharedTable = Pick<TableSnapshot, "scene" | "mood" | "grid" | "obscure">;
export type Participant = { id: string; name: string; color: string; role: "gm" | "player"; online: boolean };
export type Presence = { id: string; selection: string[]; laser: Point | null };
export type RoomState = {
  id: string; title: string; revision: number; playerEditing: boolean;
  me: Participant; participants: Participant[]; presence: Presence[]; table: SharedTable;
  versions: import("./room-operations.ts").Versions;
  history: { undo: boolean; redo: boolean };
  accepted: { id: string; revision: number }[];
  invite?: string;
};
export const emptySharedTable = (): SharedTable => ({
  scene: { objects: [], strokes: [] }, mood: { ...defaultMood },
  grid: { ...defaultGrid }, obscure: { ...defaultObscure, regions: [] },
});
export function sharedSnapshot(table: SharedTable): TableSnapshot {
  return {
    version: 1, ...table,
    dice: { color: null, fontColor: null, groups: [defaultDiceGroup()], activeGroup: "main", enabled: false, sound: false, history: [] },
    measurement: null, camera: { x: 0, y: 0, zoom: 1, width: 0, height: 0 },
    pen: { color: "#b66b45", thickness: 3, smoothing: .55, transforms: true },
  };
}
export function parseSharedTable(value: unknown): SharedTable | null {
  if (!value || typeof value !== "object") return null;
  const table = value as SharedTable;
  if (!table.scene || !Array.isArray(table.scene.objects) || table.scene.objects.length > 1000) return null;
  // Static artwork only in this first room transport. Never transmit local blob
  // addresses, capture IDs, or arbitrary external URLs to another participant.
  if (table.scene.objects.some(o => !o || typeof o !== "object" || ["camera", "screen", "video", "audio"].includes(o.kind) || o.video || o.audio || o.sourceId ||
    (o.image && !/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(o.image)))) return null;
  const snapshot = parseSnapshot(sharedSnapshot(table));
  if (!snapshot) return null;
  if (new Set(snapshot.scene.strokes.map(s => s.id)).size !== snapshot.scene.strokes.length) return null;
  return { scene: snapshot.scene, mood: snapshot.mood, grid: snapshot.grid,
    obscure: { ...snapshot.obscure, gm: false, gmOpacity: .28 } };
}
export function playerSceneAllowed(before: Scene, after: Scene): boolean {
  const old = new Map(before.objects.map(o => [o.id, o])), next = new Map(after.objects.map(o => [o.id, o]));
  const changed = new Set([...old.keys(), ...next.keys()].filter(id => JSON.stringify(old.get(id)) !== JSON.stringify(next.get(id))));
  // A locked descendant also protects its ancestors from transforms/deletion.
  for (const o of before.objects) if (o.locked) {
    let id: string | null = o.id;
    while (id) { if (changed.has(id)) return false; id = old.get(id)?.parentId ?? null; }
  }
  for (const o of after.objects) {
    if (!!o.locked !== !!old.get(o.id)?.locked) return false;
    if (changed.has(o.id) && o.parentId && old.get(o.parentId)?.locked) return false;
  }
  return true;
}
