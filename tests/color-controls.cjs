const assert = require("node:assert/strict");

exports.testUI = async existingPage => {
  const context = await existingPage.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    window.tableWrites = 0;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "tables") window.tableWrites++;
      return put.apply(this, args);
    };
  });
  const page = await context.newPage();
  const saved = () => page.getByLabel("Local table save status").filter({ hasText: "SAVED LOCALLY" }).waitFor();
  const state = () => page.evaluate(async () => {
    const request = indexedDB.open("table-goblin", 1);
    const db = await new Promise(resolve => { request.onsuccess = () => resolve(request.result); });
    try {
      const read = db.transaction("tables").objectStore("tables").get("current");
      return (await new Promise(resolve => { read.onsuccess = () => resolve(read.result); })).snapshot;
    } finally { db.close(); }
  });
  const ramp = async (label, color, event = "input") => page.getByLabel(label, { exact: true }).evaluate((input, { color, event }) => {
    input.value = color;
    input.dispatchEvent(new Event(event, { bubbles: true }));
  }, { color, event });
  const burst = async label => page.getByLabel(label, { exact: true }).evaluate(async input => {
    for (let n = 0; n < 50; n++) {
      input.value = `#${(0x880000 + n * 171).toString(16)}`;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    input.value = "#ee4488";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const writes = () => page.evaluate(() => window.tableWrites);
  const canvasPixel = () => page.locator(".table-canvas").evaluate(canvas => [...canvas.getContext("2d").getImageData(720, 450, 1, 1).data]);
  try {
    await page.goto(new URL("/", existingPage.url()).href);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("button", { name: "Shapes Pick a shape, give it a color" }).click();
    await page.getByRole("button", { name: "Add Rectangle", exact: true }).click();
    await saved(); await page.waitForTimeout(100);
    const original = (await state()).scene.objects[0].color;
    const pixelBefore = await canvasPixel();
    await page.mouse.click(720, 450, { button: "right" });
    const baselineWrites = await writes();
    await burst("Shape color"); await page.waitForTimeout(100);
    assert.equal(await writes(), baselineWrites, "Ramp previews do not write the table");
    assert.equal((await state()).scene.objects[0].color, original);
    assert.notDeepEqual(await canvasPixel(), pixelBefore, "Color still previews live on the canvas");
    assert.equal(await page.getByLabel("Shape color", { exact: true }).inputValue(), "#ee4488");
    await ramp("Shape color", "#ee4488", "change"); await saved();
    assert.equal((await state()).scene.objects[0].color, "#ee4488");
    assert.equal(await writes(), baselineWrites + 1, "The final choice writes once");
    await page.getByRole("button", { name: "Undo", exact: true }).click(); await saved();
    assert.equal((await state()).scene.objects[0].color, original, "One undo restores the color before dragging");
    await page.getByRole("button", { name: "Redo", exact: true }).click(); await saved();
    assert.equal((await state()).scene.objects[0].color, "#ee4488");
    await page.mouse.click(720, 450, { button: "right" });
    await ramp("Shape color", "#112233");
    // Closing the containing menu before the throttled preview fires must keep
    // the latest choice, even when the browser emits no final change event.
    await page.mouse.click(300, 250); await saved();
    assert.equal((await state()).scene.objects[0].color, "#112233");
    await page.getByRole("button", { name: "Table mood", exact: true }).click();
    await page.getByRole("button", { name: "Campfire", exact: true }).click(); await saved();
    const themeWrites = await writes();
    await burst("Effect color"); await page.waitForTimeout(80);
    assert.equal(await writes(), themeWrites, "Theme ramp previews do not write the table");
    await ramp("Effect color", "#ee4488", "change"); await saved();
    assert.equal((await state()).mood.campfireColor, "#ee4488");
    console.log("PASS: native color ramp live previews without table writes, one-step undo, final commit and menu-close persistence");
  } finally { await context.close(); }
};

exports.testEngine = async page => {
  const result = await page.evaluate(() => {
    engine.reset(true);
    const a = engine.addShape("circle"), b = engine.addShape("rectangle");
    engine.selection = new Set([a.id, b.id]);
    const originals = [a.color, b.color], undo = engine.undoStack.length;
    for (let n = 0; n < 100; n++) engine.setSurfaceColor("#112233", true);
    const previewUndo = engine.undoStack.length;
    engine.setSurfaceColor("#112233");
    const finalUndo = engine.undoStack.length;
    engine.undo();
    const restored = engine.scene.objects.map(o => o.color);
    engine.setSurfaceColor("#445566", true);
    engine.setSurfaceColor(originals[0]); // Native picker cancellation returns its original color.
    const cancelUndo = engine.undoStack.length;
    const note = engine.add("text"); note.text.content = "Note";
    const textOriginal = note.text.color, textUndo = engine.undoStack.length;
    for (let n = 0; n < 100; n++) engine.setTextColor(note.id, "#778899", true);
    const textPreviewUndo = engine.undoStack.length;
    engine.setTextColor(note.id, "#778899"); engine.undo();
    return { originals, undo, previewUndo, finalUndo, restored, cancelUndo, textOriginal, textUndo, textPreviewUndo,
      textRestored: engine.scene.objects.find(o => o.id === note.id).text.color };
  });
  assert.equal(result.previewUndo, result.undo);
  assert.equal(result.finalUndo, result.undo + 1);
  assert.deepEqual(result.restored, result.originals);
  assert.equal(result.cancelUndo, result.undo, "Cancelling a picker adds no undo entry");
  assert.equal(result.textPreviewUndo, result.textUndo);
  assert.equal(result.textRestored, result.textOriginal);
  console.log("PASS: multi-object and text color previews use one undo step; cancellation restores original colors");
};
