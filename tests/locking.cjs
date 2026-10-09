const assert = require("node:assert/strict");

exports.testUI = async existing => {
  const context = await existing.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(new URL("/", existing.url()).href);
    const create = async name => {
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await page.getByRole("button", { name: "Shapes Pick a shape, give it a color" }).click();
      await page.getByRole("button", { name: `Add ${name}`, exact: true }).click();
    };
    const saved = () => page.getByLabel("Local table save status").filter({ hasText: "SAVED LOCALLY" }).waitFor();
    const state = () => page.evaluate(async () => {
      const request = indexedDB.open("table-goblin", 1);
      const db = await new Promise(resolve => { request.onsuccess = () => resolve(request.result); });
      try {
        const read = db.transaction("tables").objectStore("tables").get("current");
        return (await new Promise(resolve => { read.onsuccess = () => resolve(read.result); })).snapshot.scene;
      } finally { db.close(); }
    });
    const drag = async (a, b) => { await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up(); };
    const menu = page.getByRole("dialog", { name: "Object actions" });
    await create("Rectangle");
    await page.mouse.click(720, 450, { button: "right" });
    await menu.getByRole("button", { name: "Lock object", exact: true }).click(); await saved();
    let scene = await state(); const mapId = scene.objects[0].id;
    assert.equal(scene.objects[0].locked, true);
    await page.getByRole("button", { name: "Undo", exact: true }).click(); await saved();
    assert.ok(!(await state()).objects[0].locked);
    await page.getByRole("button", { name: "Redo", exact: true }).click(); await saved();
    assert.equal((await state()).objects[0].locked, true);
    await create("Circle"); await drag({ x: 720, y: 450 }, { x: 670, y: 430 });
    await create("Circle"); await drag({ x: 720, y: 450 }, { x: 770, y: 480 });
    await saved(); scene = await state();
    assert.ok(scene.objects.filter(o => o.id !== mapId).every(o => o.parentId === mapId), "Tokens can attach to a locked map");
    await drag({ x: 590, y: 355 }, { x: 850, y: 545 });
    await page.mouse.click(670, 430, { button: "right" });
    assert.ok((await menu.textContent()).includes("2 selected objects"), "Dragging inside a locked map selects only tokens");
    await menu.getByRole("button", { name: "Lock selection", exact: true }).click(); await saved();
    assert.ok((await state()).objects.every(o => o.locked), "Bulk locking works");
    await page.reload(); await saved();
    assert.ok((await state()).objects.every(o => o.locked), "Locks survive refresh");
    await page.mouse.click(590, 355, { button: "right" });
    await menu.getByRole("button", { name: "Unlock object", exact: true }).waitFor();
    assert.equal(await menu.getByRole("button", { name: "Delete selected object" }).isDisabled(), true);
    await page.screenshot({ path: ".test-artifacts/locked-map.png" });
    await menu.getByRole("button", { name: "Close object actions" }).click();
    await page.keyboard.press("Delete"); await saved();
    assert.equal((await state()).objects.length, 3, "Delete cannot remove a locked map");
    await page.mouse.click(590, 355, { button: "right" });
    await menu.getByRole("button", { name: "Unlock object", exact: true }).click(); await saved();
    assert.equal((await state()).objects.find(o => o.id === mapId).locked, false);
    await drag({ x: 590, y: 370 }, { x: 610, y: 385 }); await saved();
    const map = (await state()).objects.find(o => o.id === mapId);
    assert.equal(map.x, 20); assert.equal(map.y, 15);
    console.log("PASS: canvas lock/unlock, bulk locking, locked-map marquee, independent tokens, delete protection, undo/redo and refresh persistence");
  } finally { await context.close(); }
};

exports.testEngine = async page => {
  const drag = async (a, b) => { await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up(); };
  const mapId = await page.evaluate(() => {
    engine.reset(true);
    const map = engine.addShape("rectangle"); Object.assign(map, { width: 1000, height: 600, x: 0, y: 0 });
    engine.setLocked(true);
    const a = engine.addShape("circle"), b = engine.addShape("hexagon");
    Object.assign(a, { width: 80, height: 80, x: -0.1, y: 0, parentId: map.id });
    Object.assign(b, { width: 80, height: 80, x: 0.1, y: 0, parentId: map.id });
    engine.selection.clear(); engine.emit(false); return map.id;
  });
  await drag({ x: 400, y: 300 }, { x: 1000, y: 600 });
  assert.equal(await page.evaluate(() => engine.selection.size), 2);
  assert.equal(await page.evaluate(id => engine.selection.has(id), mapId), false);
  await drag({ x: 600, y: 450 }, { x: 620, y: 470 });
  const moved = await page.evaluate(id => ({ map: engine.scene.objects.find(o => o.id === id), child: engine.scene.objects.find(o => o.parentId === id && o.x < 0) }), mapId);
  assert.equal(moved.map.x, 0); assert.equal(moved.map.y, 0);
  assert.ok(Math.abs(moved.child.x + 0.08) < 1e-8);
  await page.evaluate(() => { engine.setTool("pen"); engine.setSmoothing(0); });
  await drag({ x: 600, y: 650 }, { x: 660, y: 650 });
  assert.equal(await page.evaluate(id => engine.scene.objects.find(o => o.id === id).strokes.length, mapId), 1);
  const before = await page.evaluate(id => { engine.setTool("select"); engine.selectForContext({ x: 700, y: 650 }); return JSON.stringify(engine.scene.objects.find(o => o.id === id)); }, mapId);
  await drag({ x: 200, y: 150 }, { x: 180, y: 130 }); // Former resize handle.
  await drag({ x: 700, y: 114 }, { x: 750, y: 114 }); // Former rotation handle.
  assert.equal(await page.evaluate(id => JSON.stringify(engine.scene.objects.find(o => o.id === id)), mapId), before);
  await page.evaluate(id => { engine.selection = new Set([id]); engine.delete(); }, mapId);
  assert.equal(await page.evaluate(id => engine.scene.objects.some(o => o.id === id), mapId), true);
  await page.evaluate(id => { engine.setLocked(false, new Set([id])); engine.undo(); }, mapId);
  assert.equal(await page.evaluate(id => engine.scene.objects.find(o => o.id === id).locked, mapId), true);
  await page.evaluate(() => { engine.redo(); engine.reset(true); engine.setSmoothing(0.55); });
  console.log("PASS: locked map stays fixed across token moves, drawing, handles and delete, while lock undo/redo works");
};
