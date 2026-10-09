const assert = require("node:assert/strict");
const drag = async (page, a, b) => {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
};
const lasso = async (page, points) => {
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const p of points.slice(1))
    await page.mouse.move(p.x, p.y, { steps: 5 });
  await page.mouse.up();
};
const readMeasure = page => page.locator(".measure-result strong").evaluate(el => {
  const parts = new Intl.NumberFormat().formatToParts(12345.6);
  const group = parts.find(p => p.type === "group")?.value ?? "\u0000";
  const decimal = parts.find(p => p.type === "decimal")?.value ?? ".";
  return Number(el.textContent.replaceAll(group, "").split(" ")[0].replace(decimal, "."));
});
exports.testUI = async (page) => {
  assert.equal(
    await page.locator(".table-caption, .toolbar-note, .brand p").count(),
    0,
  );
  const toggle = async (name, on) => {
    await page.getByRole("button", { name: "Widgets", exact: true }).click();
    await page
      .getByRole("checkbox", { name: `${name} widget`, exact: true })
      .setChecked(on);
    await page.getByRole("button", { name: "Widgets", exact: true }).click();
  };
  assert.equal(
    await page
      .getByRole("complementary", { name: "Optional table widgets" })
      .count(),
    0,
  );
  await toggle("3D dice", true);
  assert.equal(
    await page
      .getByRole("button", { name: "Dice sounds", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.getByRole("button", { name: "Dice sounds", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Dice sounds", exact: true })
      .getAttribute("aria-pressed"),
    "false",
  );
  await page.getByRole("button", { name: "Dice sounds", exact: true }).click();
  await page.getByRole("button", { name: "Add d6", exact: true }).click();
  await page.getByRole("button", { name: "Add d6", exact: true }).click();
  await page.getByRole("button", { name: "Add d20", exact: true }).click();
  assert.equal(
    await page.locator(".dice-pool span").textContent(),
    "2d6 + 1d20",
  );
  await page.getByRole("button", { name: "Remove d20", exact: true }).click();
  assert.equal(await page.locator(".dice-pool span").textContent(), "2d6");
  await page.getByRole("button", { name: "Roll dice", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Rolling…", exact: false })
      .isDisabled(),
    true,
  );
  await page.waitForTimeout(250);
  await page.screenshot({ path: ".test-artifacts/dice-rolling.png" });
  await page.waitForFunction(() =>
    document.querySelector(".dice-result strong"),
  );
  const result = Number(
      await page.locator(".dice-result strong").textContent(),
    ),
    values = (
      await page.locator(".roll-history li:first-child small").textContent()
    )
      .split(" · ")
      .map(Number);
  assert.equal(
    result,
    values.reduce((a, b) => a + b, 0),
  );
  assert.ok(values.every((n) => n >= 1 && n <= 6));
  await page.getByRole("button", { name: "Clear dice selection" }).click();
  for (const s of [4, 6, 8, 10, 12, 20, 100])
    await page.getByRole("button", { name: `Add d${s}`, exact: true }).click();
  await page.getByRole("button", { name: "Roll dice", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".roll-history li").length === 2,
  );
  await page.screenshot({ path: ".test-artifacts/dice-widget.png" });
  await page.waitForFunction(
    () => document.querySelector(".widget-section-heading button")?.disabled,
  );
  assert.equal(await page.locator(".roll-history li").count(), 2);
  assert.ok(await page.locator(".dice-result strong").textContent());
  await page.getByRole("button", { name: "Collapse widget" }).click();
  assert.equal(await page.locator(".widget-panel").count(), 0);
  await page.getByRole("button", { name: "Open Dice widget" }).click();
  assert.equal(await page.locator(".roll-history li").count(), 2);
  await toggle("Grid & measure", true);
  await page.getByRole("button", { name: "Use ruler", exact: true }).click();
  await drag(page, { x: 100, y: 300 }, { x: 500, y: 600 });
  assert.ok(
    (await page.locator(".measure-result strong").textContent()).endsWith(" m"),
  );
  const original = await readMeasure(page);
  await page.getByRole("spinbutton", { name: "Units per square" }).fill("3");
  await page.getByRole("textbox", { name: "Scale unit name" }).fill("paces");
  const scaled = await readMeasure(page);
  assert.ok(Math.abs(scaled - original * 3) < 0.025, `Ruler should scale by 3: original=${original}, scaled=${scaled}, label=${JSON.stringify(await page.locator(".measure-result strong").textContent())}`);
  await page.getByRole("slider", { name: "Grid rotation" }).fill("35");
  assert.equal(
    await readMeasure(page),
    scaled,
  );
  await page
    .getByRole("button", { name: "Edit grid rotation", exact: true })
    .click();
  await page.getByRole("spinbutton", { name: "Grid rotation value" }).fill("0");
  await page.keyboard.press("Enter");
  assert.equal(
    await page.getByRole("slider", { name: "Grid rotation" }).inputValue(),
    "0",
  );
  await page
    .getByRole("button", { name: "Edit grid rotation", exact: true })
    .click();
  await page
    .getByRole("spinbutton", { name: "Grid rotation value" })
    .fill("-22.5");
  await page.keyboard.press("Enter");
  assert.equal(
    await page.getByRole("slider", { name: "Grid rotation" }).inputValue(),
    "-22.5",
  );
  await page
    .getByRole("button", { name: "Edit grid rotation", exact: true })
    .click();
  await page
    .getByRole("spinbutton", { name: "Grid rotation value" })
    .fill("100");
  await page.keyboard.press("Escape");
  assert.equal(
    await page.getByRole("slider", { name: "Grid rotation" }).inputValue(),
    "-22.5",
  );
  await page
    .getByRole("button", { name: "Edit grid rotation", exact: true })
    .click();
  await page
    .getByRole("spinbutton", { name: "Grid rotation value" })
    .fill("999");
  await page
    .getByRole("button", { name: "Edit grid opacity", exact: true })
    .click();
  assert.equal(
    await page.getByRole("slider", { name: "Grid rotation" }).inputValue(),
    "180",
  );
  await page.getByRole("spinbutton", { name: "Grid opacity value" }).fill("0");
  await page.keyboard.press("Enter");
  assert.equal(
    await page.getByRole("slider", { name: "Grid opacity" }).inputValue(),
    "0",
  );
  await page
    .getByRole("button", { name: "Edit grid rotation", exact: true })
    .click();
  await page
    .getByRole("spinbutton", { name: "Grid rotation value" })
    .fill("35");
  await page.keyboard.press("Enter");
  await page.getByRole("slider", { name: "Grid opacity" }).fill("30");
  await page.screenshot({ path: ".test-artifacts/grid-widget.png" });
  await page.getByRole("slider", { name: "Grid opacity" }).fill("0");
  assert.ok(
    (await page.locator(".measure-result strong").textContent()).includes(
      "paces",
    ),
  );
  await page.getByRole("slider", { name: "Grid square size" }).fill("160");
  const resized = await readMeasure(page);
  assert.ok(Math.abs(resized - scaled / 2) < 0.01);
  await toggle("Obscure", true);
  await page.getByRole("button", { name: "Reveal", exact: true }).click();
  await lasso(page, [
    { x: 350, y: 250 },
    { x: 920, y: 250 },
    { x: 920, y: 650 },
    { x: 350, y: 650 },
    { x: 350, y: 250 },
  ]);
  assert.equal(
    await page.getByRole("button", { name: "Undo obscure" }).isEnabled(),
    true,
  );
  await page.getByRole("button", { name: "Cover", exact: true }).click();
  await lasso(page, [
    { x: 590, y: 350 },
    { x: 730, y: 350 },
    { x: 730, y: 500 },
    { x: 590, y: 500 },
    { x: 590, y: 350 },
  ]);
  await page.getByRole("checkbox", { name: "GM transparency" }).check();
  const opacity = page.getByRole("slider", { name: "GM cover opacity", exact: true });
  await opacity.fill("65");
  assert.equal(await opacity.inputValue(), "65");
  await page.getByRole("checkbox", { name: "GM transparency" }).uncheck();
  assert.equal(await opacity.count(), 0);
  await page.getByRole("checkbox", { name: "GM transparency" }).check();
  assert.equal(await opacity.inputValue(), "65", "GM opacity survives toggling the view");
  await page.screenshot({ path: ".test-artifacts/obscure-widget.png" });
  await page.getByRole("button", { name: "Undo obscure" }).click();
  await page.getByRole("button", { name: "Redo obscure" }).click();
  await page
    .getByRole("button", { name: "Reveal everything", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cover everything", exact: true })
    .click();
  await toggle("Obscure", false);
  await toggle("Grid & measure", false);
  await toggle("3D dice", false);
  assert.equal(await page.locator(".widget-dock").count(), 0);
  console.log(
    "PASS: optional widget switches, dice selection/rolling/history, grid/ruler controls and obscure lasso/GM/undo controls",
  );
};
exports.testEngine = async (page) => {
  await page.evaluate(() => {
    engine.reset(true);
    engine.grid = {
      enabled: true,
      size: 80,
      units: 1,
      unit: "m",
      angle: 0,
      opacity: 0.3,
    };
    engine.camera = { x: 700, y: 450, zoom: 1 };
    engine.setTool("measure");
  });
  await drag(page, { x: 200, y: 250 }, { x: 440, y: 570 });
  const line = await page.evaluate(() => engine.measurement);
  assert.equal(
    Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y),
    400,
  );
  // Panning and zooming preserve world endpoints. Measurement never moves an object.
  await page.evaluate(() => {
    engine.addShape("rectangle");
    engine.setTool("measure");
  });
  const object = await page.evaluate(() =>
    structuredClone(engine.scene.objects[0]),
  );
  await drag(page, { x: 700, y: 450 }, { x: 850, y: 550 });
  assert.deepEqual(await page.evaluate(() => engine.scene.objects[0]), object);
  const before = await page.evaluate(() => structuredClone(engine.measurement));
  await page.keyboard.down("Space");
  await drag(page, { x: 100, y: 700 }, { x: 210, y: 740 });
  await page.keyboard.up("Space");
  assert.deepEqual(await page.evaluate(() => engine.measurement), before);
  await page.evaluate(() => {
    engine.zoom(1.5);
    engine.setGrid({ opacity: 0, angle: 45 });
  });
  assert.deepEqual(await page.evaluate(() => engine.measurement), before);
  // Cancel restores the last completed ruler, not an unfinished line.
  await page.mouse.move(100, 250);
  await page.mouse.down();
  await page.mouse.move(150, 300);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.deepEqual(await page.evaluate(() => engine.measurement), before);
  await page.evaluate(() => {
    engine.reset(true);
    engine.camera = { x: 0, y: 0, zoom: 1 };
    const o = engine.addShape("rectangle");
    o.x = 550;
    o.y = 450;
    o.width = 500;
    o.height = 380;
    o.color = "#e9dabb";
    engine.selection.clear();
    engine.setObscure({ enabled: true, gm: false, mode: "reveal" });
    engine.setTool("obscure");
  });
  const pixel = (x, y) =>
    page.evaluate(
      ({ x, y }) => [
        ...engine.canvas.getContext("2d").getImageData(x, y, 1, 1).data,
      ],
      { x, y },
    );
  await page.waitForTimeout(40);
  const covered = await pixel(550, 450);
  assert.ok(covered[0] < 70);
  await lasso(page, [
    { x: 350, y: 300 },
    { x: 700, y: 300 },
    { x: 700, y: 600 },
    { x: 350, y: 600 },
    { x: 350, y: 300 },
  ]);
  await page.waitForTimeout(40);
  const revealed = await pixel(550, 450);
  assert.ok(revealed[0] > 180);
  assert.ok((await pixel(750, 450))[0] < 70);
  // Cover over a previous hole; undo/redo use a separate visual-layer history.
  await page.evaluate(() => engine.setObscure({ mode: "cover" }));
  await lasso(page, [
    { x: 470, y: 370 },
    { x: 620, y: 370 },
    { x: 620, y: 520 },
    { x: 470, y: 520 },
    { x: 470, y: 370 },
  ]);
  await page.waitForTimeout(40);
  assert.ok((await pixel(550, 450))[0] < 70);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(40);
  assert.ok((await pixel(550, 450))[0] > 180);
  await page.keyboard.press("Control+Shift+z");
  await page.waitForTimeout(40);
  assert.ok((await pixel(550, 450))[0] < 70);
  // Shift temporarily reverses cover to reveal.
  await page.keyboard.down("Shift");
  await lasso(page, [
    { x: 500, y: 400 },
    { x: 590, y: 400 },
    { x: 590, y: 490 },
    { x: 500, y: 490 },
    { x: 500, y: 400 },
  ]);
  await page.keyboard.up("Shift");
  await page.waitForTimeout(40);
  assert.ok((await pixel(550, 450))[0] > 180);
  await page.evaluate(() => engine.setObscure({ gm: true }));
  await page.waitForTimeout(40);
  const gm = await pixel(750, 450);
  assert.ok(gm[0] > 100 && gm[0] < 235);
  await page.evaluate(() => engine.setObscure({ gmOpacity: 0 }));
  await page.waitForTimeout(40);
  assert.ok((await pixel(750, 450))[0] > 230, "Zero GM opacity shows the underlying content");
  await page.evaluate(() => engine.setObscure({ gmOpacity: 1 }));
  await page.waitForTimeout(40);
  assert.ok((await pixel(750, 450))[0] < 100, "Full GM opacity conceals content");
  await page.evaluate(() => engine.setObscure({ gmOpacity: 0, gm: false }));
  await page.waitForTimeout(40);
  assert.ok((await pixel(750, 450))[0] < 100, "Normal cover stays opaque regardless of GM opacity");
  await page.evaluate(() => {
    engine.setObscure({ gm: false });
    engine.setTool("select");
  });
  // The visual mask must not participate in hit testing, parenting, or dragging.
  const original = await page.evaluate(() => ({
    x: engine.scene.objects[0].x,
    y: engine.scene.objects[0].y,
  }));
  await drag(page, { x: 750, y: 450 }, { x: 850, y: 500 });
  const moved = await page.evaluate(() => engine.scene.objects[0]);
  assert.equal(moved.x, original.x + 100);
  assert.equal(moved.y, original.y + 50);
  await page.evaluate(() => {
    engine.camera = { x: 200, y: 100, zoom: 1 };
    engine.selection.clear();
    engine.invalidate();
  });
  await page.waitForTimeout(40);
  assert.ok(
    (await pixel(750, 550))[0] > 180,
    "A revealed world-space hole follows the camera",
  );
  await page.evaluate(() => {
    engine.camera = { x: -1000000, y: 1000000, zoom: 0.1 };
    engine.invalidate();
  });
  await page.waitForTimeout(40);
  assert.ok(
    (await pixel(550, 450))[0] < 70,
    "Cover remains infinite far from original viewport",
  );
  await page.evaluate(() => {
    engine.setObscure({ enabled: false });
    engine.setGrid({ enabled: false });
    engine.dice.toggle(false);
    engine.reset(true);
    engine.setTool("select");
  });
  console.log(
    "PASS: free measurement, world-space ruler under pan/zoom, no object snapping, infinite visual cover, reveal/cover compositing, GM opacity, layer undo and click-through",
  );
};
