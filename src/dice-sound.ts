import type { DiceImpact } from "./dice-physics.ts";

/** Short, varied contact sounds generated locally; no audio files or network requests. */
export class DiceSound {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers: AudioBuffer[] = [];
  private voices = new Set<AudioBufferSourceNode>();
  private enabled = true;
  private disposed = false;
  prepare() {
    if (!this.enabled || this.disposed || typeof AudioContext === "undefined")
      return;
    try {
      if (!this.context || this.context.state === "closed") {
        const ctx = (this.context = new AudioContext());
        this.master = ctx.createGain();
        this.master.gain.value = 0.35;
        this.master.connect(ctx.destination);
        this.buffers = Array.from({ length: 8 }, () => {
          const buffer = ctx.createBuffer(
            1,
            Math.ceil(ctx.sampleRate * 0.11),
            ctx.sampleRate,
          );
          const data = buffer.getChannelData(0),
            pitch = 0.85 + Math.random() * 0.3;
          let filtered = 0;
          for (let i = 0; i < data.length; i++) {
            const t = i / ctx.sampleRate;
            filtered += (Math.random() * 2 - 1 - filtered) * 0.45;
            const noise = filtered * 0.75 * Math.exp(-t / 0.006);
            const body =
              Math.sin(2 * Math.PI * 230 * pitch * t) *
              0.16 *
              Math.exp(-t / 0.027);
            const click =
              Math.sin(2 * Math.PI * 790 * pitch * t) *
                0.22 *
                Math.exp(-t / 0.013) +
              Math.sin(2 * Math.PI * 1770 * pitch * t) *
                0.12 *
                Math.exp(-t / 0.008);
            data[i] = Math.min(1, t / 0.0006) * (noise + body + click);
          }
          return buffer;
        });
      }
      void this.context.resume().catch(() => {});
    } catch {
      this.release();
    }
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.stop();
    if (this.master && this.context)
      this.master.gain.setValueAtTime(
        enabled ? 0.35 : 0,
        this.context.currentTime,
      );
  }
  play(impact: DiceImpact, pan: number) {
    const ctx = this.context;
    if (
      !this.enabled ||
      !ctx ||
      ctx.state !== "running" ||
      !this.master ||
      this.voices.size >= 16
    )
      return;
    const source = ctx.createBufferSource(),
      gain = ctx.createGain(),
      stereo = ctx.createStereoPanner();
    source.buffer =
      this.buffers[Math.floor(Math.random() * this.buffers.length)];
    source.playbackRate.value =
      (0.94 + Math.random() * 0.12) * (impact.kind === "dice" ? 1.2 : 1);
    gain.gain.value = Math.min(0.85, Math.pow(impact.strength / 8, 0.65));
    stereo.pan.value = Math.max(-0.75, Math.min(0.75, pan));
    source.connect(gain);
    gain.connect(stereo);
    stereo.connect(this.master);
    this.voices.add(source);
    source.onended = () => {
      this.voices.delete(source);
      source.disconnect();
      gain.disconnect();
      stereo.disconnect();
    };
    source.start();
  }
  stop() {
    for (const voice of this.voices) {
      try {
        voice.stop();
      } catch {}
    }
    this.voices.clear();
  }
  release() {
    this.stop();
    const ctx = this.context;
    this.context = null;
    this.master = null;
    this.buffers = [];
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
  }
  dispose() {
    this.disposed = true;
    this.release();
  }
}
