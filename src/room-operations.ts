import { parseSharedTable, type SharedTable } from "./room-state.ts";
import type { Surface, Stroke } from "./model.ts";

export type Versions = Record<string, number>;
export type Change = { key: string; value: Surface | Stroke | SharedTable["mood"] | SharedTable["grid"] | SharedTable["obscure"] | null; after?: string | null; top?: boolean };
export type Expectation = { key: string; version: number };
export type RoomOperation = { id: string; changes: Change[]; expected: Expectation[] };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const objectKey = (id: string) => `object:${id}`;

/** Objects and freehand strokes are independent entities; widgets have their own versions. */
export function tableChanges(before: SharedTable, after: SharedTable): Change[] {
  const result: Change[] = [];
  for (const [kind, oldList, newList] of [
    ["object", before.scene.objects, after.scene.objects],
    ["stroke", before.scene.strokes, after.scene.strokes],
  ] as const) {
    const old = new Map<string, Surface | Stroke>(oldList.map(o => [o.id, o]));
    const next = new Map<string, Surface | Stroke>(newList.map(o => [o.id, o]));
    for (const id of new Set([...old.keys(), ...next.keys()])) if (!same(old.get(id), next.get(id)))
      result.push({ key: `${kind}:${id}`, value: next.get(id) ?? null });
  }
  // Moving an object raises it in the local canvas. Describe the moved suffix,
  // rather than replacing everybody's stacking order with an old array.
  const wanted = after.scene.objects.map(o => o.id);
  const order = [...before.scene.objects.map(o => o.id).filter(id => wanted.includes(id)), ...wanted.filter(id => !before.scene.objects.some(o => o.id === id))];
  let last = -1, suffix = wanted.length;
  for (let i = 0; i < wanted.length; i++) {
    const index = order.indexOf(wanted[i]);
    if (index < last) { suffix = i; break; }
    last = index;
  }
  for (let i = suffix; i < wanted.length; i++) {
    const key = objectKey(wanted[i]);
    let change = result.find(c => c.key === key);
    if (!change) { change = { key, value: after.scene.objects[i] }; result.push(change); }
    change.top = true;
  }
  for (const key of ["mood", "grid", "obscure"] as const) if (!same(before[key], after[key])) result.push({ key: `widget:${key}`, value: after[key] });
  return structuredClone(result);
}

/** Include ancestors, descendants and child-list versions, even for forged requests. */
export function requiredKeys(table: SharedTable, changes: Change[]): string[] {
  const keys = new Set(changes.map(c => c.key));
  const objects = new Map(table.scene.objects.map(o => [o.id, o]));
  const ancestors = (id: string | null) => {
    const seen = new Set<string>();
    while (id && !seen.has(id)) { seen.add(id); keys.add(objectKey(id)); keys.add(`tree:${id}`); id = objects.get(id)?.parentId ?? null; }
  };
  for (const c of changes) if (c.key.startsWith("object:")) {
    const id = c.key.slice(7);
    ancestors(id);
    if (c.value) ancestors((c.value as Surface).parentId);
    const pending = [id], seen = new Set<string>();
    while (pending.length) {
      const parent = pending.pop()!;
      if (seen.has(parent)) continue;
      seen.add(parent); keys.add(objectKey(parent)); keys.add(`tree:${parent}`);
      for (const o of objects.values()) if (o.parentId === parent) pending.push(o.id);
    }
  }
  for (const c of changes) if (typeof c.after === "string") keys.add(`exist:${c.after}`);
  return [...keys].sort();
}
export function expectations(table: SharedTable, changes: Change[], versions: Versions): Expectation[] {
  return requiredKeys(table, changes).map(key => ({ key, version: versions[key] ?? 0 }));
}
export function operationConflict(table: SharedTable, operation: RoomOperation, versions: Versions): boolean {
  const supplied = new Map(operation.expected.map(e => [e.key, e.version]));
  return requiredKeys(table, operation.changes).some(key => !supplied.has(key) || supplied.get(key) !== (versions[key] ?? 0));
}
export function validOperation(value: unknown): value is RoomOperation {
  if (!value || typeof value !== "object") return false;
  const v = value as RoomOperation;
  const key = (s: unknown) => typeof s === "string" && /^(object|stroke|tree|exist):.{1,128}$|^widget:(mood|grid|obscure)$/.test(s);
  return typeof v.id === "string" && /^[a-z0-9-]{16,80}$/i.test(v.id) && Array.isArray(v.changes) && v.changes.length > 0 && v.changes.length <= 51003 &&
    v.changes.every(c => c && key(c.key) && !/^(tree|exist):/.test(c.key) && (c.value === null || !!c.value && typeof c.value === "object" && !Array.isArray(c.value)) &&
      (c.after === undefined || /^(object|stroke):/.test(c.key) && (c.after === null || typeof c.after === "string" && c.after.length <= 128)) &&
      (c.top === undefined || /^(object|stroke):/.test(c.key) && typeof c.top === "boolean")) &&
    new Set(v.changes.map(c => c.key)).size === v.changes.length && Array.isArray(v.expected) && v.expected.length <= 54003 &&
    v.expected.every(e => e && key(e.key) && Number.isSafeInteger(e.version) && e.version >= 0) && new Set(v.expected.map(e => e.key)).size === v.expected.length;
}
export function applyChanges(table: SharedTable, changes: Change[], allowLocalMedia = false): SharedTable | null {
  const next = structuredClone(table);
  for (const c of changes) {
    if (c.key.startsWith("object:") || c.key.startsWith("stroke:")) {
      const object = c.key.startsWith("object:"), id = c.key.slice(7), list: (Surface | Stroke)[] = object ? next.scene.objects : next.scene.strokes;
      const index = list.findIndex(o => o.id === id);
      if (c.value === null) { if (index >= 0) list.splice(index, 1); }
      else {
        if ((c.value as Surface | Stroke).id !== id) return null;
        if (index >= 0) list[index] = structuredClone(c.value as Surface | Stroke); else list.push(structuredClone(c.value as Surface | Stroke));
      }
    } else if (["widget:mood", "widget:grid", "widget:obscure"].includes(c.key) && c.value)
      Object.assign(next, { [c.key.slice(7)]: structuredClone(c.value) });
    else return null;
  }
  for (const c of changes) if ((c.top || c.after !== undefined) && c.value) {
    const list: (Surface | Stroke)[] = c.key.startsWith("object:") ? next.scene.objects : next.scene.strokes;
    const id = c.key.slice(7), index = list.findIndex(o => o.id === id);
    if (index < 0 || !c.top && (c.after === id || c.after !== null && !list.some(o => o.id === c.after))) return null;
    const [obj] = list.splice(index, 1);
    list.splice(c.top ? list.length : c.after === null ? 0 : list.findIndex(o => o.id === c.after) + 1, 0, obj);
  }
  // Free drawing IDs must also be unique to make commands unambiguous.
  if (new Set(next.scene.strokes.map(s => s.id)).size !== next.scene.strokes.length) return null;
  return parseSharedTable(next, allowLocalMedia);
}
export function advanceVersions(before: SharedTable, after: SharedTable, changes: Change[], versions: Versions, revision: number): Versions {
  const next = { ...versions };
  for (const c of changes) next[c.key] = revision;
  for (const c of changes) if (/^(object|stroke):/.test(c.key)) {
    const list = c.key.startsWith("object:") ? before.scene.objects : before.scene.strokes;
    if (c.value === null || !list.some(o => o.id === c.key.slice(7))) next[`exist:${c.key.slice(7)}`] = revision;
  }
  const old = new Map(before.scene.objects.map(o => [o.id, o])), current = new Map(after.scene.objects.map(o => [o.id, o]));
  const touch = (id: string | null, objects: Map<string, Surface>) => {
    while (id) { next[`tree:${id}`] = revision; id = objects.get(id)?.parentId ?? null; }
  };
  for (const c of changes) if (c.key.startsWith("object:")) {
    const id = c.key.slice(7), a = old.get(id), b = current.get(id);
    if (!a || !b || a.parentId !== b.parentId) { touch(a?.parentId ?? null, old); touch(b?.parentId ?? null, current); }
  }
  return next;
}
export function inverseChanges(before: SharedTable, changes: Change[]): Change[] {
  const inverse = changes.map(c => {
    if (c.key.startsWith("object:")) {
      const index = before.scene.objects.findIndex(o => o.id === c.key.slice(7)), old = before.scene.objects[index];
      return { key: c.key, value: old ? structuredClone(old) : null,
        ...(old && (c.top || c.after !== undefined || c.value === null) ? { after: before.scene.objects[index - 1]?.id ?? null } : {}) };
    }
    if (c.key.startsWith("stroke:")) {
      const index = before.scene.strokes.findIndex(s => s.id === c.key.slice(7));
      return { key: c.key, value: structuredClone(before.scene.strokes[index] ?? null), ...(index >= 0 && c.value === null ? { after: before.scene.strokes[index - 1]?.id ?? null } : {}) };
    }
    return { key: c.key, value: structuredClone(before[c.key.slice(7) as "mood" | "grid" | "obscure"]) };
  });
  const rank = (c: Change) => c.key.startsWith("object:") ? before.scene.objects.findIndex(o => o.id === c.key.slice(7)) : c.key.startsWith("stroke:") ? 1001 + before.scene.strokes.findIndex(s => s.id === c.key.slice(7)) : 100000;
  return inverse.sort((a, b) => rank(a) - rank(b));
}
