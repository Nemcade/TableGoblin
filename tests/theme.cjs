const assert = require("node:assert/strict");
exports.testUI = async (page) => {
  const mood = () =>
    page.getByRole("button", { name: "Table mood", exact: true }).click();
  const slider = (name, value) =>
    page.getByRole("slider", { name, exact: true }).fill(String(value));
  const pixel = async () => {
    await page.waitForTimeout(35);
    return page.evaluate(() => [
      ...document
        .querySelector(".table-canvas")
        .getContext("2d")
        .getImageData(100, 730, 1, 1).data,
    ]);
  };
  await mood();
  await slider("Table saturation", 0);
  await slider("Table lightness", 100);
  assert.deepEqual(await pixel(), [255, 255, 255, 255]);
  assert.equal(
    await page
      .locator(".mood-menu")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(255, 255, 255)",
  );
  await page.screenshot({ path: ".test-artifacts/theme-light.png" });
  await slider("Table lightness", 0);
  assert.deepEqual(await pixel(), [0, 0, 0, 255]);
  await page.screenshot({ path: ".test-artifacts/theme-black.png" });
  await slider("Table lightness", 22);
  await slider("Table gradient", 0);
  await slider("Table texture", 0);
  await page
    .getByRole("button", { name: "Edit table saturation", exact: true })
    .click();
  await page
    .getByRole("spinbutton", { name: "Table saturation value", exact: true })
    .fill("90");
  await page.keyboard.press("Enter");
  await slider("Table hue", 270);
  const base = await pixel();
  await page.getByRole("button", { name: "Campfire", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Effect color hex", exact: true })
    .fill("#00ff88");
  await page.keyboard.press("Enter");
  await slider("Animation pace", 0);
  await slider("Animation strength", 300);
  await slider("Animation spread", 150);
  await slider("Animation variation", 120);
  const glow = await pixel();
  assert.ok(glow[1] > base[1] + 20);
  await page.screenshot({ path: ".test-artifacts/theme-custom-effect.png" });
  await slider("Animation strength", 0);
  assert.deepEqual(await pixel(), base);
  await page.getByRole("button", { name: "Treetops", exact: true }).click();
  assert.equal(
    await page.getByLabel("Effect color", { exact: true }).inputValue(),
    "#000804",
  );
  await page
    .getByRole("textbox", { name: "Effect color hex", exact: true })
    .fill("#ffffff");
  await page.keyboard.press("Enter");
  await slider("Animation strength", 400);
  assert.ok((await pixel())[1] > base[1] + 20);
  await page.getByRole("button", { name: "Campfire", exact: true }).click();
  assert.equal(
    await page.getByLabel("Effect color", { exact: true }).inputValue(),
    "#00ff88",
  );
  await require("./preset-actions.cjs").basicMood(page);
  assert.equal(
    await page.getByRole("slider", { name: "Table saturation" }).inputValue(),
    "7",
  );
  assert.equal(
    await page.getByRole("slider", { name: "Table gradient" }).inputValue(),
    "100",
  );
  await mood();
  const toggle = async (on) => {
    await page.getByRole("button", { name: "Widgets", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "3D dice widget", exact: true })
      .setChecked(on);
    await page.getByRole("button", { name: "Widgets", exact: true }).click();
  };
  await toggle(true);
  await page.getByText("Dice colors", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "Dice color hex", exact: true })
    .fill("#310088");
  await page.keyboard.press("Enter");
  await page
    .getByRole("textbox", { name: "Numeral color hex", exact: true })
    .fill("#ffff33");
  await page.keyboard.press("Enter");
  assert.equal(
    await page
      .getByRole("img", { name: "Dice color preview" })
      .evaluate((el) => getComputedStyle(el).color),
    "rgb(255, 255, 51)",
  );
  await mood();
  await slider("Table lightness", 90);
  await slider("Table saturation", 0);
  await mood();
  assert.equal(
    await page.getByLabel("Dice color", { exact: true }).inputValue(),
    "#310088",
  );
  assert.equal(
    await page.getByLabel("Numeral color", { exact: true }).inputValue(),
    "#ffff33",
  );
  await page.screenshot({ path: ".test-artifacts/dice-colors.png" });
  await page
    .getByRole("button", { name: "Use theme dice color", exact: true })
    .click();
  assert.notEqual(
    await page.getByLabel("Dice color", { exact: true }).inputValue(),
    "#310088",
  );
  assert.equal(
    await page.getByLabel("Numeral color", { exact: true }).inputValue(),
    "#ffff33",
  );
  await page
    .getByRole("button", { name: "Use automatic numeral color", exact: true })
    .click();
  await toggle(false);
  await mood();
  await require("./preset-actions.cjs").basicMood(page);
  await mood();
  console.log(
    "PASS: full black/white themes, exact saturation, gradient/texture, per-effect colors and extended intensity/spread/variation/pace, dice overrides and resets",
  );
};
exports.testEngine = async (page) => {
  await page.evaluate(() => {
    window.savedMood = structuredClone(engine.mood);
    engine.reset(true);
    engine.dice.toggle(true);
    engine.dice.setSound(false);
    engine.dice.choose(6);
    engine.dice.roll(engine.camera, engine.viewWidth, engine.viewHeight);
    const d = engine.dice;
    d.step(
      d.start + ((d.frames.frameCount - 1) / d.frames.fps) * 1000,
      engine.camera,
      engine.viewWidth,
      engine.viewHeight,
    );
    engine.dice.setAppearance({ color: "#ee1144", fontColor: "#ffff00" });
    engine.invalidate();
  });
  const pixels = async () => {
    await page.waitForTimeout(35);
    return page.evaluate(() => {
      const b = engine.dice.bodies[0],
        x = Math.round(b.position.x * engine.camera.zoom + engine.camera.x),
        y = Math.round(b.position.y * engine.camera.zoom + engine.camera.y);
      const data = engine.canvas
        .getContext("2d")
        .getImageData(x - 40, y - 40, 80, 80).data;
      let red = 0,
        yellow = 0,
        blue = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i],
          g = data[i + 1],
          b = data[i + 2];
        if (r > 160 && g < 70 && b < 130) red++;
        if (r > 150 && g > 150 && b < 80) yellow++;
        if (b > 190 && g > 100 && r < 150) blue++;
      }
      return { red, yellow, blue };
    });
  };
  const before = await pixels();
  assert.ok(before.red > 200 && before.yellow > 8, `Expected dice body and numeral pixels: ${JSON.stringify(before)}`);
  await page.evaluate(() => {
    engine.setMood({ saturation: 0, lightness: 100 });
    engine.dice.setAppearance({ fontColor: "#33bbff" });
  });
  const after = await pixels();
  assert.ok(after.red > 200 && after.blue > 8);
  assert.equal(after.yellow, 0);
  await page.evaluate(() => {
    engine.dice.toggle(false);
    engine.dice.clearPool();
    engine.dice.setAppearance({ color: null, fontColor: null });
    engine.setMood(savedMood);
    engine.reset(true);
  });
  console.log(
    "PASS: rendered dice body/numeral overrides update existing dice and remain independent of the app theme",
  );
};
