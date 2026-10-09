import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTextMark, baseMarks, defaultText, layoutText, replaceText, textColor, textMode, textRuns, validText } from "../src/text.ts";
import { createShape, createSurface, findParent } from "../src/model.ts";
import { defaultMood } from "../src/mood.ts";
import { luminance } from "../src/colors.ts";
import { parseScene } from "../src/table-storage.ts";

test("text wrapping preserves newlines, Unicode, long words and hanging lists", () => {
  const measure = (s: string) => [...s].length * 10;
  assert.deepEqual(layoutText({ ...defaultText, mode: "paragraph", content: "one two\n\n😀abcdef" }, 40, measure).map(l => l.content), ["one", "two", "", "😀abc", "def"]);
  const list = layoutText({ ...defaultText, size: 24, mode: "paragraph", content: "one two three\nfour", list: "number" }, 90, measure);
  assert.deepEqual(list.map(l => l.marker), ["1.", "", "", "2."]);
  assert.ok(list.every(l => l.indent > 0));
});
test("labels break only at explicit newlines; old text remains paragraph text with glow off", () => {
  const content = "A long label\nSecond line";
  assert.deepEqual(layoutText({ ...defaultText, content }, 30, s => s.length * 10).map(l => l.content), ["A long label", "Second line"]);
  const legacy = { ...defaultText, mode: undefined, glow: undefined, spans: undefined };
  assert.equal(textMode(legacy), "paragraph"); assert.ok(validText(legacy));
});
test("word formatting is composable, preserves explicit false, and follows editing offsets", () => {
  const initial = { ...defaultText, content: "Watch the bridge" };
  let text = applyTextMark(initial, 10, 16, "bold", true);
  assert.deepEqual(textRuns(text).map(r => [r.content, r.style.bold]), [["Watch the ", false], ["bridge", true]]);
  text = applyTextMark(text, 13, 16, "italic", true);
  text = replaceText(text, 0, 0, "😀 ", baseMarks(text));
  assert.equal(text.content, "😀 Watch the bridge"); assert.ok(validText(text));
  assert.equal(textRuns(text).find(r => r.content === "dge")?.style.italic, true);
  const unbold = applyTextMark({ ...initial, bold: true }, 10, 16, "bold", false);
  assert.equal(textRuns(unbold).at(-1)?.style.bold, false);
  const removed = replaceText(text, 13, 19, "door", baseMarks(text));
  assert.equal(removed.content, "😀 Watch the door"); assert.ok(validText(removed));
});
test("mixed formatting affects wrapping and survives scene validation; bad spans are rejected", () => {
  const t = applyTextMark({ ...defaultText, mode: "paragraph", content: "one two" }, 4, 7, "bold", true);
  const lines = layoutText(t, 65, (s, marks) => s.length * (marks.bold ? 15 : 10));
  assert.deepEqual(lines.map(l => l.content), ["one", "two"]); assert.equal(lines[1].runs[0].style.bold, true);
  for (const patch of [{ mode: "bad" }, { glow: "yes" }, { spans: [{ start: 0, end: 50, style: { bold: true } }] },
    { spans: [{ start: 0, end: 3, style: { color: "red" } }] }, { spans: [{ start: 0, end: 3, style: {} }, { start: 2, end: 4, style: {} }] }]) assert.equal(validText({ ...t, ...patch }), false);
});
test("automatic text color follows theme and colored ancestor; custom color remains explicit", () => {
  const parent = createShape("rectangle", { x: 0, y: 0 }), obj = { ...createSurface("text", { x: 0, y: 0 }), text: { ...defaultText } };
  const scene = { objects: [parent, obj], strokes: [] };
  assert.ok(luminance(textColor(obj, scene, { ...defaultMood, lightness: 0 })) > .5);
  assert.ok(luminance(textColor(obj, scene, { ...defaultMood, lightness: 100 })) < .1);
  obj.parentId = parent.id; parent.color = "#ffff99";
  assert.ok(luminance(textColor(obj, scene, defaultMood)) < .1);
  parent.color = "#111111";
  assert.ok(luminance(textColor(obj, scene, defaultMood)) > .5);
  obj.text.color = "#cc5522" as any;
  assert.equal(textColor(obj, scene, defaultMood), "#cc5522");
});
test("text persists with safe formatting and cannot accidentally become a parent", () => {
  const text = { ...createSurface("text", { x: 0, y: 0 }), text: { ...defaultText, content: "A saved note", font: "serif" as const } };
  const shape = createShape("circle", { x: 0, y: 0 }), scene = { objects: [text, shape], strokes: [] };
  assert.equal(findParent(scene, shape), undefined);
  assert.ok(parseScene(scene));
  assert.ok(validText(text.text));
  for (const patch of [{ size: NaN }, { lineHeight: 0 }, { font: "bogus" }, { color: "red" }, { content: "a".repeat(20001) }, { bold: "yes" }]) {
    assert.equal(validText({ ...text.text, ...patch }), false);
    assert.equal(parseScene({ ...scene, objects: [{ ...text, text: { ...text.text, ...patch } }] }), null);
  }
});
