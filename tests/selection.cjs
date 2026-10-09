const assert = require("node:assert/strict");

exports.testUI = async existingPage => {
  const context = await existingPage.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(new URL("/", existingPage.url()).href);
    const create = async name => {
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await page.getByRole("button", { name: "Shapes Pick a shape, give it a color" }).click();
      await page.getByRole("button", { name: `Add ${name}`, exact: true }).click();
    };
    const drag = async (a, b) => {
      await page.mouse.move(a.x, a.y); await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
    };
    const state = () => page.evaluate(async () => {
      const request = indexedDB.open("table-goblin", 1);
      const db = await new Promise(resolve => { request.onsuccess = () => resolve(request.result); });
      try {
        const read = db.transaction("tables").objectStore("tables").get("current");
        return (await new Promise(resolve => { read.onsuccess = () => resolve(read.result); })).snapshot.scene;
      } finally { db.close(); }
    });
    const saved = () => page.getByLabel("Local table save status").filter({ hasText: "SAVED LOCALLY" }).waitFor();
    await create("Rectangle"); await drag({ x: 720, y: 450 }, { x: 550, y: 400 });
    await create("Circle"); await drag({ x: 720, y: 450 }, { x: 850, y: 470 });
    assert.equal(await page.getByRole("dialog", { name: "Object actions" }).count(), 0);
    assert.equal(await page.locator(".selection-info").count(), 0);
    await drag({ x: 400, y: 280 }, { x: 970, y: 580 });
    assert.equal(await page.getByRole("dialog", { name: "Object actions" }).count(), 0, "Marquee does not automatically open bulk actions");
    await page.mouse.click(550, 400, { button: "right" });
    const menu = page.getByRole("dialog", { name: "Object actions" });
    assert.ok((await menu.textContent()).includes("2 selected objects"));
    await menu.getByRole("button", { name: "Surface color #b66b45", exact: true }).click(); await saved();
    assert.ok((await state()).objects.every(o => o.color === "#b66b45"), "Bulk color applies to every selected shape");
    await page.screenshot({ path: ".test-artifacts/object-actions.png" });
    await menu.getByRole("button", { name: "Duplicate selection" }).click(); await saved();
    assert.equal((await state()).objects.length, 4);
    await page.mouse.click(578, 428, { button: "right" });
    await menu.getByRole("button", { name: "Delete selected object" }).click(); await saved();
    assert.equal((await state()).objects.length, 2);
    await page.getByRole("button", { name: "Undo", exact: true }).click(); await saved();
    assert.equal((await state()).objects.length, 4);
    assert.equal(await menu.count(), 0);
    console.log("PASS: production marquee, actions only on right-click, bulk color/duplicate/delete, and undo");
  } finally { await context.close(); }
};

exports.testEngine = async page => {
  const drag = async (a, b, release = true, button = "left") => {
    await page.mouse.move(a.x, a.y); await page.mouse.down({ button });
    await page.mouse.move(b.x, b.y, { steps: 8 });
    if (release) await page.mouse.up({ button });
  };
  const ids = () => page.evaluate(() => [...engine.selection].sort());
  const fixture = await page.evaluate(() => {
    engine.reset(true); engine.transforms = false;
    const a = engine.addShape("rectangle"), b = engine.addShape("circle"), c = engine.addShape("triangle");
    Object.assign(a, { x: -250, y: -100, width: 80, height: 60 });
    Object.assign(b, { x: -80, y: -80, width: 80, height: 60 });
    Object.assign(c, { x: 250, y: -80, width: 80, height: 60 });
    engine.selection.clear(); engine.emit(false);
    return { a: a.id, b: b.id, c: c.id, scene: JSON.stringify(engine.scene), undo: engine.undoStack.length };
  });
  await drag({ x: 380, y: 280 }, { x: 700, y: 440 }, false);
  assert.deepEqual(await ids(), [fixture.a, fixture.b].sort(), "Marquee previews multiple selected shapes");
  await page.screenshot({ path: ".test-artifacts/marquee.png" });
  await page.mouse.up();
  const after = await page.evaluate(() => ({ scene: JSON.stringify(engine.scene), undo: engine.undoStack.length, gesture: engine.gesture }));
  assert.deepEqual(after, { scene: fixture.scene, undo: fixture.undo, gesture: null }, "Selection does not move objects or create an undo edit");
  await page.keyboard.down("Shift");
  await drag({ x: 880, y: 300 }, { x: 1010, y: 420 });
  await page.keyboard.up("Shift");
  assert.deepEqual(await ids(), [fixture.a, fixture.b, fixture.c].sort());
  await drag({ x: 520, y: 400 }, { x: 400, y: 310 });
  assert.deepEqual(await ids(), [fixture.a], "Dragging in reverse replaces the selection");
  await page.keyboard.down("Shift"); await page.mouse.click(620, 370); await page.keyboard.up("Shift");
  assert.deepEqual(await ids(), [fixture.a, fixture.b].sort(), "Shift-click remains additive");
  await drag({ x: 880, y: 300 }, { x: 1010, y: 420 }, false);
  await page.keyboard.press("Escape"); await page.mouse.up();
  assert.deepEqual(await ids(), [fixture.a, fixture.b].sort(), "Escape cancels marquee and restores the previous selection");
  await drag({ x: 880, y: 300 }, { x: 1010, y: 420 }, false);
  await page.evaluate(() => engine.canvas.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true })));
  await page.mouse.up();
  assert.deepEqual(await ids(), [fixture.a, fixture.b].sort(), "Pointer cancellation restores selection");
  await page.keyboard.down("Space"); await drag({ x: 200, y: 200 }, { x: 260, y: 250 }); await page.keyboard.up("Space");
  await drag({ x: 200, y: 200 }, { x: 240, y: 230 }, true, "middle");
  assert.deepEqual(await ids(), [fixture.a, fixture.b].sort(), "Both pan gestures preserve selection");
  await page.evaluate(() => engine.zoom(2));
  const coords = await page.evaluate(() => {
    const camera = engine.camera;
    return [{ x: -300, y: -150 }, { x: -180, y: -50 }].map(p => ({ x: camera.x + p.x * camera.zoom, y: camera.y + p.y * camera.zoom }));
  });
  await drag(coords[0], coords[1]);
  assert.deepEqual(await ids(), [fixture.a], "Marquee stays aligned after pan and zoom");
  await page.mouse.click(180, 200); assert.deepEqual(await ids(), [], "An empty-space click clears selection");
  const nested = await page.evaluate(() => {
    engine.reset(true);
    const parent = engine.addShape("rectangle"), child = engine.addShape("circle");
    Object.assign(parent, { width: 300, height: 200, x: 0, y: 0 });
    Object.assign(child, { width: 50, height: 50, x: 0.2, y: 0.1, parentId: parent.id });
    engine.selection.clear(); engine.emit(false);
    return { parent: parent.id, child: child.id };
  });
  await drag({ x: 500, y: 300 }, { x: 900, y: 600 });
  assert.deepEqual(await ids(), [nested.parent, nested.child].sort());
  await drag({ x: 600, y: 420 }, { x: 620, y: 435 });
  const positions = await page.evaluate(ids => ids.map(id => {
    const o = engine.scene.objects.find(o => o.id === id); return { x: o.x, y: o.y, parentId: o.parentId };
  }), [nested.parent, nested.child]);
  assert.deepEqual(positions, [{ x: 20, y: 15, parentId: null }, { x: 0.2, y: 0.1, parentId: nested.parent }], "A selected parent and child move once without breaking their hierarchy");
  await page.evaluate(() => { engine.reset(true); engine.transforms = true; });
  console.log("PASS: marquee preview, reverse/additive selection, shape footprints, cancel, pan/zoom, no scene edits, and nested group movement");
};
