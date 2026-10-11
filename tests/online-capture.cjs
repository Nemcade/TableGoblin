const assert = require('node:assert/strict');

module.exports = async ({ gm, player, wait }) => {
  const paired = await gm.evaluate(async () => {
    window.captureCalls = 0; window.includeCaptureSound = true;
    window.displayCaptures = [];
    window.pickDisplay = async options => {
      captureCalls++;
      const stream = capture(240, 135);
      if (options.audio && includeCaptureSound) {
        const destination = ac.createMediaStreamDestination(), tone = ac.createOscillator();
        tone.connect(destination); tone.start(); stream.addTrack(destination.stream.getAudioTracks()[0]);
      }
      displayCaptures.push(stream); return stream;
    };
    navigator.mediaDevices.getDisplayMedia = pickDisplay;
    await engine.addScreen();
    const screen = engine.scene.objects.at(-1).id;
    return { screen, audio: engine.audio.list().find(s => s.displaySourceId === screen).id };
  });
  const picture = () => wait(player, id => engine.media.get(id)?.video.videoWidth === 240 && engine.roomLive.status(id) === 'Live', paired.screen);
  const sound = async () => {
    const id = await gm.evaluate(() => engine.audio.list()[0]?.id);
    assert.ok(id, 'A local audio source exists');
    await wait(player, id => engine.roomLive.remoteAudio().some(s => s.source === id && s.status === 'Live'), id);
  };
  const silent = () => wait(player, () => !engine.roomLive.remoteAudio().length);
  await picture(); await sound();
  assert.equal(await gm.evaluate(() => captureCalls), 1, 'One browser capture supplies both picture and sound');
  assert.equal(await player.evaluate(id => engine.media.get(id).stream.getAudioTracks().length, paired.screen), 0, 'Screen transport does not bypass the personal sound gate');
  assert.equal(await player.evaluate(id => {
    const source = engine.roomLive.sources.find(s => s.source === id);
    return engine.roomLive.peers.get(`${id}:${source.browser}`).media.stream.getVideoTracks().length;
  }, paired.audio), 0, 'Sound transport does not transmit an extra video');
  await player.evaluate(id => {
    const source = engine.roomLive.sources.find(s => s.source === id);
    const stream = engine.roomLive.peers.get(`${id}:${source.browser}`).media.stream;
    window.screenMeter = receiverAudio.createAnalyser(); receiverAudio.createMediaStreamSource(stream).connect(screenMeter);
  }, paired.audio);
  await wait(player, () => { const data = new Uint8Array(screenMeter.fftSize); screenMeter.getByteTimeDomainData(data); return data.some(v => Math.abs(v - 128) > 10); });
  await gm.evaluate(id => engine.audio.set(id, { muted: true }), paired.audio);
  assert.deepEqual(await gm.evaluate(() => displayCaptures[0].getTracks().map(t => [t.kind, t.enabled, t.readyState]).sort()), [['audio', false, 'live'], ['video', true, 'live']]);
  await gm.evaluate(id => engine.audio.set(id, { muted: false }), paired.audio);

  const copy = await gm.evaluate(id => { engine.duplicate(new Set([id])); return engine.scene.objects.at(-1).id; }, paired.screen);
  await wait(player, id => engine.scene.objects.some(o => o.id === id), copy);
  await gm.evaluate(id => engine.delete(new Set([id])), paired.screen);
  await wait(player, id => !engine.scene.objects.some(o => o.id === id), paired.screen);
  await picture(); await sound();
  assert.equal(await gm.evaluate(() => captureCalls), 1, 'Copies reuse the same capture and sound');

  await gm.evaluate(async id => {
    navigator.mediaDevices.getDisplayMedia = async () => { throw new DOMException('Cancelled', 'NotAllowedError'); };
    await engine.addScreen(id); navigator.mediaDevices.getDisplayMedia = pickDisplay;
  }, copy);
  assert.equal(await gm.evaluate(id => engine.audio.list().some(s => s.id === id), paired.audio), true, 'Cancelling a replacement keeps the current sound');
  assert.equal(await gm.evaluate(() => displayCaptures[0].getTracks().every(t => t.readyState === 'live')), true);
  await gm.evaluate(id => engine.audio.stop(id), paired.audio); await silent(); await picture();
  assert.deepEqual(await gm.evaluate(() => displayCaptures[0].getTracks().map(t => [t.kind, t.readyState]).sort()), [['audio', 'ended'], ['video', 'live']], 'Stopping sound keeps the original picture capture');

  await gm.evaluate(async id => {
    engine.scene.objects.find(o => o.id === id).crop = { x: .1, y: .1, width: .7, height: .7 };
    await engine.addScreen(id);
  }, copy);
  await sound(); await picture();
  assert.equal(await gm.evaluate(() => displayCaptures[0].getVideoTracks()[0].readyState), 'ended');
  assert.equal(await gm.evaluate(id => engine.scene.objects.find(o => o.id === id).crop.x, copy), .1);
  await gm.evaluate(() => { const track = displayCaptures[1].getAudioTracks()[0]; track.stop(); track.dispatchEvent(new Event('ended')); });
  await silent(); await picture();
  assert.equal(await gm.evaluate(() => displayCaptures[1].getVideoTracks()[0].readyState), 'live', 'Ending only audio leaves video connected');

  await gm.evaluate(async id => { await engine.addScreen(id); }, copy); await sound();
  await gm.evaluate(() => { const track = displayCaptures[2].getVideoTracks()[0]; track.stop(); track.dispatchEvent(new Event('ended')); });
  await wait(player, id => !engine.media.has(id), paired.screen); await silent();
  assert.equal(await gm.evaluate(() => displayCaptures[2].getTracks().every(t => t.readyState === 'ended')), true, 'Browser stop releases both parts');

  await gm.evaluate(async id => { await engine.addScreen(id); }, copy); await picture(); await sound();
  await gm.evaluate(id => engine.delete(new Set([id])), copy);
  await wait(player, id => !engine.media.has(id), paired.screen); await silent();
  assert.equal(await gm.evaluate(() => displayCaptures[3].getTracks().every(t => t.readyState === 'ended')), true, 'Last surface deletion releases sound too');

  const videoOnly = await gm.evaluate(async () => { includeCaptureSound = false; await engine.addScreen(); return engine.scene.objects.at(-1).id; });
  await wait(player, id => engine.media.get(id)?.video.videoWidth === 240, videoOnly);
  assert.equal(await gm.evaluate(() => engine.audio.count), 0, 'A picker without audio still places a usable screen');
  await gm.evaluate(id => engine.stopScreen(id), videoOnly); await wait(player, id => !engine.media.has(id), videoOnly);
  await gm.evaluate(id => engine.delete(new Set([id])), videoOnly);

  const audioOnly = await gm.evaluate(async () => { includeCaptureSound = true; await engine.addDisplayAudio(); return engine.audio.list()[0].id; });
  await sound(); await gm.evaluate(id => engine.audio.stop(id), audioOnly); await silent();
  assert.equal(await gm.evaluate(() => displayCaptures.at(-1).getVideoTracks()[0].readyState), 'ended', 'Standalone audio still releases its picker-required video');
  console.log('Combined screen capture: real picture/sound, one picker, separate mute/stop, copies, cancellation, replacement, native end, deletion and video/audio-only paths passed.');
};
