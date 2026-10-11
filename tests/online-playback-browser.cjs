const assert = require("node:assert/strict");
module.exports = async ({ gm, player, gmUI, playerUI, audioId, root, wait }) => {
  // An SSE acknowledgement unlocks controls before its delayed HTTP response.
  let seen = false, release;
  await gm.route("**/playback", async route => {
    if (seen) return route.continue(); seen = true;
    const response = await route.fetch(); await new Promise(resolve => release = resolve); await route.fulfill({ response });
  });
  await gm.evaluate(id => engine.restartAudio(id), audioId);
  await wait(gm, () => client.playPosting && !client.playFlight);
  await gm.evaluate(id => engine.togglePlayback(id), audioId);
  assert.ok(await gm.evaluate(() => !!client.playFlight), "The next command waits behind the acknowledged HTTP request");
  release();
  await wait(gm, () => !client.playFlight && !client.playPosting);
  await wait(player, id => engine.renderer.audios.get(id).audio.paused, audioId);
  await gm.unroute("**/playback");
  // A disconnected response and missing event retry the same saved command.
  await gm.route("**/playback", async route => { await route.fetch(); await route.abort(); });
  await gm.evaluate(id => { client.source.close(); engine.restartAudio(id); }, audioId);
  await wait(gm, () => status === "offline");
  const sequence = await player.evaluate(() => client.state.playback.sequence);
  await gm.unroute("**/playback"); await gm.evaluate(() => client.reconnect());
  await wait(gm, () => status === "connected" && !client.playFlight);
  assert.equal(await gm.evaluate(() => client.state.playback.sequence), sequence, "A lost reply never repeats restart");
  // Complete the test with a fresh SSE connection; reconnect GET also catches up.
  await gm.evaluate(async root => {
    client.close(); const state = await (await fetch(root + "/state")).json();
    window.client = new GoblinMediaTest.RoomClient(engine, state, (_, next) => window.status = next, text => notices.push(text));
  }, root);
  await wait(gm, () => status === "connected");
  await gm.evaluate(id => engine.togglePlayback(id), audioId);
  await wait(player, id => engine.renderer.audios.get(id).audio.paused, audioId);
  // Browser sound rejection stays personal; a deliberate retry catches up.
  await player.evaluate(id => {
    const element = engine.renderer.audios.get(id).audio; window.nativePlay = element.play.bind(element);
    element.play = () => Promise.reject(new DOMException("Gesture required", "NotAllowedError"));
    engine.setRoomFileMuted(engine.scene.objects.find(o => o.id === id), false);
  }, audioId);
  await gm.evaluate(id => engine.restartAudio(id), audioId);
  await wait(player, () => engine.roomSoundNeeded);
  assert.equal(await gm.evaluate(id => engine.roomFilePosition(engine.scene.objects.find(o => o.id === id)).playing, audioId), true);
  await player.evaluate(id => { engine.renderer.audios.get(id).audio.play = nativePlay; engine.enableRoomSound(); }, audioId);
  await wait(player, id => !engine.renderer.audios.get(id).audio.paused && !engine.roomSoundNeeded, audioId);
  const times = await Promise.all([gm, player].map(p => p.evaluate(id => engine.renderer.audios.get(id).audio.currentTime, audioId)));
  assert.ok(Math.abs(times[0] - times[1]) < .55);
  // Drift correction recovers a stalled or backgrounded browser without commands.
  await player.evaluate(id => { engine.renderer.audios.get(id).audio.currentTime = 2.8; }, audioId);
  await wait(player, id => Math.abs(engine.renderer.audios.get(id).audio.currentTime - engine.roomFilePosition(engine.scene.objects.find(o => o.id === id)).position) < .45, audioId);
  // Seeking previews locally, then sends exactly one room command on release.
  await gmUI.getByRole("button", { name: "Pause Campfire.wav", exact: true }).click();
  await wait(player, id => engine.renderer.audios.get(id).audio.paused, audioId);
  const seek = gmUI.getByRole("slider", { name: "Seek Campfire.wav for room", exact: true });
  const before = await gm.evaluate(() => client.state.playback.sequence);
  await seek.fill("0.8"); assert.equal(await gm.evaluate(() => client.state.playback.sequence), before);
  await seek.dispatchEvent("pointerup");
  await wait(player, id => Math.abs(engine.renderer.audios.get(id).audio.currentTime - .8) < .1, audioId);
  assert.equal(await gm.evaluate(() => client.state.playback.sequence), before + 1);
  // A non-looping clip ends naturally in both browsers and Play starts it again.
  await gm.evaluate(id => engine.setFileAudio(id, { loop: false }), audioId); await wait(gm, () => !client.playFlight);
  await gm.evaluate(id => engine.seekRoomFile(engine.scene.objects.find(o => o.id === id), 3.8), audioId); await wait(gm, () => !client.playFlight);
  await gm.evaluate(id => engine.togglePlayback(id), audioId);
  await wait(player, id => engine.roomFilePosition(engine.scene.objects.find(o => o.id === id))?.playing, audioId);
  await wait(player, id => !engine.roomFilePosition(engine.scene.objects.find(o => o.id === id))?.playing, audioId);
  await gm.evaluate(id => engine.togglePlayback(id), audioId);
  await wait(player, id => !engine.renderer.audios.get(id).audio.paused && engine.renderer.audios.get(id).audio.currentTime < 1, audioId);
  await gm.evaluate(id => engine.togglePlayback(id), audioId); await wait(player, id => engine.renderer.audios.get(id).audio.paused, audioId);
  await playerUI.getByRole("button", { name: "Play Campfire.wav", exact: true }).waitFor();
  console.log("PASS: delayed playback responses, lost-reply deduplication, reconnect anchors, autoplay rejection/retry, drift correction, one-command seek and non-looping end/replay");
};
