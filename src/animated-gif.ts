import { parseGIF, decompressFrames, type ParsedFrame } from "gifuct-js";

/** One compositor per surface: keeps GIF disposal and looping out of scene history. */
export class AnimatedGif {
  canvas = document.createElement("canvas");
  private patch = document.createElement("canvas");
  private index = -1;
  private previous: ImageData | null = null;
  private elapsed = 0;
  private last = performance.now();
  private wasPaused = false;
  constructor(
    private frames: ParsedFrame[],
    width: number,
    height: number,
  ) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.advance();
  }
  static async load(url: string) {
    const response = await fetch(url);
    const parsed = parseGIF(await response.arrayBuffer());
    const frames = decompressFrames(parsed, true);
    if (!frames.length) throw new Error("No GIF frames");
    return new AnimatedGif(frames, parsed.lsd.width, parsed.lsd.height);
  }
  tick(paused: boolean) {
    const now = performance.now();
    if (!paused && !this.wasPaused) this.elapsed += now - this.last;
    this.last = now;
    this.wasPaused = paused;
    let steps = 0;
    while (
      this.elapsed >= Math.max(20, this.frames[this.index].delay) &&
      steps++ < this.frames.length * 2
    ) {
      this.elapsed -= Math.max(20, this.frames[this.index].delay);
      this.advance();
    }
    return this.canvas;
  }
  private advance() {
    const ctx = this.canvas.getContext("2d")!;
    const old = this.frames[this.index];
    if (old?.disposalType === 2)
      ctx.clearRect(
        old.dims.left,
        old.dims.top,
        old.dims.width,
        old.dims.height,
      );
    if (old?.disposalType === 3 && this.previous)
      ctx.putImageData(this.previous, 0, 0);
    this.index = (this.index + 1) % this.frames.length;
    if (this.index === 0)
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const frame = this.frames[this.index];
    this.previous =
      frame.disposalType === 3
        ? ctx.getImageData(0, 0, this.canvas.width, this.canvas.height)
        : null;
    this.patch.width = frame.dims.width;
    this.patch.height = frame.dims.height;
    this.patch
      .getContext("2d")!
      .putImageData(
        new ImageData(
          new Uint8ClampedArray(frame.patch),
          frame.dims.width,
          frame.dims.height,
        ),
        0,
        0,
      );
    ctx.drawImage(this.patch, frame.dims.left, frame.dims.top);
  }
}
