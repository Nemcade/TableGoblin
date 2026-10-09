import type { Scene, Surface } from "./model.ts";
import type { SharedTable } from "./room-state.ts";

export type ObjectAccess = { owner: string; shared: boolean; editors: string[] };
export type AccessMap = Record<string, ObjectAccess>;
export type DragLease = { client: string; actor: string; objects: string[]; expires: number };
export const validAccess = (p: unknown): p is ObjectAccess => {
  const v = p as ObjectAccess;
  return !!v && typeof v.owner === "string" && v.owner.length > 0 && typeof v.shared === "boolean" && Array.isArray(v.editors) && v.editors.length <= 24 && v.editors.every(id => typeof id === "string") && new Set(v.editors).size === v.editors.length;
};
export const canEdit = (access: AccessMap, key: string, actor: string, gm = false) => gm || !!access[key] && (access[key].owner === actor || access[key].shared || access[key].editors.includes(actor));
export function hierarchy(scene: Scene, ids: string[]): string[] {
  const all = new Set(ids);
  for (let size = -1; size !== all.size;) {
    size = all.size;
    for (const o of scene.objects) if (o.parentId && all.has(o.parentId)) all.add(o.id);
  }
  return [...all];
}
export function transformChanged(a: Surface, b?: Surface) {
  return !b || (["x", "y", "width", "height", "rotation", "parentId"] as const).some(key => a[key] !== b[key]);
}
/** Locks protect placement. Independent pieces may sit on a locked background. */
export function locksAllowed(before: Scene, after: Scene): boolean {
  const old = new Map(before.objects.map(o => [o.id, o])), next = new Map(after.objects.map(o => [o.id, o]));
  for (const o of after.objects) if (!!o.locked !== !!old.get(o.id)?.locked) return false;
  for (const locked of before.objects.filter(o => o.locked)) {
    let o: Surface | undefined = locked;
    while (o) { if (transformChanged(o, next.get(o.id))) return false; o = old.get(o.parentId ?? ""); }
  }
  return true;
}
/** Server and canvas use the same ownership rules; no client-supplied grants. */
export function editsAllowed(before: SharedTable, after: SharedTable, access: AccessMap, actor: string, gm: boolean, creating: boolean): boolean {
  if (gm) return true;
  if (!locksAllowed(before.scene, after.scene)) return false;
  if (["mood", "grid", "obscure"].some(k => JSON.stringify(before[k as keyof SharedTable]) !== JSON.stringify(after[k as keyof SharedTable]))) return false;
  const old = new Map(before.scene.objects.map(o => [o.id, o])), next = new Map(after.scene.objects.map(o => [o.id, o]));
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    const a = old.get(id), b = next.get(id);
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const key = `object:${id}`;
    if (a ? !canEdit(access, key, actor) : access[key] ? !canEdit(access, key, actor) : !creating) return false;
    if (a && transformChanged(a, b) && hierarchy(before.scene, [id]).some(child => !canEdit(access, `object:${child}`, actor))) return false;
    if (b?.parentId && (!a || b.parentId !== a.parentId)) {
      const parent = old.get(b.parentId) ?? next.get(b.parentId);
      if (parent && !parent.locked && (old.has(parent.id) || access[`object:${parent.id}`] ? !canEdit(access, `object:${parent.id}`, actor) : !creating)) return false;
    }
  }
  const strokes = new Map(before.scene.strokes.map(s => [s.id, s])), incoming = new Map(after.scene.strokes.map(s => [s.id, s]));
  for (const id of new Set([...strokes.keys(), ...incoming.keys()])) if (JSON.stringify(strokes.get(id)) !== JSON.stringify(incoming.get(id))) {
    const key = `stroke:${id}`;
    if (strokes.has(id) || access[key] ? !canEdit(access, key, actor) : !creating) return false;
  }
  return true;
}
export function assignNewAccess(table: SharedTable, access: AccessMap, actor: string): AccessMap {
  const next = { ...access };
  for (const [kind, list] of [["object", table.scene.objects], ["stroke", table.scene.strokes]] as const)
    for (const o of list) next[`${kind}:${o.id}`] ??= { owner: actor, shared: false, editors: [] };
  return next;
}
