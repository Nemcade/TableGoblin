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
    // Restore the harness publisher for subsequent permission/cleanup checks.
    await gmUI.getByRole('button', { name: 'Close audio panel', exact: true }).click();
    await gmUI.getByRole('button', { name: 'Live feeds', exact: true }).click(); await gmUI.getByRole('button', { name: 'Stop camera', exact: true }).click();
    await wait(player, id => !engine.media.has(id), source);
    await gm.evaluate(async id => { window.reconnected = capture(); await engine.addCamera(reconnected, 'Reconnected', id); }, source);
    await wait(player, id => engine.media.get(id)?.video.videoWidth === 160, source);
    console.log('Production live controls: ownership feedback, stop/reconnect, camera preview, shared audio and personal listening passed.');
  } finally { await gmUI.close(); await playerUI.close(); }
};
