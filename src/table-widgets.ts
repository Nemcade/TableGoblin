import type { Point } from "./model";
export type GridSettings = {
  enabled: boolean;
  size: number;
  units: number;
  unit: string;
  angle: number;
  opacity: number;
};
export const defaultGrid: GridSettings = {
  enabled: false,
  size: 80,
  units: 1,
  unit: "m",
  angle: 0,
  opacity: 0.18,
};
export type Measurement = { start: Point; end: Point };
export function measure(line: Measurement, grid: GridSettings) {
  return (
    (Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y) /
      grid.size) *
    grid.units
  );
}
export function measurementLabel(line: Measurement, grid: GridSettings) {
  const amount = measure(line, grid);
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(amount)}${grid.unit.trim() ? ` ${grid.unit.trim()}` : ""}`;
}
export type ObscureMode = "reveal" | "cover";
export type Region = { mode: ObscureMode; points: Point[] };
export type ObscureSnapshot = { covered: boolean; regions: Region[] };
export type ObscureSettings = ObscureSnapshot & {
  enabled: boolean;
  gm: boolean;
  /** Optional for tables saved before adjustable GM opacity. */
  gmOpacity?: number;
  mode: ObscureMode;
  revision: number;
};
export const defaultObscure: ObscureSettings = {
  enabled: false,
  covered: true,
  regions: [],
  gm: false,
  gmOpacity: 0.28,
  mode: "reveal",
  revision: 0,
};
export function polygonArea(points: Point[]) {
  return (
    Math.abs(
      points.reduce((sum, p, i) => {
        const q = points[(i + 1) % points.length];
        return sum + p.x * q.y - q.x * p.y;
      }, 0),
    ) / 2
  );
}
/** Reduce lasso input while preserving its outline and deliberate corners. */
export function simplifyLasso(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  const kept = new Set([0, points.length - 1]),
    stack: [[number, number]] | [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!,
      p = points[a],
      q = points[b],
      dx = q.x - p.x,
      dy = q.y - p.y,
      l = dx * dx + dy * dy;
    let far = tolerance * tolerance,
      index = -1;
    for (let i = a + 1; i < b; i++) {
      const t = l
        ? Math.max(
            0,
            Math.min(
              1,
              ((points[i].x - p.x) * dx + (points[i].y - p.y) * dy) / l,
            ),
          )
        : 0;
      const d =
        (points[i].x - p.x - t * dx) ** 2 + (points[i].y - p.y - t * dy) ** 2;
      if (d > far) {
        far = d;
        index = i;
      }
    }
    if (index >= 0) {
      kept.add(index);
      stack.push([a, index], [index, b]);
    }
  }
  return [...kept].sort((a, b) => a - b).map((i) => points[i]);
}
