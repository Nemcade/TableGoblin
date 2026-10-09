import type { Point } from "./model";
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const alpha = (cutoff: number, dt: number) =>
  1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

/** Adaptive screen-space stabilization: steadies slow strokes without dragging fast ones. */
export class BrushSampler {
  private raw: Point;
  private filtered: Point;
  private emitted: Point;
  private velocity: Point = { x: 0, y: 0 };
  private time: number;
  private strength: number;
  private spacing: number;
  constructor(start: Point, time: number, strength: number, spacing = 0.7) {
    this.strength = strength;
    this.spacing = spacing;
    this.raw = { ...start };
    this.filtered = { ...start };
    this.emitted = { ...start };
    this.time = time;
  }
  sample(point: Point, time: number): Point[] {
    const dt = Math.max(0.001, Math.min(0.05, (time - this.time) / 1000));
    this.time = time;
    const av = alpha(8, dt);
    this.velocity = {
      x: lerp(this.velocity.x, (point.x - this.raw.x) / dt, av),
      y: lerp(this.velocity.y, (point.y - this.raw.y) / dt, av),
    };
    this.raw = { ...point };
    const cutoff =
      10 -
      this.strength * 8 +
      Math.hypot(this.velocity.x, this.velocity.y) * 0.035;
    const a = this.strength === 0 ? 1 : alpha(cutoff, dt);
    this.filtered = {
      x: lerp(this.filtered.x, point.x, a),
      y: lerp(this.filtered.y, point.y, a),
    };
    return this.resample(this.filtered);
  }
  finish(point: Point): Point[] {
    const result = this.resample(point);
    if (Math.hypot(point.x - this.emitted.x, point.y - this.emitted.y) > 0.01) {
      result.push({ ...point });
      this.emitted = { ...point };
    }
    return result;
  }
  private resample(point: Point): Point[] {
    const dx = point.x - this.emitted.x,
      dy = point.y - this.emitted.y,
      length = Math.hypot(dx, dy),
      count = Math.floor(length / this.spacing);
    if (!count) return [];
    const start = this.emitted;
    const points = Array.from({ length: count }, (_, i) => ({
      x: start.x + (dx * (i + 1) * this.spacing) / length,
      y: start.y + (dy * (i + 1) * this.spacing) / length,
    }));
    this.emitted = points[points.length - 1];
    return points;
  }
}
