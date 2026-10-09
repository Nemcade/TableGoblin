import type { Point } from "./model";
import type { Camera } from "./render";
import { themePalette, type Mood } from "./mood";
import { hslHex, withAlpha } from "./colors";
import {
  measurementLabel,
  type GridSettings,
  type Measurement,
  type ObscureSettings,
  type Region,
} from "./table-widgets";
const screen = (p: Point, c: Camera) => ({
  x: p.x * c.zoom + c.x,
  y: p.y * c.zoom + c.y,
});
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  camera: Camera,
  grid: GridSettings,
  mood: Mood,
) {
  const spacing = grid.size * camera.zoom;
  if (!grid.enabled || !grid.opacity || spacing < 3) return;
  const angle = (grid.angle * Math.PI) / 180,
    cos = Math.cos(angle),
    sin = Math.sin(angle);
  const corners = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ].map((p) => {
    const x = (p.x - camera.x) / camera.zoom,
      y = (p.y - camera.y) / camera.zoom;
    return { x: x * cos + y * sin, y: -x * sin + y * cos };
  });
  const minX = Math.min(...corners.map((p) => p.x)),
    maxX = Math.max(...corners.map((p) => p.x)),
    minY = Math.min(...corners.map((p) => p.y)),
    maxY = Math.max(...corners.map((p) => p.y));
  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.rotate(angle);
  const palette = themePalette(mood);
  ctx.strokeStyle = withAlpha(
    palette.ink,
    grid.opacity * Math.min(1, (spacing - 3) / 7),
  );
  ctx.lineWidth = 1 / camera.zoom;
  ctx.beginPath();
  for (
    let x = Math.floor(minX / grid.size) * grid.size;
    x <= maxX;
    x += grid.size
  ) {
    ctx.moveTo(x, minY);
    ctx.lineTo(x, maxY);
  }
  for (
    let y = Math.floor(minY / grid.size) * grid.size;
    y <= maxY;
    y += grid.size
  ) {
    ctx.moveTo(minX, y);
    ctx.lineTo(maxX, y);
  }
  ctx.stroke();
  ctx.restore();
}
export function drawMeasurement(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  line: Measurement | null,
  grid: GridSettings,
  mood: Mood,
) {
  if (!grid.enabled || !line) return;
  const a = screen(line.start, camera),
    b = screen(line.end, camera),
    color = themePalette(mood).ink;
  const palette = themePalette(mood);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const p of [a, b]) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = palette.panel;
    ctx.fill();
    ctx.stroke();
  }
  const text = measurementLabel(line, grid);
  ctx.font = '500 12px "Segoe UI",sans-serif';
  const width = ctx.measureText(text).width + 22,
    x = (a.x + b.x) / 2,
    y = (a.y + b.y) / 2 - 22;
  ctx.beginPath();
  ctx.roundRect(x - width / 2, y - 13, width, 27, 7);
  ctx.fillStyle = withAlpha(palette.panel, 0.96);
  ctx.fill();
  ctx.strokeStyle = withAlpha(palette.ink, 0.35);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 1);
  ctx.restore();
}
function regionPath(region: Region) {
  const path = new Path2D();
  region.points.forEach((p, i) => {
    if (!i) path.moveTo(p.x, p.y);
    else path.lineTo(p.x, p.y);
  });
  path.closePath();
  return path;
}
/** Viewport-sized mask is reconstructed in world space: the cover has no far edge. */
export class ObscureRenderer {
  private canvas = document.createElement("canvas");
  private key = "";
  private paths = new WeakMap<Region, Path2D>();
  draw(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    dpr: number,
    camera: Camera,
    settings: ObscureSettings,
    mood: Mood,
  ) {
    if (!settings.enabled) return;
    const key = [
      w,
      h,
      dpr,
      camera.x,
      camera.y,
      camera.zoom,
      settings.revision,
      settings.covered,
      mood.hue,
      mood.saturation,
    ].join(":");
    if (key !== this.key) {
      this.key = key;
      const c = this.canvas;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      const mask = c.getContext("2d")!;
      mask.setTransform(dpr, 0, 0, dpr, 0, 0);
      mask.fillStyle = hslHex(
        mood.hue,
        Math.min(50, (mood.saturation * 10) / 7),
        12,
      );
      if (settings.covered) mask.fillRect(0, 0, w, h);
      mask.translate(camera.x, camera.y);
      mask.scale(camera.zoom, camera.zoom);
      mask.filter = `blur(${Math.min(3, Math.max(0.8, camera.zoom * 1.4)) * dpr}px)`;
      for (const region of settings.regions) {
        let path = this.paths.get(region);
        if (!path) {
          path = regionPath(region);
          this.paths.set(region, path);
        }
        mask.globalCompositeOperation =
          region.mode === "reveal" ? "destination-out" : "source-over";
        mask.fill(path);
      }
    }
    ctx.save();
    ctx.globalAlpha = settings.gm ? (settings.gmOpacity ?? 0.28) : 1;
    ctx.drawImage(this.canvas, 0, 0, w, h);
    ctx.restore();
  }
}
export function drawLasso(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  region: Region | null,
  mood: Mood,
) {
  if (!region?.points.length) return;
  ctx.save();
  ctx.beginPath();
  region.points.forEach((p, i) => {
    const s = screen(p, camera);
    if (!i) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
  const palette = themePalette(mood);
  ctx.fillStyle = withAlpha(palette.accent, 0.08);
  ctx.fill();
  ctx.strokeStyle =
    region.mode === "reveal"
      ? palette.ink
      : hslHex(
          mood.hue - 80,
          Math.min(35, (mood.saturation * 35) / 7),
          palette.dark ? 70 : 30,
        );
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.setLineDash([5, 4]);
  ctx.stroke();
  ctx.restore();
}
