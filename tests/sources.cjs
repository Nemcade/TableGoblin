const assert = require("node:assert/strict");
async function installSources(page) {
  await page.evaluate(() => {
    window.fake = {
      streams: [],
      canvases: [],
      contexts: [],
      constraints: [],
      granted: false,
      denied: false,
      noAudio: false,
      delay: 0,
    };
    const video = (name = "OBS Virtual Camera", id = "obs") => {
      const c = document.createElement("canvas");
      c.width = 640;
      c.height = 360;
      const ctx = c.getContext("2d");
      const paint = () => {
        ctx.fillStyle = "#567456";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.fillStyle = "#d7d8bb";
        ctx.font = "32px sans-serif";
        ctx.fillText(name, 35, 185);
      };
      paint();
      fake.canvases.push(c);
      const s = c.captureStream(30),
        t = s.getVideoTracks()[0],
        settings = t.getSettings.bind(t);
      Object.defineProperty(t, "label", { value: name });
      t.getSettings = () => ({ ...settings(), deviceId: id, width: 640, height: 360 }); // Deliberately stale after window resizing.
      const frame = () => {
        if (t.readyState === "ended") return;
        paint();
        requestAnimationFrame(frame);
      };
      setTimeout(frame, 20);
      return s;
    };
    const audio = () => {
      const ctx = new AudioContext(),
        osc = ctx.createOscillator(),
        gain = ctx.createGain(),
        dest = ctx.createMediaStreamDestination();
      gain.gain.value = 0.15;
      osc.connect(gain);
      gain.connect(dest);
      osc.start();
      void ctx.resume();
      fake.contexts.push(ctx);
      Object.defineProperty(dest.stream.getAudioTracks()[0], "label", {
        value: "Virtual audio cable",
      });
      return dest.stream;
    };
    for (const name of ["enumerateDevices", "getUserMedia", "getDisplayMedia"])
      Object.defineProperty(navigator.mediaDevices, name, {
        configurable: true,
        writable: true,
        value: navigator.mediaDevices[name],
      });
    navigator.mediaDevices.enumerateDevices = async () => [
      {
        kind: "videoinput",
        deviceId: "obs",
        label: fake.granted ? "OBS Virtual Camera" : "",
      },
      {
        kind: "videoinput",
        deviceId: "webcam",
        label: fake.granted ? "Desk webcam" : "",
      },
      {
        kind: "audioinput",
        deviceId: "cable",
        label: fake.granted ? "Virtual audio cable" : "",
      },
    ];
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      fake.constraints.push(constraints);
      if (fake.denied) throw new DOMException("Declined", "NotAllowedError");
      const id = constraints.video?.deviceId?.exact || "obs";
      const stream = constraints.video
        ? video(id === "webcam" ? "Desk webcam" : "OBS Virtual Camera", id)
        : audio();
      fake.streams.push(stream);
      fake.granted = true;
      if (fake.delay) await new Promise((r) => setTimeout(r, fake.delay));
      return stream;
    };
    navigator.mediaDevices.getDisplayMedia = async (constraints) => {
      fake.constraints.push(constraints);
      if (fake.denied) throw new DOMException("Declined", "NotAllowedError");
      const v = video("Browser tab", "display"),
        s = new MediaStream([
          ...v.getVideoTracks(),
          ...(!fake.noAudio ? audio().getAudioTracks() : []),
        ]);
      fake.streams.push(s);
      return s;
    };
  });
}
exports.testUI = async (page) => {
  await installSources(page);
  const feeds = async () => {
    const button = page.getByRole("button", { name: "Live feeds", exact: true });
    if (await button.getAttribute("aria-expanded") !== "true") await button.click();
    return page.getByRole("dialog", { name: "Live feeds", exact: true });
  };
  const camera = async () => {
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page
      .getByRole("button", {
        name: "Camera / virtual camera Webcam, OBS, or another video device",
      })
      .click();
  };
  await camera();
  assert.equal(
    await page.evaluate(() => fake.streams.length),
    0,
    "Opening the panel must not activate a camera",
  );
  await page
    .getByRole("button", { name: "Enable camera preview", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector(".camera-preview").classList.contains("has-preview"),
  );
  assert.equal(
    await page.getByRole("combobox", { name: "Video source" }).textContent(),
    "OBS Virtual Camera⌄",
  );
  await page.getByRole("combobox", { name: "Video source" }).click();
  const popup = await page.getByRole("listbox", { name: "Video source" }).boundingBox();
  const dialog = await page.getByRole("dialog").boundingBox();
  assert.ok(popup.x >= dialog.x && popup.x + popup.width <= dialog.x + dialog.width && popup.height < 230);
  await page.screenshot({ path: ".test-artifacts/camera-source-picker.png" });
  await page.getByRole("combobox", { name: "Video source" }).press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 1, "Escape closes the picker first");
  await page.getByRole("combobox", { name: "Video source" }).press("End");
  await page.getByRole("combobox", { name: "Video source" }).press("Enter");
  await page.waitForFunction(
    () =>
      fake.streams.length === 2 &&
      fake.streams[0].getTracks().every((t) => t.readyState === "ended"),
  );
  assert.equal(
    await page.evaluate(() => fake.constraints.at(-1).video.deviceId.exact),
    "webcam",
  );
  await page.screenshot({ path: ".test-artifacts/camera-panel.png" });
  await page.getByRole("button", { name: "Place camera", exact: true }).click();
  assert.equal(await page.locator(".selection-info").count(), 0, "Selecting a surface does not open automatic controls");
  await feeds();
  assert.ok((await page.locator(".selected-feed").textContent()).includes("Desk webcam"));
  assert.equal(await page.getByRole("button", { name: "Live feeds", exact: true }).locator("span").first().textContent(), "Live feeds");
  await page
    .getByRole("button", { name: "Stop camera", exact: true })
    .waitFor();
  const feed = page.locator(".selected-feed");
  await feed.getByRole("button", { name: "Lock", exact: true }).click();
  assert.equal(await page.locator(".live-feed").filter({ hasText: "Desk webcam" }).getByRole("button", { name: "Crop", exact: true }).isDisabled(), true);
  await page.locator(".live-feed").filter({ hasText: "Desk webcam" }).getByRole("button", { name: "Unlock", exact: true }).click();
  await page.getByRole("button", { name: "Close live feeds" }).click();
  await page.mouse.click(720, 450);
  await feeds();
  assert.equal(
    await page.evaluate(() => fake.streams[1].getVideoTracks()[0].readyState),
    "live",
  );
  await page.locator(".selected-feed").getByRole("button", { name: "Crop", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Left crop percent" }).fill("12");
  await page.getByRole("button", { name: "Apply crop", exact: true }).click();
  await feeds();
  await page.locator(".selected-feed").getByRole("button", { name: "Duplicate", exact: true }).click();
  const manager = await feeds();
  assert.equal(await manager.locator(".live-feed").filter({ hasText: "Desk webcam" }).count(), 1, "Copies share one feed entry");
  assert.ok((await manager.locator(".live-feed").filter({ hasText: "Desk webcam" }).textContent()).includes("2 surfaces"));
  await page.locator(".selected-feed .live-surfaces summary").click();
  await page.locator(".selected-feed .live-surface").first().getByRole("button", { name: "Crop", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Left crop percent" }).fill("24");
  await page.getByRole("button", { name: "Apply crop", exact: true }).click();
  await page.waitForFunction(async () => {
    const request = indexedDB.open("table-goblin", 1);
    const db = await new Promise(resolve => { request.onsuccess = () => resolve(request.result); });
    try {
      const read = db.transaction("tables").objectStore("tables").get("current");
      const record = await new Promise(resolve => { read.onsuccess = () => resolve(read.result); });
      const crops = record?.snapshot.scene.objects.filter(o => o.kind === "camera").map(o => o.crop?.x);
      return crops?.length === 2 && Math.abs(crops[0] - 0.24) < 0.001 && Math.abs(crops[1] - 0.12) < 0.001;
    } finally { db.close(); }
  });
  await feeds();
  await page.locator(".selected-feed .live-surfaces summary").click();
  await page.screenshot({ path: ".test-artifacts/live-feeds.png" });
  await page.locator(".selected-feed .live-surface").last().getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("button", { name: "Close live feeds" }).click();
  assert.equal(
    await page.evaluate(() => fake.streams[1].getVideoTracks()[0].readyState),
    "live",
  );
  // The original camera is at the center; deleting its final instance stops its tracks.
  await page.mouse.click(720, 450);
  await feeds();
  await page.getByRole("button", { name: "Stop camera", exact: true }).click();
  assert.equal(
    await page.evaluate(() => fake.streams[1].getVideoTracks()[0].readyState),
    "ended",
  );
  await page.getByRole("button", { name: "Close live feeds", exact: true }).click();
  await feeds();
  assert.equal(await page.locator(".selected-feed .live-feed-actions button").first().textContent(), "Reconnect");
  await page.locator(".live-feed").filter({ hasText: "Desk webcam" }).getByRole("button", { name: "Reconnect", exact: true }).click();
  await page.getByRole("button", { name: "Enable camera preview", exact: true }).click();
  await page.getByRole("button", { name: "Connect camera", exact: true }).click();
  await feeds();
  await page.getByRole("button", { name: "Change source", exact: true }).waitFor();
  await page.getByRole("button", { name: "Change source", exact: true }).click();
  await page.getByRole("combobox", { name: "Video source" }).click();
  await page.getByRole("option", { name: "Desk webcam", exact: true }).click();
  await page.getByRole("button", { name: "Enable camera preview", exact: true }).click();
  await page.getByRole("button", { name: "Connect camera", exact: true }).click();
  await feeds();
  await page.getByRole("button", { name: "Stop camera", exact: true }).click();
  assert.equal(await page.evaluate(() => fake.streams.at(-2).getTracks()[0].readyState), "ended", "Replacing a feed stops the old stream");
  await camera();
  await page.evaluate(() => (fake.denied = true));
  await page
    .getByRole("button", { name: "Enable camera preview", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Permission was declined" })
    .waitFor();
  await page.getByRole("button", { name: "Close camera panel" }).click();
  await page.evaluate(() => {
    fake.denied = false;
    fake.delay = 250;
  });
  await camera();
  await page
    .getByRole("button", { name: "Enable camera preview", exact: true })
    .click();
  await page.getByRole("button", { name: "Close camera panel" }).click();
  await page.waitForFunction(() =>
    fake.streams
      .at(-1)
      .getTracks()
      .every((t) => t.readyState === "ended"),
  );
  await page.evaluate(() => (fake.delay = 0));
  // The manager remains available with no selection and locates off-screen feeds.
  await page.mouse.click(400, 300);
  const stoppedManager = await feeds();
  await stoppedManager.getByRole("button", { name: "Show Desk webcam on table", exact: true }).click();
  assert.equal(await page.getByRole("dialog", { name: "Live feeds", exact: true }).count(), 0);
  assert.equal(await page.locator(".selection-info").count(), 0);
  await feeds();
  await page.getByRole("button", { name: "Reconnect", exact: true }).last().click();
  await page.getByRole("button", { name: "Enable camera preview", exact: true }).click();
  await page.getByRole("button", { name: "Connect camera", exact: true }).click();
  await feeds();
  await page.getByRole("button", { name: "＋ Screen", exact: true }).click();
  assert.equal(await page.locator(".selection-info").count(), 0);
  await feeds();
  await page.getByRole("button", { name: "Stop all feeds", exact: true }).click();
  assert.equal(await page.locator(".live-count").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Stop all feeds", exact: true }).count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  const smallPanel = await page.getByRole("dialog", { name: "Live feeds", exact: true }).boundingBox();
  assert.ok(smallPanel.x >= 0 && smallPanel.x + smallPanel.width <= 390 && smallPanel.y + smallPanel.height <= 844);
  await page.screenshot({ path: ".test-artifacts/live-feeds-mobile.png" });
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog", { name: "Live feeds", exact: true }).count(), 0);
  await page.setViewportSize({ width: 1440, height: 900 });
  console.log(
    "PASS: no automatic selection panel, grouped feeds with per-surface crop/duplicate, locate, stop all, mobile bounds, reconnect, switching, and cleanup",
  );

  await page
    .getByRole("button", { name: "Audio sources", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Tab \/ computer audio Choose a source/ })
    .click();
  await page.getByRole("meter").waitFor();
  assert.equal(
    await page.getByRole("checkbox", { name: "Listen locally" }).isChecked(),
    false,
  );
  assert.equal(
    await page.evaluate(() => fake.constraints.at(-1).systemAudio),
    "include",
  );
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector('[role="meter"]').getAttribute("aria-valuenow"),
      ) > 0,
  );
  await page
    .getByRole("button", { name: "Mute Virtual audio cable", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector('[role="meter"]').getAttribute("aria-valuenow") ===
      "0",
  );
  assert.equal(
    await page.evaluate(() => fake.streams.at(-1).getAudioTracks()[0].enabled),
    false,
  );
  await page
    .getByRole("button", { name: "Unmute Virtual audio cable", exact: true })
    .click();
  await page
    .getByRole("slider", { name: "Virtual audio cable volume" })
    .fill("0");
  await page.getByRole("checkbox", { name: "Listen locally" }).check(); // Zero volume keeps the test silent.
  await page.getByRole("button", { name: "Close audio panel" }).click();
  assert.equal(await page.locator(".source-count").textContent(), "1");
  assert.equal(
    await page.evaluate(
      () => fake.streams.at(-1).getAudioTracks()[0].readyState,
    ),
    "live",
  );
  await page
    .getByRole("button", { name: "Audio sources", exact: true })
    .click();
  await page.getByRole("combobox", { name: "Audio input" }).click();
  await page.getByRole("option", { name: "Virtual audio cable", exact: true }).click();
  await page
    .getByRole("button", { name: "Connect input", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll('[role="meter"]').length === 2,
  );
  assert.equal(
    await page.evaluate(() => fake.constraints.at(-1).audio.deviceId.exact),
    "cable",
  );
  await page.screenshot({ path: ".test-artifacts/audio-panel.png" });
  await page
    .getByRole("button", { name: "Stop all audio", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() =>
      fake.streams
        .slice(-2)
        .every((s) => s.getTracks().every((t) => t.readyState === "ended")),
    ),
    true,
  );
  await page.evaluate(() => (fake.noAudio = true));
  await page
    .getByRole("button", { name: /Tab \/ computer audio Choose a source/ })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "No audio was shared" })
    .waitFor();
  assert.equal(
    await page.evaluate(() =>
      fake.streams
        .at(-1)
        .getTracks()
        .every((t) => t.readyState === "ended"),
    ),
    true,
  );
  await page.getByRole("button", { name: "Close audio panel" }).click();
  await page.evaluate(() => fake.contexts.forEach((c) => void c.close()));
  console.log(
    "PASS: tab/computer audio hints, input selection, levels, mute, silent-by-default monitoring, persistent sources, and cleanup without audio tracks",
  );

  const pixel = () =>
    page.evaluate(() => {
      const c = document.querySelector(".table-canvas");
      return [...c.getContext("2d").getImageData(50, 250, 1, 1).data];
    });
  const original = await pixel();
  await page.getByRole("button", { name: "Table mood", exact: true }).click();
  await page.getByRole("slider", { name: "Table hue" }).fill("270");
  await page.getByRole("slider", { name: "Table lightness" }).fill("10");
  await page.waitForTimeout(50);
  const chrome = await page
    .locator(".mood-menu")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.ok(
    chrome.includes("rgb(23, 20, 26)") || chrome.includes("rgb(23, 20, 25)"),
    `Chrome should follow mood hue/lightness: ${chrome}`,
  );
  const dark = await pixel();
  assert.notDeepEqual(dark, original);
  assert.ok(dark[0] < original[0]);
  await page.getByRole("button", { name: "Campfire", exact: true }).click();
  await page.getByRole("slider", { name: "Animation strength" }).fill("80");
  await page.screenshot({ path: ".test-artifacts/mood-panel.png" });
  await page.getByRole("button", { name: "Treetops", exact: true }).click();
  await require("./preset-actions.cjs").basicMood(page);
  await page.waitForTimeout(50);
  assert.ok((await pixel()).every((v, i) => Math.abs(v - original[i]) <= 2));
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await page.getByRole("slider", { name: "Pen smoothing" }).fill("85");
  await page.screenshot({ path: ".test-artifacts/smooth-pen.png" });
  await page.getByRole("button", { name: "Select", exact: true }).click();
  console.log(
    "PASS: hue/lightness controls, animation choices, original mood reset, and adjustable pen stabilization",
  );
};

exports.testEngine = async (page) => {
  await installSources(page);
  const live = await page.evaluate(async () => {
    await engine.addScreen();
    const original = engine.scene.objects[0];
    original.name = "Map feed";
    original.rotation = 0.2;
    original.strokes = [{ id: "mark", points: [{ x: 0.1, y: 0.2 }], width: 0.01, color: "#ffffff", highlight: false }];
    engine.saveCrop(original.id, { x: 0.1, y: 0.2, width: 0.8, height: 0.6 });
    engine.duplicate();
    const copy = engine.scene.objects[1];
    engine.saveCrop(copy.id, { x: 0, y: 0, width: 0.5, height: 1 });
    const anchor = engine.add("paper");
    copy.parentId = anchor.id;
    const before = JSON.stringify(engine.scene.objects.map(({ height, sourceWidth, sourceHeight, ...rest }) => rest));
    const old = engine.media.get(original.id);
    fake.denied = true;
    await engine.addScreen(copy.id);
    const cancelKeepsOld = engine.media.get(original.id) === old && old.stream.getVideoTracks()[0].readyState === "live";
    fake.denied = false;
    engine.stopScreen(copy.id);
    const stoppedAll = engine.media.size === 0;
    await engine.addScreen(copy.id);
    const reconnectedAll = engine.media.size === 1 && engine.getSource(original) === engine.getSource(copy);
    const connection = engine.media.get(original.id);
    await engine.addScreen(copy.id);
    connection.stream.getVideoTracks()[0].dispatchEvent(new Event("ended"));
    const replaced = engine.media.get(original.id);
    const staleEventSafe = replaced !== connection && replaced.stream.getVideoTracks()[0].readyState === "live";
    const preserved = before === JSON.stringify(engine.scene.objects.map(({ height, sourceWidth, sourceHeight, ...rest }) => rest));
    replaced.stream.getVideoTracks()[0].dispatchEvent(new Event("ended"));
    const browserEndedKeepsObjects = engine.media.size === 0 && engine.scene.objects.length === 3;
    await engine.addScreen(copy.id);
    // Resize the shared window from landscape to portrait. Fake track settings
    // deliberately remain 640x360; only the actual video frames are reliable.
    const canvas = fake.canvases.at(-1);
    canvas.width = 360; canvas.height = 640;
    window.liveIds = [original.id, copy.id];
    return { cancelKeepsOld, stoppedAll, reconnectedAll, staleEventSafe, preserved, browserEndedKeepsObjects };
  });
  assert.ok(Object.values(live).every(Boolean), JSON.stringify(live));
  await page.waitForFunction(() => liveIds.every(id => engine.scene.objects.find(o => o.id === id).sourceHeight === 640));
  const dimensions = await page.evaluate(async () => {
    const objects = liveIds.map(id => engine.scene.objects.find(o => o.id === id));
    const ratios = objects.map(o => ({ actual: o.width / o.height, expected: 360 * o.crop.width / (640 * o.crop.height) }));
    // Even an intentionally stretched surface displays undistorted frames.
    objects[0].height = 80;
    const ctx = engine.canvas.getContext("2d"), draw = ctx.drawImage;
    let drawn;
    ctx.drawImage = function (...args) {
      if (args[0] === engine.getSource(objects[0])) drawn = args.slice(1);
      return draw.apply(this, args);
    };
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    ctx.drawImage = draw;
    const fitted = Math.abs(drawn[2] / drawn[3] - drawn[6] / drawn[7]) < 1e-8;
    engine.reset(true);
    // A pending connection cannot recreate a surface deleted while it starts.
    const s = await navigator.mediaDevices.getUserMedia({ video: true });
    await engine.addCamera(s, "Camera");
    const id = engine.scene.objects[0].id;
    const next = await navigator.mediaDevices.getUserMedia({ video: true });
    const pending = engine.addCamera(next, "Replacement", id);
    engine.delete();
    let rejected = false;
    try { await pending; } catch { rejected = true; }
    const removedSafe = rejected && engine.scene.objects.length === 0 && next.getTracks().every(t => t.readyState === "ended");
    engine.reset(true);
    const surface = engine.add("paper");
    Object.assign(surface, { x: 1000, y: -700, width: 1600, height: 400, rotation: Math.PI / 2 });
    engine.setTool("pen");
    engine.locate(surface.id);
    const located = engine.selection.has(surface.id) && view.tool === "select" &&
      engine.camera.zoom <= 0.425 && Math.abs(engine.camera.x + 1000 * engine.camera.zoom - 700) < 1e-8 &&
      Math.abs(engine.camera.y - 700 * engine.camera.zoom - 450) < 1e-8;
    engine.reset(true);
    return { ratios, fitted, removedSafe, located };
  });
  dimensions.ratios.forEach(r => assert.ok(Math.abs(r.actual - r.expected) < 1e-8));
  assert.equal(dimensions.fitted, true);
  assert.equal(dimensions.removedSafe, true);
  assert.equal(dimensions.located, true, "Find-on-table fits rotated surfaces and returns to selection mode");
  console.log("PASS: live reconnect/replace across cropped copies, cancellation, stale ended events, deleted targets, changing frame dimensions, and undistorted rendering");
  const result = await page.evaluate(async () => {
    const s = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false,
    });
    await engine.addCamera(s, "OBS");
    const o = engine.scene.objects[0];
    engine.duplicate();
    engine.selection = new Set([o.id]);
    engine.delete();
    const stays = s.getVideoTracks()[0].readyState;
    engine.selection = new Set([engine.scene.objects[0].id]);
    engine.delete();
    const stopped = s.getVideoTracks()[0].readyState;
    await engine.addInputAudio("cable");
    const a = fake.streams.at(-1),
      id = engine.audio.list()[0].id;
    const startsSilent = engine.audio.list()[0].monitor === false;
    engine.audio.set(id, { muted: true });
    const muted = !a.getAudioTracks()[0].enabled;
    a.getAudioTracks()[0].dispatchEvent(new Event("ended"));
    const endedRemoved = engine.audio.count === 0;
    await engine.addDisplayAudio();
    const display = fake.streams.at(-1);
    // Disposing the table owns and stops retained display-video and audio tracks.
    engine.audio.clear();
    const cleaned = display.getTracks().every((t) => t.readyState === "ended");
    await Promise.all(fake.contexts.map((c) => c.close()));
    engine.reset(true);
    return { stays, stopped, startsSilent, muted, endedRemoved, cleaned };
  });
  assert.deepEqual(result, {
    stays: "live",
    stopped: "ended",
    startsSilent: true,
    muted: true,
    endedRemoved: true,
    cleaned: true,
  });
  // Probe the background at two known times without altering ink or objects.
  const moods = await page.evaluate(() => {
    const paint = (motion, now) => {
      const original = performance.now.bind(performance);
      performance.now = () => now;
      engine.renderer.render(
        engine.scene,
        engine.camera,
        new Set(),
        null,
        new Set(),
        engine.media,
        [],
        null,
        null,
        true,
        {
          ...engine.mood,
          hue: 144,
          lightness: 17,
          motion,
          amount: 1,
          speed: 1,
        },
      );
      performance.now = original;
      const c = engine.canvas;
      return [...c.getContext("2d").getImageData(500, 700, 1, 1).data];
    };
    return {
      still: [paint("still", 0), paint("still", 5000)],
      fire: [paint("campfire", 0), paint("campfire", 5000)],
      trees: [paint("canopy", 0), paint("canopy", 5000)],
    };
  });
  assert.deepEqual(moods.still[0], moods.still[1]);
  assert.notDeepEqual(moods.fire[0], moods.fire[1]);
  assert.notDeepEqual(moods.trees[0], moods.trees[1]);
  await page.evaluate(() => {
    engine.reset(true);
    engine.setSmoothing(0);
    engine.setTool("pen");
  });
  await page.mouse.move(120, 220);
  await page.mouse.down();
  await page.mouse.move(320, 220, { steps: 2 });
  await page.mouse.up();
  const stroke = await page.evaluate(() => ({
    points: engine.scene.strokes[0].points,
    camera: engine.camera,
  }));
  assert.ok(
    stroke.points.length > 280 && stroke.points.length < 300,
    `Uniform sampling without duplicated raw/coalesced input: ${stroke.points.length}`,
  );
  const end = stroke.points.at(-1);
  assert.ok(
    Math.abs(end.x - (320 - stroke.camera.x) / stroke.camera.zoom) < 1e-8,
  );
  assert.ok(
    Math.abs(end.y - (220 - stroke.camera.y) / stroke.camera.zoom) < 1e-8,
  );
  await page.evaluate(() => {
    engine.reset(true);
    engine.setSmoothing(0.55);
    engine.setTool("select");
  });
  console.log(
    "PASS: camera lifetime across copies, audio ended-track cleanup, and time-dependent campfire/treetop lighting",
  );
};
