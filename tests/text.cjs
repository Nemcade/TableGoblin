const assert = require("node:assert/strict");
const fs = require("node:fs");

exports.testUI = async existingPage => {
  const context = await existingPage.context().browser().newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage(), errors = [], external = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (["127.0.0.1", "localhost"].includes(url.hostname)) return route.continue();
    external.push(url.href); return route.abort();
  });
  await page.addInitScript(() => {
    window.textPaints = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      if (String(text).includes("bridge") || String(text).includes("Watch")) window.textPaints.push({ text, color: this.fillStyle, font: this.font, glow: this.shadowBlur });
      return original.call(this, text, ...args);
    };
  });
  try {
    await page.goto(new URL("/", existingPage.url()).href);
    const saved = () => page.getByLabel("Local table save status").filter({ hasText: "SAVED LOCALLY" }).waitFor({ state: "attached" });
    const stored = () => page.evaluate(async () => {
      const request = indexedDB.open("table-goblin", 1), db = await new Promise(resolve => { request.onsuccess = () => resolve(request.result); });
      try { const read = db.transaction("tables").objectStore("tables").get("current"); return await new Promise(resolve => { read.onsuccess = () => resolve(read.result); }); } finally { db.close(); }
    });
    const note = async id => (await stored()).snapshot.scene.objects.find(o => id ? o.id === id : o.kind === "text");
    const position = async (id, local = { x: 0, y: 0 }) => {
      const { snapshot } = await stored();
      const world = obj => {
        const parent = snapshot.scene.objects.find(o => o.id === obj.parentId);
        if (!parent) return { x: obj.x, y: obj.y, rotation: obj.rotation, width: obj.width, height: obj.height };
        const p = world(parent), x = obj.x * p.width, y = obj.y * p.height;
        return { x: p.x + x * Math.cos(p.rotation) - y * Math.sin(p.rotation), y: p.y + x * Math.sin(p.rotation) + y * Math.cos(p.rotation), rotation: p.rotation + obj.rotation, width: obj.width, height: obj.height };
      };
      const obj = snapshot.scene.objects.find(o => o.id === id), t = world(obj), x = local.x * t.width, y = local.y * t.height;
      return { x: (t.x + x * Math.cos(t.rotation) - y * Math.sin(t.rotation)) * snapshot.camera.zoom + snapshot.camera.x,
        y: (t.y + x * Math.sin(t.rotation) + y * Math.cos(t.rotation)) * snapshot.camera.zoom + snapshot.camera.y };
    };
    const clickObject = async (id, options = {}) => { const p = await position(id); await page.mouse.click(p.x, p.y, options); };
    const drag = async (a, b) => { await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up(); };
    const addText = async () => { await page.getByRole("button", { name: "Add", exact: true }).click(); await page.getByRole("button", { name: "Text Notes, labels and annotations" }).click(); };
    const input = page.getByRole("textbox", { name: "Text content", exact: true }), tools = page.getByRole("toolbar", { name: "Text tools", exact: true });
    const select = async (start, end) => page.evaluate(({ start, end }) => {
      const el = document.querySelector(".inline-text-input"); el.focus();
      const point = offset => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node;
        while ((node = walker.nextNode())) { if (offset <= node.textContent.length) return [node, offset]; offset -= node.textContent.length; }
        return [el, el.childNodes.length];
      };
      const range = document.createRange(); range.setStart(...point(start)); range.setEnd(...point(end));
      getSelection().removeAllRanges(); getSelection().addRange(range);
    }, { start, end });

    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("button", { name: "Shapes Pick a shape, give it a color" }).click();
    await page.getByRole("button", { name: "Add Rectangle", exact: true }).click();
    await drag({ x: 720, y: 450 }, { x: 500, y: 450 }); await saved();
    const shape = (await stored()).snapshot.scene.objects[0];
    await clickObject(shape.id, { button: "right" });
    const actions = page.getByRole("dialog", { name: "Object actions" });
    await actions.getByRole("button", { name: "Surface color #dfc587", exact: true }).click();
    await actions.getByRole("button", { name: "Close object actions" }).click();
    await addText();
    assert.equal(await page.locator(".text-editor,.text-editor-layer").count(), 0, "No separate heavy editor");
    await input.pressSequentially("Watch the bridge"); await saved();
    let label = await note(); assert.equal(label.text.content, "Watch the bridge", "Text is durable before confirmation or click-away");
    assert.equal(label.text.mode, "label"); assert.equal(label.text.glow, false);
    const width = label.width;
    await select(10, 16); await tools.getByRole("button", { name: "Bold", exact: true }).click();
    await page.keyboard.press("Control+i"); await saved(); label = await note();
    assert.equal(label.text.spans.length, 1); assert.equal(label.text.spans[0].start, 10); assert.equal(label.text.spans[0].end, 16);
    assert.equal(label.text.spans[0].style.bold, true); assert.equal(label.text.spans[0].style.italic, true);
    assert.equal(label.text.bold, false, "Formatting does not bold the whole object");
    await page.keyboard.press("Control+z"); await saved(); assert.equal((await note()).text.spans[0].style.italic, false);
    await page.keyboard.press("Control+Shift+z"); await saved(); assert.equal((await note()).text.spans[0].style.italic, true);
    await select(16, 16); await page.keyboard.press("Shift+Enter"); await input.pressSequentially("Bring a lantern"); await saved();
    assert.equal((await note()).text.content, "Watch the bridge\nBring a lantern"); assert.ok((await note()).width < width * 2, "Label line break does not wrap automatically");
    await page.screenshot({ path: ".test-artifacts/text-inline.png" });
    await page.mouse.click(1000, 630); await saved(); assert.equal(await input.count(), 0);
    label = await note(); assert.equal(label.text.content, "Watch the bridge\nBring a lantern", "Click-away keeps content and marks");
    assert.ok((await page.evaluate(() => window.textPaints)).every(p => p.glow === 0), "No default glow in canvas rendering");
    await page.getByRole("button", { name: "Undo", exact: true }).click(); await saved();
    assert.equal((await stored()).snapshot.scene.objects.length, 1, "One undo removes the complete creation/typing session");
    await page.getByRole("button", { name: "Redo", exact: true }).click(); await saved();
    label = await note();
    await drag(await position(label.id), { x: 500, y: 450 }); await saved(); label = await note();
    assert.equal(label.parentId, shape.id); await page.waitForFunction(() => window.textPaints.some(p => p.color === "#000000"));
    await clickObject(label.id, { clickCount: 2 });
    await tools.getByRole("button", { name: "Choose text font" }).click();
    const fonts = tools.getByRole("group", { name: "Text fonts", exact: true });
    for (const name of ["Meddon", "Cormorant Garamond", "Jim Nightshade", "Special Elite", "Crimson Pro", "Roboto", "Quicksand", "Bebas Neue", "Nunito", "IM Fell English"]) assert.equal(await fonts.getByRole("button", { name, exact: true }).count(), 1);
    await fonts.getByRole("button", { name: "Cormorant Garamond", exact: true }).click();
    await tools.getByRole("button", { name: "Finish text editing" }).click(); await saved();
    await page.evaluate(() => document.fonts.ready); label = await note();
    assert.equal(label.text.font, "cormorant");
    await clickObject(label.id);
    const a = await position(label.id, { x: .5, y: .5 }); await drag(a, { x: a.x + 35, y: a.y + 20 }); await saved();
    assert.ok((await note()).text.size > label.text.size, "Label handles scale type");
    await page.reload(); await saved(); label = await note();
    assert.equal(label.text.spans[0].style.bold, true); assert.equal(label.text.font, "cormorant");

    await addText(); await tools.getByRole("button", { name: "Paragraph text", exact: true }).click();
    await input.fill("A lantern marks the bridge. The river rises after midnight and the path disappears in the mist."); await saved();
    let paragraph = (await stored()).snapshot.scene.objects.filter(o => o.kind === "text").at(-1);
    assert.equal(paragraph.text.mode, "paragraph"); assert.equal(paragraph.width, 300); assert.ok(paragraph.height > 80);
    const paragraphID = paragraph.id;
    await page.keyboard.press("End"); await page.keyboard.press("Enter"); await input.pressSequentially("Return by dawn."); await saved();
    assert.equal(await input.count(), 1, "Paragraph Enter inserts a new line without finishing");
    await page.keyboard.press("Escape"); await saved(); assert.ok((await note(paragraphID)).text.content.endsWith("\nReturn by dawn."), "Escape retains text");
    paragraph = await note(paragraphID); await clickObject(paragraphID);
    const corner = await position(paragraphID, { x: .5, y: .5 });
    await drag(corner, { x: corner.x - 100, y: corner.y + 20 }); await saved();
    const smaller = await note(paragraphID); assert.equal(smaller.text.size, paragraph.text.size); assert.ok(smaller.height > paragraph.height, "Paragraph narrower width increases wrapped height");
    await clickObject(paragraphID, { button: "right" });
    assert.equal(await actions.getByRole("button", { name: "Choose text font" }).count(), 1, "Quick settings live in the right-click menu");
    await actions.getByRole("button", { name: "Edit font size" }).click(); await actions.getByLabel("Font size value").fill("22"); await page.keyboard.press("Enter"); await saved();
    assert.equal((await note(paragraphID)).text.size, 22);
    await actions.getByRole("button", { name: "More text settings", exact: false }).click();
    assert.equal(await actions.getByRole("button", { name: "Text glow Off" }).getAttribute("aria-pressed"), "false");
    await actions.getByRole("button", { name: "Text glow Off" }).click(); await saved(); assert.equal((await note(paragraphID)).text.glow, true);
    await actions.getByRole("button", { name: "Text glow On" }).click();
    await actions.getByLabel("Text color hex").fill("#aa3322"); await page.keyboard.press("Enter"); await saved();
    assert.equal((await note(paragraphID)).text.color, "#aa3322");
    await actions.getByRole("button", { name: "Use automatic text color" }).click();
    await actions.getByRole("button", { name: "Close object actions" }).click();
    await clickObject(paragraphID, { clickCount: 2 });
    await select(0, 9); await page.keyboard.press("Control+b");
    await page.reload(); await saved(); paragraph = await note(paragraphID);
    assert.ok(paragraph.text.spans.some(s => s.start === 0 && s.end === 9 && s.style.bold), "Refresh during editing preserves selected-word formatting");
    // Keep paragraph outside the note, then duplicate the background with its label hierarchy.
    await clickObject(paragraphID); await drag(await position(paragraphID), { x: 900, y: 610 }); await saved();
    await page.mouse.click(375, 450, { button: "right" }); await actions.getByRole("button", { name: "Duplicate selection" }).click(); await saved();
    let data = await stored(); assert.equal(data.snapshot.scene.objects.length, 5);
    const labels = data.snapshot.scene.objects.filter(o => o.kind === "text" && o.text.mode === "label");
    assert.deepEqual(labels[0].text, labels[1].text); assert.notEqual(labels[0].parentId, labels[1].parentId);
    await page.mouse.click(375, 450, { button: "right" }); await actions.getByRole("button", { name: "Close object actions" }).click();
    await page.locator(".table-canvas").focus(); await page.evaluate(() => {
      const data = new DataTransfer(); window.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }));
      window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }); await saved(); assert.equal((await stored()).snapshot.scene.objects.length, 7);
    await page.getByRole("button", { name: "Undo", exact: true }).click(); await saved();
    const beforeExport = (await stored()).snapshot.scene;
    await page.getByRole("button", { name: "Table options", exact: true }).click(); const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export table", exact: true }).click(); const contents = fs.readFileSync(await (await downloaded).path());
    await page.getByRole("button", { name: "Table options", exact: true }).click(); await page.getByRole("button", { name: "Clear table", exact: true }).click(); await saved();
    await page.getByLabel("Import table file").setInputFiles({ name: "notes.goblin.json", mimeType: "application/json", buffer: contents }); await saved();
    assert.deepEqual((await stored()).snapshot.scene, beforeExport);
    await clickObject(paragraphID, { button: "right" }); await actions.getByRole("button", { name: "Lock object", exact: true }).click(); await saved();
    await clickObject(paragraphID, { button: "right" }); assert.equal(await actions.getByRole("button", { name: "Edit text Double-click" }).isDisabled(), true);
    await actions.getByRole("button", { name: "Unlock object", exact: true }).click(); await saved();
    await page.screenshot({ path: ".test-artifacts/text-label-and-paragraph.png" });
    await page.setViewportSize({ width: 390, height: 700 }); await saved();
    await addText(); await input.fill("Small screen");
    const rect = await tools.boundingBox(); assert.ok(rect.x >= 0 && rect.x + rect.width <= 390 && rect.y >= 0 && rect.y + rect.height <= 700, "Inline controls fit a small screen");
    await page.keyboard.press("Enter"); await saved();
    assert.deepEqual(errors, []); assert.deepEqual(external, [], "All fonts work without contacting external servers");
    console.log("PASS: direct text editing, live persistence/click-away/Escape/refresh, selection marks and caret/undo, label line breaks and scaling, paragraph wrapping/height/size, optional glow, offline fonts, compact/right-click tools, nesting/copy/export/import/locking and small screens");
  } finally { await context.close(); }
};
