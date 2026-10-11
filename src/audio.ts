export type AudioSourceState = {
  id: string;
  name: string;
  kind: "display" | "input";
  monitor: boolean;
  muted: boolean;
  volume: number;
  level: number;
};
type Source = AudioSourceState & {
  stream: MediaStream;
  node: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  gain: GainNode;
  buffer: Uint8Array<ArrayBuffer>;
};
/** Captures are session resources, deliberately kept out of scene undo/redo. */
export class TableAudio {
  private context: AudioContext | null = null;
  private sources = new Map<string, Source>();
  constructor(private changed: () => void) {}
  get count() {
    return this.sources.size;
  }
  stream(id: string) { return this.sources.get(id)?.stream; }
  prepare() {
    this.context ??= new AudioContext();
    void this.context.resume().catch(() => {});
    return this.context;
  }
  add(stream: MediaStream, name: string, kind: AudioSourceState["kind"]) {
    if (!stream.getAudioTracks().length)
      throw new Error("The source did not provide an audio track.");
    const ctx = this.prepare(),
      node = ctx.createMediaStreamSource(
        new MediaStream(stream.getAudioTracks()),
      ),
      analyser = ctx.createAnalyser(),
      gain = ctx.createGain();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.75;
    gain.gain.value = 0;
    node.connect(analyser);
    analyser.connect(gain);
    gain.connect(ctx.destination);
    const id = crypto.randomUUID();
    this.sources.set(id, {
      id,
      name,
      kind,
      stream,
      node,
      analyser,
      gain,
      buffer: new Uint8Array(512),
      monitor: false,
      muted: false,
      volume: 0.65,
      level: 0,
    });
    stream
      .getTracks()
      .forEach((track) =>
        track.addEventListener("ended", () => this.stop(id), { once: true }),
      );
    this.changed();
    return id;
  }
  list(): AudioSourceState[] {
    return [...this.sources.values()].map((s) => {
      s.analyser.getByteTimeDomainData(s.buffer);
      const rms = Math.sqrt(
        s.buffer.reduce((sum, v) => sum + Math.pow((v - 128) / 128, 2), 0) /
          s.buffer.length,
      );
      s.level = s.muted ? 0 : Math.min(1, rms * 3);
      return {
        id: s.id,
        name: s.name,
        kind: s.kind,
        monitor: s.monitor,
        muted: s.muted,
        volume: s.volume,
        level: s.level,
      };
    });
  }
  set(
    id: string,
    patch: Partial<Pick<AudioSourceState, "monitor" | "muted" | "volume">>,
  ) {
    const s = this.sources.get(id);
    if (!s) return;
    Object.assign(s, patch);
    s.volume = Math.max(0, Math.min(1, s.volume));
    s.stream.getAudioTracks().forEach((t) => (t.enabled = !s.muted));
    const ctx = this.prepare();
    s.gain.gain.setTargetAtTime(
      s.monitor && !s.muted ? s.volume : 0,
      ctx.currentTime,
      0.025,
    );
    this.changed();
  }
  stop(id: string) {
    const s = this.sources.get(id);
    if (!s) return;
    this.sources.delete(id);
    s.node.disconnect();
    s.analyser.disconnect();
    s.gain.disconnect();
    s.stream.getTracks().forEach((t) => t.stop());
    this.changed();
  }
  clear() {
    [...this.sources.keys()].forEach((id) => this.stop(id));
  }
  dispose() {
    this.clear();
    void this.context?.close();
    this.context = null;
  }
}
