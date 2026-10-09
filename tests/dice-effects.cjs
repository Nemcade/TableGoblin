const assert = require("node:assert/strict");
exports.testEngine = async (page) => {
  const report = await page.evaluate(async () => {
    const Sound = engine.dice.sound.constructor;
    const prepared = new Sound();
    prepared.prepare();
    const buffers = prepared.buffers;
    const bufferPeaks = buffers.map((buffer) =>
      Math.max(...buffer.getChannelData(0).map(Math.abs)),
    );
    const render = async (strength, pan, muted = false) => {
      const ctx = new OfflineAudioContext(2, 9600, 48000),
        sound = new Sound();
      sound.buffers = buffers;
      sound.context = {
        state: "running",
        currentTime: 0,
        createBufferSource: ctx.createBufferSource.bind(ctx),
        createGain: ctx.createGain.bind(ctx),
        createStereoPanner: ctx.createStereoPanner.bind(ctx),
      };
      sound.master = ctx.createGain();
      sound.master.gain.value = 0.35;
      sound.master.connect(ctx.destination);
      if (muted) sound.setEnabled(false);
      const original = Math.random;
      Math.random = () => 0.5;
      try {
        sound.play({ time: 0, strength, die: 0, x: 0, kind: "table" }, pan);
      } finally {
        Math.random = original;
      }
      const voices = sound.voices.size;
      const buffer = await ctx.startRendering();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const energy = [0, 1].map((channel) =>
        buffer.getChannelData(channel).reduce((sum, v) => sum + v * v, 0),
      );
      const peak = Math.max(
        ...buffer.getChannelData(0).map(Math.abs),
        ...buffer.getChannelData(1).map(Math.abs),
      );
      return { voices, remaining: sound.voices.size, energy, peak };
    };
    const strong = await render(8, 0.65),
      soft = await render(1, 0.65),
      muted = await render(8, 0, true);
    prepared.dispose();
    return {
      bufferPeaks,
      strong,
      soft,
      muted,
      released: prepared.context === null,
    };
  });
  assert.equal(report.bufferPeaks.length, 8);
  assert.ok(report.bufferPeaks.every((n) => n > 0 && n < 1));
  assert.ok(new Set(report.bufferPeaks.map((n) => n.toFixed(4))).size > 1);
  assert.equal(report.strong.voices, 1);
  assert.equal(report.strong.remaining, 0);
  assert.ok(report.strong.peak > 0 && report.strong.peak < 1);
  assert.ok(
    report.strong.energy[1] > report.strong.energy[0] * 2,
    "Contacts follow stereo position",
  );
  assert.ok(
    report.strong.energy[1] > report.soft.energy[1] * 10,
    "Stronger collisions are louder",
  );
  assert.equal(report.muted.voices, 0);
  assert.equal(report.muted.peak, 0);
  assert.ok(report.released);
  console.log(
    "PASS: varied dice contact waveforms, strength-dependent volume, stereo position, mute, ended-voice cleanup and audio release",
  );
};
