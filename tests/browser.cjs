const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const path = require("node:path");
let browser, server;
async function startServer() {
  server = spawn(
    process.execPath,
    [path.join(__dirname, "../scripts/launch.cjs")],
    { env: { ...process.env, TABLE_GOBLIN_NO_OPEN: "1" }, windowsHide: true },
  );
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Local server startup timed out")),
      6000,
    );
    server.stdout.on("data", (data) => {
      const url = data.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (url) {
        clearTimeout(timer);
        resolve(url);
      }
    });
    server.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.on("exit", (code) => {
      if (code) {
        clearTimeout(timer);
        reject(new Error(`Server exited with ${code}`));
      }
    });
  });
}
require("../node_modules/esbuild").buildSync({
  entryPoints: ["src/engine.ts"],
  bundle: true,
  format: "iife",
  globalName: "GoblinTest",
  outfile: ".test-artifacts/engine-test.js",
  define: { "import.meta.url": '""' },
});
(async () => {
  const base = await startServer();
  browser = await chromium.launch({
    channel:
      process.env.GOBLIN_BROWSER ||
      (process.platform === "win32" ? "msedge" : undefined),
    headless: true,
    args: ["--mute-audio"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const errors = [];
  const workers = [];
  page.on("worker", (worker) => workers.push(worker.url()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page
    .getByRole("button", { name: "Shapes Pick a shape, give it a color" })
    .click();
  await page
    .getByRole("button", { name: "Add Rectangle", exact: true })
    .click();
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await page.getByRole("button", { name: "highlighter", exact: true }).click();
  await page.mouse.move(700, 400);
  await page.mouse.down();
  await page.mouse.move(760, 430, { steps: 10 });
  await page.mouse.up();
  assert.equal(
    await page.getByRole("button", { name: "Undo", exact: true }).isEnabled(),
    true,
  );
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+Shift+z");
  await page.getByRole("button", { name: "How to play" }).click();
  assert.equal(await page.getByRole("dialog").count(), 1);
  await page.getByRole("button", { name: "Close help" }).click();
  await page.getByRole("button", { name: "Table options" }).click();
  await page.getByRole("button", { name: "Clear table", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "PASS: production toolbar, creation, drawing, undo/redo, help and clear controls",
  );
  // Exercise the actual token editor and contextual shape chooser.
  await page.getByRole("button", { name: "Table options" }).click();
  await page.getByRole("button", { name: "Clear table", exact: true }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page
    .getByRole("button", { name: "Shapes Pick a shape, give it a color" })
    .click();
  await page.screenshot({ path: ".test-artifacts/shapes.png" });
  await page.getByRole("button", { name: "Add Circle", exact: true }).click();
  await page.mouse.click(720, 450, { button: "right" });
  await page
    .getByRole("button", { name: "Surface color #b66b45", exact: true })
    .click();
  await page.mouse.click(400, 250);
  await page.mouse.click(720, 450);
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(
      new File(
        [
          '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="100" height="100" fill="red"/><rect x="100" width="100" height="100" fill="blue"/></svg>',
        ],
        "hero.svg",
        { type: "image/svg+xml" },
      ),
    );
    document
      .querySelector(".table-canvas")
      .dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true }),
      );
  });
  await page.waitForTimeout(100);
  await page.waitForTimeout(100);
  const maskPixels = await page.evaluate(() => {
    const c = document.querySelector(".table-canvas"),
      ctx = c.getContext("2d"),
      dpr = c.width / c.clientWidth;
    return {
      inside: Array.from(ctx.getImageData(700 * dpr, 450 * dpr, 1, 1).data),
      outside: Array.from(ctx.getImageData(656 * dpr, 386 * dpr, 1, 1).data),
    };
  });
  assert.ok(maskPixels.inside[0] > 200);
  assert.ok(maskPixels.outside[0] < 100 && maskPixels.outside[2] < 100);
  await page.getByRole("button", { name: "Toggle transform controls" }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Toggle transform controls" })
      .getAttribute("aria-pressed"),
    "false",
  );
  await page.mouse.dblclick(720, 450);
  await page.getByRole("dialog", { name: "Token artwork" }).waitFor();
  const artSlider = page.locator(".art-zoom input");
  await artSlider.focus();
  await artSlider.press("ArrowRight");
  const preview = await page.locator(".media-preview").boundingBox();
  await page.mouse.move(
    preview.x + preview.width / 2,
    preview.y + preview.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    preview.x + preview.width / 2 + 35,
    preview.y + preview.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await page.mouse.wheel(0, -80);
  await page.waitForTimeout(50);
  assert.ok(Number(await artSlider.inputValue()) > 1.15);
  await page.screenshot({ path: ".test-artifacts/token-editor.png" });
  await page
    .getByRole("button", { name: "Apply framing", exact: true })
    .click();
  await page.keyboard.press("Control+d");
  await page.screenshot({ path: ".test-artifacts/tokens.png" });
  console.log(
    "PASS: shape chooser, color picker, image mask pixels, Move-only toggle, double-click artwork editor and duplicate",
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      configurable: true,
      value: async () => {
        const c = document.createElement("canvas");
        c.width = 1280;
        c.height = 720;
        const ctx = c.getContext("2d"),
          stream = c.captureStream(15);
        setTimeout(() => {
          ctx.fillStyle = "#6a9279";
          ctx.fillRect(0, 0, 1280, 720);
          ctx.fillStyle = "#344f46";
          ctx.fillRect(0, 0, 1280, 80);
          ctx.fillRect(0, 640, 1280, 80);
          ctx.fillStyle = "#b8c7a5";
          ctx.font = "52px Georgia";
          ctx.fillText("Only the part you need.", 300, 380);
        }, 20);
        return stream;
      },
    });
  });
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page
    .getByRole("button", { name: "Live screen Window or screen · optional sound" })
    .click();
  await page.getByRole("button", { name: "Live feeds", exact: true }).click();
  await page.locator(".selected-feed").getByRole("button", { name: "Crop", exact: true }).click();
  await page.waitForTimeout(50);
  const cropBounds = await page.locator(".media-preview").evaluate((c) => {
    const r = c.getBoundingClientRect(),
      w = c.clientWidth,
      h = c.clientHeight,
      width = Math.min(w - 72, ((h - 48) * 1280) / 720),
      height = (width * 720) / 1280;
    return {
      x: r.x + (w - width) / 2,
      y: r.y + (h - height) / 2,
      width,
      height,
    };
  });
  const cropDrag = async (a, b) => {
    await page.mouse.move(
      cropBounds.x + a.x * cropBounds.width,
      cropBounds.y + a.y * cropBounds.height,
    );
    await page.mouse.down();
    await page.mouse.move(
      cropBounds.x + b.x * cropBounds.width,
      cropBounds.y + b.y * cropBounds.height,
      { steps: 8 },
    );
    await page.mouse.up();
  };
  await cropDrag({ x: 0.1, y: 0.1 }, { x: 0.8, y: 0.8 });
  assert.ok(
    Math.abs(
      Number(
        await page
          .getByRole("spinbutton", { name: "Left crop percent" })
          .inputValue(),
      ) - 10,
    ) < 0.5,
  );
  await page.keyboard.down("Shift");
  await cropDrag({ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.7 });
  await page.keyboard.up("Shift");
  assert.ok(
    Math.abs(
      Number(
        await page
          .getByRole("spinbutton", { name: "Left crop percent" })
          .inputValue(),
      ) - 30,
    ) < 0.5,
  );
  await page.getByRole("spinbutton", { name: "Top crop percent" }).fill("12");
  await page
    .getByRole("spinbutton", { name: "Bottom crop percent" })
    .fill("12");
  await page.getByRole("spinbutton", { name: "Left crop percent" }).fill("4");
  await page.getByRole("spinbutton", { name: "Right crop percent" }).fill("4");
  await page.screenshot({ path: ".test-artifacts/crop-editor.png" });
  await page.getByRole("button", { name: "Apply crop", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page.getByRole("button", { name: "Live feeds", exact: true }).click();
  await page.getByRole("button", { name: "Stop sharing", exact: true }).click();
  await page.keyboard.press("Escape");
  console.log(
    "PASS: live-source crop editor, edge margins, apply, undo/redo and stop sharing",
  );
  await require("./sources.cjs").testUI(page);
  await require("./theme.cjs").testUI(page);
  await require("./widgets.cjs").testUI(page);
  await require("./presets.cjs").testUI(page);
  await require("./storage.cjs").testUI(page);
  await require("./recovery.cjs").testUI(page);
  await require("./file-media.cjs").testUI(page);
  await require("./text.cjs").testUI(page);
  await require("./selection.cjs").testUI(page);
  await require("./locking.cjs").testUI(page);
  await require("./color-controls.cjs").testUI(page);
  assert.ok(
    workers.some((url) => url.includes("dice.worker-")),
    "Production dice physics runs in a worker",
  );
  const test = await browser.newPage({
    viewport: { width: 1400, height: 900 },
  });
  test.on("pageerror", (e) => errors.push(e.message));
  await test.goto(base + "/__table-goblin");
  await test.setContent(
    '<style>html,body{margin:0;width:100%;height:100%;}canvas{width:100%;height:100%;display:block}</style><canvas tabindex="0"></canvas>',
  );
  await test.addScriptTag({ path: ".test-artifacts/engine-test.js" });
  await test.evaluate(() => {
    window.engine = new GoblinTest.TableEngine(
      document.querySelector("canvas"),
      (v) => (window.view = v),
      (m) => (window.message = m),
    );
    engine.reset(true);
  });
  await test.waitForTimeout(100);
  await require("./sources.cjs").testEngine(test);
  await require("./selection.cjs").testEngine(test);
  await require("./locking.cjs").testEngine(test);
  await require("./color-controls.cjs").testEngine(test);
  await require("./recovery.cjs").testEngine(test);
  await require("./widgets.cjs").testEngine(test);
  await require("./theme.cjs").testEngine(test);
  await require("./dice-effects.cjs").testEngine(test);
  const state = () =>
    test.evaluate(() => ({
      scene: engine.scene,
      view,
      media: engine.media.size,
      lasers: engine.lasers.length,
    }));
  const add = (kind) => test.evaluate((kind) => engine.add(kind).id, kind);
  const drag = async (a, b) => {
    await test.mouse.move(a.x, a.y);
    await test.mouse.down();
    await test.mouse.move(b.x, b.y, { steps: 12 });
    await test.mouse.up();
  };
  const click = async (p) => test.mouse.click(p.x, p.y);
  const paperId = await add("paper");
  const cardId = await add("card");
  await drag({ x: 700, y: 450 }, { x: 645, y: 410 });
  let s = await state();
  let card = s.scene.objects.find((o) => o.id === cardId);
  assert.equal(card.parentId, paperId);
  await drag({ x: 800, y: 500 }, { x: 885, y: 550 });
  await click({ x: 730, y: 460 });
  s = await state();
  assert.equal(s.view.selection[0].id, cardId);
  assert.equal(s.view.parentName, "Blank paper");
  console.log(
    "PASS: physical parenting and child following on parent movement",
  );
  await click({ x: 900, y: 520 });
  // Paper center after the previous drag: 785,500. Rotate through its round handle.
  await drag({ x: 785, y: 320 }, { x: 965, y: 500 });
  s = await state();
  let paper = s.scene.objects.find((o) => o.id === paperId);
  assert.ok(Math.abs(paper.rotation - Math.PI / 2) < 0.02, paper.rotation);
  // Child offset (-55,-40) rotates to (40,-55).
  await click({ x: 825, y: 445 });
  s = await state();
  assert.equal(s.view.selection[0].id, cardId);
  await drag({ x: 825, y: 445 }, { x: 1150, y: 700 });
  s = await state();
  card = s.scene.objects.find((o) => o.id === cardId);
  assert.equal(card.parentId, null);
  assert.ok(Math.abs(card.x - 450) < 1);
  assert.ok(Math.abs(card.y - 250) < 1);
  await test.keyboard.press("Control+z");
  s = await state();
  assert.equal(s.scene.objects.find((o) => o.id === cardId).parentId, paperId);
  await test.keyboard.press("Control+Shift+z");
  s = await state();
  assert.equal(s.scene.objects.find((o) => o.id === cardId).parentId, null);
  console.log("PASS: parent rotation, jump-free detach, undo/redo");
  await test.evaluate(() => engine.reset(true));
  const p2 = await add("paper");
  await test.keyboard.press("d");
  await drag({ x: 640, y: 420 }, { x: 720, y: 455 });
  s = await state();
  let obj = s.scene.objects.find((o) => o.id === p2);
  assert.equal(obj.strokes.length, 1);
  const normalized = JSON.stringify(obj.strokes[0].points);
  await test.keyboard.press("v");
  await drag({ x: 800, y: 530 }, { x: 900, y: 560 });
  await drag({ x: 1010, y: 630 }, { x: 1110, y: 730 });
  s = await state();
  obj = s.scene.objects.find((o) => o.id === p2);
  assert.ok(obj.width > 420);
  assert.ok(obj.height > 300);
  assert.equal(JSON.stringify(obj.strokes[0].points), normalized);
  await test.keyboard.press("d");
  await drag({ x: 200, y: 300 }, { x: 270, y: 340 });
  s = await state();
  assert.equal(s.scene.strokes.length, 1);
  const worldStroke = JSON.stringify(s.scene.strokes[0]);
  await test.keyboard.press("v");
  await drag({ x: 900, y: 530 }, { x: 1000, y: 590 });
  s = await state();
  assert.equal(JSON.stringify(s.scene.strokes[0]), worldStroke);
  await test.keyboard.press("e");
  await click({ x: 220, y: 312 });
  s = await state();
  assert.equal(s.scene.strokes.length, 0);
  assert.equal(s.scene.objects.length, 1);
  await test.keyboard.press("Control+z");
  s = await state();
  assert.equal(s.scene.strokes.length, 1);
  console.log(
    "PASS: object-local drawing through move/resize, fixed table drawing, eraser and undo",
  );
  await test.evaluate(() => engine.reset(true));
  const px = await add("paper");
  const cx = await add("card");
  await drag({ x: 700, y: 450 }, { x: 650, y: 405 });
  await click({ x: 850, y: 530 });
  await test.keyboard.press("Delete");
  s = await state();
  assert.equal(s.scene.objects.length, 1);
  assert.equal(s.scene.objects[0].id, cx);
  assert.equal(s.scene.objects[0].parentId, null);
  await test.keyboard.press("Control+z");
  s = await state();
  assert.equal(s.scene.objects.length, 2);
  assert.equal(s.scene.objects.find((o) => o.id === cx).parentId, px);
  console.log("PASS: delete releases children and undo restores nesting");
  // Dispatch on the canvas so the clipboard event has an HTMLElement target, as a real paste does.
  await test.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(
      new File(
        [
          '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="70"><rect width="100" height="70" fill="red"/></svg>',
        ],
        "image.svg",
        { type: "image/svg+xml" },
      ),
    );
    document
      .querySelector("canvas")
      .dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true }),
      );
  });
  await test.waitForTimeout(150);
  s = await state();
  assert.equal(s.scene.objects.filter((o) => o.kind === "image").length, 1);
  await test.keyboard.press("l");
  await drag({ x: 650, y: 400 }, { x: 850, y: 510 });
  s = await state();
  assert.ok(s.lasers > 0);
  const count = s.scene.strokes.length;
  await test.waitForTimeout(800);
  s = await state();
  assert.equal(s.lasers, 0);
  assert.equal(s.scene.strokes.length, count);
  console.log("PASS: clipboard image pipeline and non-persistent laser trail");
  await test.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 1280;
    c.height = 720;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#336666";
    ctx.fillRect(0, 0, 1280, 720);
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      configurable: true,
      value: async () => {
        const stream = c.captureStream(15);
        setTimeout(() => ctx.fillRect(0, 0, 1280, 720), 20);
        return stream;
      },
    });
    engine.reset(true);
    await engine.addScreen();
  });
  s = await state();
  assert.equal(s.media, 1);
  assert.equal(s.scene.objects[0].kind, "screen");
  const screenId = s.scene.objects[0].id;
  await test.keyboard.press("d");
  await drag({ x: 620, y: 420 }, { x: 750, y: 470 });
  s = await state();
  assert.equal(s.scene.objects[0].strokes.length, 1);
  await test.evaluate((id) => engine.stopScreen(id), screenId);
  s = await state();
  assert.equal(s.media, 0);
  assert.equal(s.scene.objects[0].strokes.length, 1);
  console.log(
    "PASS: live video capture surface (simulated stream), annotation and stop",
  );
  await test.evaluate(async () => {
    engine.reset(true);
    engine.transforms = false;
    engine.addShape("circle");
    const file = new File(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="red"/></svg>',
      ],
      "hero.svg",
      { type: "image/svg+xml" },
    );
    await engine.addImages([file], undefined, true);
  });
  s = await state();
  assert.equal(s.scene.objects.length, 1);
  assert.ok(s.scene.objects[0].image);
  const tokenId = s.scene.objects[0].id;
  await drag({ x: 700, y: 450 }, { x: 730, y: 480 });
  s = await state();
  assert.equal(s.scene.objects[0].width, 140);
  assert.equal(s.scene.objects[0].height, 140);
  await test.keyboard.press("Control+z");
  s = await state();
  assert.equal(s.scene.objects[0].id, tokenId);
  assert.equal(s.scene.objects[0].x, 0);
  await test.evaluate(() => {
    engine.reset(true);
    const root = engine.addShape("rectangle");
    const child = engine.addShape("circle");
    child.parentId = root.id;
    child.x = 0.2;
    child.y = 0.1;
    child.strokes = [
      {
        id: "stroke",
        points: [{ x: 0, y: 0 }],
        color: "#fff",
        width: 0.1,
        highlight: false,
      },
    ];
    const grandchild = engine.add("card");
    grandchild.parentId = child.id;
    grandchild.x = 0.1;
    grandchild.y = 0;
    engine.selection = new Set([root.id, child.id]);
    const data = new DataTransfer();
    const canvas = document.querySelector("canvas");
    canvas.dispatchEvent(
      new ClipboardEvent("copy", { clipboardData: data, bubbles: true }),
    );
    window.copied = data.getData("text/plain");
    canvas.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true }),
    );
  });
  s = await state();
  assert.equal(s.scene.objects.length, 6);
  assert.equal(s.view.selection.length, 1);
  const copyRoot = s.view.selection[0],
    copyChild = s.scene.objects.find((o) => o.parentId === copyRoot.id),
    copyGrandchild = s.scene.objects.find((o) => o.parentId === copyChild.id);
  assert.ok(copyChild && copyGrandchild);
  assert.equal(copyChild.strokes.length, 1);
  assert.notEqual(copyChild.strokes[0].id, "stroke");
  await test.keyboard.press("Control+z");
  s = await state();
  assert.equal(s.scene.objects.length, 3);
  await test.keyboard.press("Control+Shift+z");
  s = await state();
  assert.equal(s.scene.objects.length, 6);
  console.log(
    "PASS: masked token movement with handles disabled, full hierarchy clipboard copy/paste, fresh stroke identities and undo/redo",
  );
  await test.evaluate(async () => {
    engine.reset(true);
    await engine.addScreen();
    const id = engine.scene.objects[0].id;
    engine.saveCrop(id, { x: 0.1, y: 0.12, width: 0.8, height: 0.75 });
    engine.duplicate();
    window.originalScreenId = id;
  });
  s = await state();
  assert.equal(s.media, 1);
  assert.equal(s.scene.objects.length, 2);
  assert.deepEqual(s.scene.objects[1].crop, {
    x: 0.1,
    y: 0.12,
    width: 0.8,
    height: 0.75,
  });
  assert.equal(s.scene.objects[1].sourceId, s.scene.objects[0].id);
  await test.keyboard.press("Delete");
  s = await state();
  assert.equal(s.media, 1);
  await test.evaluate(() => {
    engine.selection = new Set([originalScreenId]);
    engine.delete();
  });
  s = await state();
  assert.equal(s.media, 0);
  console.log(
    "PASS: crop settings, duplicated live capture, and shared-stream cleanup only after the last copy is removed",
  );
  // Record real browser-playable files, avoiding external assets or network fixtures.
  const codecs = await test.evaluate(async () => {
    engine.reset(true);
    const results = [];
    for (const mime of ["video/webm;codecs=vp8", "video/mp4"]) {
      if (!MediaRecorder.isTypeSupported(mime)) continue;
      const c = document.createElement("canvas");
      c.width = 160;
      c.height = 90;
      const ctx = c.getContext("2d");
      const stream = c.captureStream(20),
        recorder = new MediaRecorder(stream, { mimeType: mime }),
        chunks = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      const done = new Promise((resolve) => (recorder.onstop = resolve));
      recorder.start();
      let count = 0;
      const interval = setInterval(() => {
        ctx.fillStyle = count++ % 2 ? "#559977" : "#aa6655";
        ctx.fillRect(0, 0, 160, 90);
      }, 30);
      await new Promise((resolve) => setTimeout(resolve, 350));
      recorder.stop();
      await done;
      clearInterval(interval);
      stream.getTracks().forEach((t) => t.stop());
      const type = mime.split(";")[0];
      await engine.addFiles([
        new File(chunks, type === "video/mp4" ? "clip.mp4" : "clip.webm", {
          type,
        }),
      ]);
      results.push(type);
    }
    return results;
  });
  await test.waitForTimeout(100);
  s = await state();
  assert.ok(codecs.includes("video/webm"));
  assert.equal(s.scene.objects.length, codecs.length);
  assert.ok(
    await test.evaluate(() =>
      engine.scene.objects.every((o) => {
        const video = engine.renderer.videos.get(o.id)?.video;
        return video?.loop && video.muted && !video.paused;
      }),
    ),
  );
  await test.evaluate(() => engine.togglePlayback(engine.scene.objects[0].id));
  await test.waitForTimeout(50);
  assert.equal(
    await test.evaluate(
      () => engine.renderer.videos.get(engine.scene.objects[0].id).video.paused,
    ),
    true,
  );
  console.log(
    `PASS: looping muted file playback (${codecs.join(", ")}), pause/resume`,
  );
  const gif = Buffer.from([
    71,
    73,
    70,
    56,
    57,
    97,
    1,
    0,
    1,
    0,
    128,
    0,
    0,
    255,
    0,
    0,
    0,
    0,
    255,
    33,
    255,
    11,
    ...Buffer.from("NETSCAPE2.0"),
    3,
    1,
    0,
    0,
    0,
    33,
    249,
    4,
    4,
    10,
    0,
    0,
    0,
    44,
    0,
    0,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
    2,
    2,
    68,
    1,
    0,
    33,
    249,
    4,
    4,
    10,
    0,
    0,
    0,
    44,
    0,
    0,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
    2,
    2,
    76,
    1,
    0,
    59,
  ]).toString("base64");
  await test.evaluate(async (data) => {
    engine.reset(true);
    await engine.addFiles([
      new File(
        [Uint8Array.from(atob(data), (c) => c.charCodeAt(0))],
        "loop.gif",
        { type: "image/gif" },
      ),
    ]);
  }, gif);
  await test.waitForFunction(
    () => engine.renderer.gifs.get(engine.scene.objects[0].id)?.gif,
  );
  const gifColors = await test.evaluate(async () => {
    const o = engine.scene.objects[0],
      colors = new Set();
    for (let i = 0; i < 15; i++) {
      const source = engine.getSource(o);
      colors.add(
        Array.from(source.getContext("2d").getImageData(0, 0, 1, 1).data).join(
          ",",
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    return [...colors];
  });
  assert.ok(gifColors.length === 2, gifColors.join(";"));
  console.log("PASS: decoded animated GIF changes frames and loops");
  await test.evaluate(async () => {
    engine.reset(true);
    await engine.addScreen();
    await engine.addScreen();
    for (let i = 0; i < 98; i++) {
      const o = engine.add("card", {
        x: ((i % 14) - 7) * 75,
        y: (Math.floor(i / 14) - 3) * 80,
      });
      o.width = 64;
      o.height = 54;
      if (i < 40)
        o.strokes.push({
          id: String(i),
          color: "#b66b45",
          width: 0.04,
          highlight: false,
          points: Array.from({ length: 100 }, (_, j) => ({
            x: j / 100 - 0.5,
            y: Math.sin(j * 0.2) * 0.3,
          })),
        });
    }
    engine.selection.clear();
    engine.undoStack = [];
    engine.redoStack = [];
    engine.fit();
  });
  const frameTimes = await test.evaluate(async () => {
    const times = [];
    for (let i = 0; i < 30; i++) {
      await new Promise(requestAnimationFrame);
      const start = performance.now();
      engine.renderer.render(
        engine.scene,
        engine.camera,
        engine.selection,
        null,
        new Set(),
        engine.media,
        [],
        null,
        null,
      );
      times.push(performance.now() - start);
    }
    return times.sort((a, b) => a - b);
  });
  console.log(
    `RENDER: 100 objects, 4,000 drawing points, 2 video surfaces; median ${frameTimes[15].toFixed(1)} ms, p95 ${frameTimes[28].toFixed(1)} ms`,
  );
  await test.evaluate(() => engine.dispose());
  assert.equal(errors.length, 0, errors.join("\n"));
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    server?.kill();
  });
