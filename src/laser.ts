import type { Point } from "./model.ts";
import type { Camera } from "./render.ts";
import { withAlpha } from "./colors.ts";

export type LaserPoint = Point & { time: number; start?: boolean };
export const laserLifetime = 650;

/** Smooth sparse presence updates locally. Trails never enter saved table data. */
export class RemoteLaser {
  points: LaserPoint[] = [];
  private head: Point | null = null;
  private target: Point | null = null;
  private received = -Infinity;
  private stamp: number | undefined;
  private stepped = 0;
  update(point: Point | null, now: number, stamp?: number) {
    if (!point) { this.head = null; this.target = null; this.stamp = stamp; return; }
    if (stamp !== undefined && stamp === this.stamp && now - this.received > 1200) return;
    if (!this.target || point.x !== this.target.x || point.y !== this.target.y || stamp === undefined || stamp !== this.stamp) {
      if (!this.head || now - this.received > 1200) {
        this.head = { ...point }; this.points.push({ ...point, time: now, start: true });
        if (this.points.length > 48) this.points.shift();
      }
      this.target = { ...point }; this.received = now; this.stamp = stamp;
    }
  }
  step(now: number) {
    if (!this.target && !this.points.length) { this.stepped = now; return false; }
    const visible = this.points.length > 0;
    this.points = this.points.filter(p => now - p.time < laserLifetime);
    const elapsed = Math.max(0, Math.min(80, now - this.stepped)); this.stepped = now;
    if (this.head && this.target && now - this.received <= 1200) {
      const amount = 1 - Math.exp(-elapsed / 35);
      this.head.x += (this.target.x - this.head.x) * amount;
      this.head.y += (this.target.y - this.head.y) * amount;
      const last = this.points.at(-1);
      if (!last || now - last.time >= 24) this.points.push({ ...this.head, time: now, start: !last });
    } else { this.head = null; this.target = null; }
    this.points = this.points.slice(-48);
    return visible || this.points.length > 0;
  }
}

/** Identical light and fading trail for local and remote pointers, in screen pixels. */
export function paintLaser(ctx: CanvasRenderingContext2D, points: LaserPoint[], camera: Camera, color: string, now: number) {
  if (!points.length) return;
  ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 10;
  for (let i = 1; i < points.length; i++) {
    const p = points[i], alpha = Math.max(0, 1 - (now - p.time) / laserLifetime);
    if (!alpha || p.start) continue;
    const previous = points[i - 1];
    const beginning = i === 1 || previous.start ? previous : { x: (points[i - 2].x + previous.x) / 2, y: (points[i - 2].y + previous.y) / 2 };
    const ending = i === points.length - 1 || points[i + 1].start ? p : { x: (previous.x + p.x) / 2, y: (previous.y + p.y) / 2 };
    ctx.globalAlpha = alpha * alpha; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(beginning.x * camera.zoom + camera.x, beginning.y * camera.zoom + camera.y);
    ctx.quadraticCurveTo(previous.x * camera.zoom + camera.x, previous.y * camera.zoom + camera.y,
      ending.x * camera.zoom + camera.x, ending.y * camera.zoom + camera.y); ctx.stroke();
  }
  const head = points.at(-1)!, alpha = Math.max(0, 1 - (now - head.time) / laserLifetime);
  if (alpha) {
    const x = head.x * camera.zoom + camera.x, y = head.y * camera.zoom + camera.y;
    ctx.globalAlpha = alpha; ctx.shadowBlur = 0;
    const glow = ctx.createRadialGradient(x, y, 1, x, y, 15);
    glow.addColorStop(0, withAlpha(color, .75)); glow.addColorStop(.35, withAlpha(color, .3)); glow.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI * 2); ctx.fill();
    ctx.shadowColor = color; ctx.shadowBlur = 9;
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = "#fff9ef"; ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
