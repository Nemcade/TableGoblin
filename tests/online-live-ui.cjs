const assert = require('node:assert/strict');
module.exports = async ({ contexts, base, room, gm, player, source, wait, errors }) => {
  const gmUI = await contexts[0].newPage(), playerUI = await contexts[1].newPage();
  for (const page of [gmUI, playerUI]) {
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async options => {
        if (options.video) {
          const c = document.createElement('canvas'); c.width = 320; c.height = 180; const ctx = c.getContext('2d');
          const draw = () => { ctx.fillStyle = '#119944'; ctx.fillRect(0, 0, 320, 180); }; draw(); setInterval(draw, 40); return c.captureStream(25);
        }
        const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination(); await ac.resume(); o.connect(d); o.start(); return d.stream;
      };
      navigator.mediaDevices.enumerateDevices = async () => [];
      window.uiDisplayCaptures = [];
      navigator.mediaDevices.getDisplayMedia = async options => {
        const canvas = document.createElement('canvas'); canvas.width = 260; canvas.height = 145;
        const context = canvas.getContext('2d'); const draw = () => { context.fillStyle = '#6699dd'; context.fillRect(0, 0, 260, 145); };
        draw(); setInterval(draw, 40); const stream = canvas.captureStream(25);
        Object.defineProperty(stream.getVideoTracks()[0], 'label', { value: 'Combined UI screen' });
        if (options.audio) {
          const ac = new AudioContext(), tone = ac.createOscillator(), destination = ac.createMediaStreamDestination();
          await ac.resume(); tone.connect(destination); tone.start(); stream.addTrack(destination.stream.getAudioTracks()[0]);
        }
        uiDisplayCaptures.push(stream); return stream;
      };
    });
    await page.goto(`${base}/#room=${room.id}`);
    await page.getByLabel('Room connection status').filter({ hasText: 'ROOM CONNECTED' }).waitFor();
    const close = page.getByRole('button', { name: 'Close room controls', exact: true }); if (await close.isVisible()) await close.click();
  }
  try {
    await playerUI.getByRole('button', { name: 'Live feeds', exact: true }).click();
    assert.equal(await playerUI.getByRole('button', { name: 'Change source', exact: true }).count(), 0);
    await playerUI.getByRole('button', { name: 'Retry connection', exact: true }).click();
    await playerUI.getByRole('button', { name: 'Close live feeds', exact: true }).click();
    await gmUI.getByRole('button', { name: 'Live feeds', exact: true }).click();
    await gmUI.getByRole('button', { name: 'Stop camera', exact: true }).click();
    await wait(gm, id => !engine.media.has(id), source);
    await gmUI.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await gmUI.getByRole('button', { name: 'Enable camera preview', exact: true }).click();
    await gmUI.getByRole('button', { name: 'Connect camera', exact: true }).click();
    await wait(player, id => engine.media.get(id)?.video.videoWidth === 320, source);
    await gmUI.getByRole('button', { name: 'Live feeds', exact: true }).click();
    await gmUI.getByRole('button', { name: 'Change source', exact: true }).waitFor();
    await gmUI.screenshot({ path: '.test-artifacts/online-live-feeds.png' });
    await gmUI.reload();
    await gmUI.getByLabel('Room connection status').filter({ hasText: 'ROOM CONNECTED' }).waitFor();
    await wait(player, id => !engine.media.has(id), source);
    const close = gmUI.getByRole('button', { name: 'Close room controls', exact: true }); if (await close.isVisible()) await close.click();
    await gmUI.getByRole('button', { name: 'Live feeds', exact: true }).click();
    await gmUI.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await gmUI.getByRole('button', { name: 'Enable camera preview', exact: true }).click();
    await gmUI.getByRole('button', { name: 'Connect camera', exact: true }).click();
    await wait(player, id => engine.media.get(id)?.video.videoWidth === 320, source);
    await gmUI.getByRole('button', { name: 'Live feeds', exact: true }).click();
    await gmUI.getByRole('button', { name: 'Close live feeds', exact: true }).click();
    await gmUI.getByRole('button', { name: 'Audio sources', exact: true }).click();
    await gmUI.getByRole('button', { name: 'Connect input', exact: true }).click();
    await playerUI.getByRole('button', { name: 'Audio sources', exact: true }).click();
    const audio = playerUI.getByRole('region', { name: 'Shared live audio', exact: true }); await audio.waitFor();
    await playerUI.getByRole('button', { name: 'Enable room sound', exact: true }).click();
    await audio.getByRole('slider').fill('30'); await audio.getByRole('button', { name: /^Mute .* for me$/ }).click();
    await playerUI.screenshot({ path: '.test-artifacts/online-live-audio.png' });
    await gmUI.locator('.audio-source').getByRole('button', { name: /^Stop / }).click(); await audio.waitFor({ state: 'hidden' });
    await gmUI.getByRole('button', { name: 'Close audio panel', exact: true }).click();
    await gmUI.getByRole('button', { name: 'Add', exact: true }).click();
    await gmUI.getByRole('button', { name: /^Live screen / }).click();
    await wait(gm, () => engine.scene.objects.some(o => o.kind === 'screen'));
    const screen = await gm.evaluate(() => engine.scene.objects.find(o => o.kind === 'screen').id);
    await wait(player, id => engine.media.get(id)?.video.videoWidth === 260, screen);
    await wait(player, () => engine.roomLive.remoteAudio().some(s => s.status === 'Live'));
    await gmUI.getByRole('button', { name: 'Live feeds', exact: true }).click();
    await gmUI.getByRole('button', { name: /^Mute screen sound for / }).click();
    assert.deepEqual(await gmUI.evaluate(() => uiDisplayCaptures[0].getTracks().map(t => [t.kind, t.enabled, t.readyState]).sort()), [['audio', false, 'live'], ['video', true, 'live']]);
    await gmUI.getByRole('button', { name: /^Unmute screen sound for / }).click();
    await gmUI.getByRole('button', { name: 'Stop sound', exact: true }).click();
    await wait(player, () => !engine.roomLive.remoteAudio().length);
    assert.equal(await gmUI.evaluate(() => uiDisplayCaptures[0].getVideoTracks()[0].readyState), 'live');
    const screenFeed = gmUI.locator('.live-feed').filter({ has: gmUI.getByRole('button', { name: 'Stop sharing', exact: true }) });
    await screenFeed.getByRole('button', { name: 'Change source', exact: true }).click();
    await wait(player, () => engine.roomLive.remoteAudio().some(s => s.status === 'Live'));
    assert.equal(await gmUI.evaluate(() => uiDisplayCaptures.length), 2);
    assert.equal(await gmUI.evaluate(() => uiDisplayCaptures[0].getTracks().every(t => t.readyState === 'ended')), true);
    await gmUI.getByRole('button', { name: 'Live feeds', exact: true }).click();
    await gmUI.getByRole('button', { name: 'Stop sound', exact: true }).waitFor();
    await gmUI.screenshot({ path: '.test-artifacts/online-combined-capture.png' });
    await gmUI.getByRole('button', { name: 'Close live feeds', exact: true }).click();
    await gmUI.getByRole('button', { name: 'Audio sources', exact: true }).click();
    await gmUI.getByText('Screen sound · same capture as picture', { exact: false }).waitFor();
    await gmUI.getByRole('button', { name: 'Stop Combined UI screen · sound', exact: true }).waitFor();
    await gmUI.screenshot({ path: '.test-artifacts/online-combined-audio.png' });
    await gmUI.getByRole('button', { name: 'Close audio panel', exact: true }).click();
    await gmUI.getByRole('button', { name: 'Live feeds', exact: true }).click();
    await gmUI.setViewportSize({ width: 390, height: 844 });
    await gmUI.screenshot({ path: '.test-artifacts/online-combined-capture-mobile.png' });
    const bounds = await gmUI.getByRole('dialog', { name: 'Live feeds', exact: true }).boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390, 'Combined controls fit a narrow screen');
    await screenFeed.getByRole('button', { name: 'Stop sharing', exact: true }).click();
    await wait(player, id => !engine.media.has(id), screen); await wait(player, () => !engine.roomLive.remoteAudio().length);
    assert.equal(await gmUI.evaluate(() => uiDisplayCaptures[1].getTracks().every(t => t.readyState === 'ended')), true);
    await gmUI.locator('.live-feed').filter({ has: gmUI.getByRole('button', { name: 'Show Combined UI screen on table', exact: true }) }).getByRole('button', { name: 'Remove', exact: true }).click();
    await gmUI.setViewportSize({ width: 1280, height: 720 });
    await gmUI.getByRole('button', { name: 'Close live feeds', exact: true }).click();
    // Restore the harness publisher for subsequent permission/cleanup checks.
    await gmUI.getByRole('button', { name: 'Live feeds', exact: true }).click(); await gmUI.getByRole('button', { name: 'Stop camera', exact: true }).click();
    await wait(player, id => !engine.media.has(id), source);
    await gm.evaluate(async id => { window.reconnected = capture(); await engine.addCamera(reconnected, 'Reconnected', id); }, source);
    await wait(player, id => engine.media.get(id)?.video.videoWidth === 160, source);
    console.log('Production live controls: ownership feedback, stop/reconnect, camera preview, combined screen sound, independent sound controls, mobile layout, shared audio and personal listening passed.');
  } finally { await gmUI.close(); await playerUI.close(); }
};
