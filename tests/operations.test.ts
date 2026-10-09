import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySharedTable } from "../src/room-state.ts";
import { createShape } from "../src/model.ts";
import { advanceVersions, applyChanges, expectations, inverseChanges, operationConflict, tableChanges, validOperation } from "../src/room-operations.ts";

const table = () => {
  const t = emptySharedTable();
  t.scene.objects = [0, 1, 2].map(x => createShape("circle", { x: x * 100, y: 0 }));
  return t;
};
test("object operations merge simultaneous independent edits, including their stacking order", () => {
  const original = table(), a = structuredClone(original), b = structuredClone(original);
  a.scene.objects[0].x += 20; a.scene.objects.push(a.scene.objects.shift()!);
  b.scene.objects[1].x += 50; b.scene.objects.push(b.scene.objects.splice(1, 1)[0]);
  const ca = tableChanges(original, a), cb = tableChanges(original, b);
  const va = advanceVersions(original, a, ca, {}, 1);
  const op = { id: "independent-edit", changes: cb, expected: expectations(original, cb, {}) };
  assert.equal(operationConflict(a, op, va), false);
  const combined = applyChanges(a, cb)!;
  assert.equal(combined.scene.objects.find(o => o.id === original.scene.objects[0].id)!.x, 20);
  assert.equal(combined.scene.objects.find(o => o.id === original.scene.objects[1].id)!.x, 150);
  assert.equal(combined.scene.objects.at(-1)!.id, original.scene.objects[1].id);
});
test("entity revisions detect overlapping edits and ABA changes", () => {
  const original = table(), changed = structuredClone(original); changed.scene.objects[0].x = 10;
  const changes = tableChanges(original, changed), op = { id: "overlapping-edit", changes, expected: expectations(original, changes, {}) };
  const v1 = advanceVersions(original, changed, changes, {}, 1);
  assert.equal(operationConflict(changed, op, v1), true);
  const reset = tableChanges(changed, original), v2 = advanceVersions(changed, original, reset, v1, 2);
  assert.equal(operationConflict(original, op, v2), true, "Returning to the same value still invalidates a stale edit");
});
test("hierarchy read sets protect transforms from concurrent children, reparenting and omitted dependencies", () => {
  const original = table(); original.scene.objects[1].parentId = original.scene.objects[0].id;
  const changed = structuredClone(original); changed.scene.objects[0].rotation = .2;
  const changes = tableChanges(original, changed), expected = expectations(original, changes, {});
  assert.ok(expected.some(e => e.key === `object:${original.scene.objects[1].id}`));
  assert.equal(operationConflict(original, { id: "forged-transform", changes, expected: expected.filter(e => !e.key.startsWith("tree:")) }, {}), true);
  const childAdded = structuredClone(original), child = createShape("circle", { x: 0, y: 0 }); child.parentId = original.scene.objects[0].id;
  childAdded.scene.objects.push(child);
  const versions = advanceVersions(original, childAdded, tableChanges(original, childAdded), {}, 1);
  assert.equal(operationConflict(childAdded, { id: "stale-parent-edit", changes, expected }, versions), true);
  const childMoved = structuredClone(original); childMoved.scene.objects[1].x = .3;
  const childChanges = tableChanges(original, childMoved);
  assert.equal(operationConflict(changed, { id: "stale-child-edit", changes: childChanges, expected: expectations(original, childChanges, {}) }, advanceVersions(original, changed, changes, {}, 1)), true);
});
test("operations and their inverse preserve nesting, creation, deletion, widgets and stacking", () => {
  for (const action of ["move", "create", "delete", "reorder", "widget"]) {
    const original = table(), next = structuredClone(original);
    if (action === "move") next.scene.objects[1].x += 40;
    if (action === "create") next.scene.objects.push(createShape("rectangle", { x: 50, y: 50 }));
    if (action === "delete") next.scene.objects.splice(1, 1);
    if (action === "reorder") next.scene.objects.reverse();
    if (action === "widget") next.mood.hue = 215;
    const changes = tableChanges(original, next);
    assert.deepEqual(applyChanges(original, changes), next, action);
    assert.deepEqual(applyChanges(next, inverseChanges(original, changes)), original, `inverse ${action}`);
  }
});
test("forged commands cannot replace identities, create invalid hierarchies or duplicate drawing IDs", () => {
  const original = table(), changes = tableChanges(original, { ...original, mood: { ...original.mood, hue: 25 } });
  const op = { id: "valid-test-operation", changes, expected: expectations(original, changes, {}) };
  assert.equal(validOperation(op), true);
  assert.equal(validOperation({ ...op, changes: [...changes, ...changes] }), false);
  assert.equal(validOperation({ ...op, expected: [{ key: "widget:mood", version: -1 }] }), false);
  assert.equal(applyChanges(original, [{ key: "object:forged", value: original.scene.objects[0] }]), null);
  const cycle = structuredClone(original.scene.objects[0]); cycle.parentId = cycle.id;
  assert.equal(applyChanges(original, [{ key: `object:${cycle.id}`, value: cycle }]), null);
  const stroke = { id: "ink", points: [{ x: 1, y: 1 }], width: 2, color: "#ffffff", highlight: false };
  const ink = structuredClone(original); ink.scene.strokes = [stroke];
  const next = applyChanges(ink, [{ key: "stroke:other", value: stroke }]);
  assert.equal(next, null);
});
test("drawing deletion restores original order, and restoration anchors conflict only when removed", () => {
  const original = table();
  original.scene.strokes = ["one", "two", "three"].map(id => ({ id, points: [{ x: 1, y: 2 }], width: 2, color: "#ffffff", highlight: false }));
  const erased = structuredClone(original); erased.scene.strokes.splice(1, 1);
  const changes = tableChanges(original, erased), inverse = inverseChanges(original, changes);
  assert.deepEqual(applyChanges(erased, inverse), original);
  const moved = structuredClone(original); moved.scene.objects.push(moved.scene.objects.splice(1, 1)[0]);
  const raising = tableChanges(original, moved), restoring = inverseChanges(original, raising);
  const versions = advanceVersions(original, moved, raising, {}, 1);
  const op = { id: "restore-placement", changes: restoring, expected: expectations(moved, restoring, versions) };
  const neighbor = structuredClone(moved); neighbor.scene.objects.find(o => o.id === original.scene.objects[0].id)!.color = "#112233";
  assert.equal(operationConflict(neighbor, op, advanceVersions(moved, neighbor, tableChanges(moved, neighbor), versions, 2)), false);
  const deleted = structuredClone(moved); deleted.scene.objects.shift();
  assert.equal(operationConflict(deleted, op, advanceVersions(moved, deleted, tableChanges(moved, deleted), versions, 2)), true);
});
