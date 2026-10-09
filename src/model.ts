export type Point = { x: number; y: number };
export type Kind =
  "paper" | "card" | "shape" | "image" | "screen" | "camera" | "video" | "audio" | "text";
export type ShapeKind =
  "rectangle" | "rounded" | "circle" | "triangle" | "hexagon" | "diamond";
export type Crop = { x: number; y: number; width: number; height: number };
export type ImageView = { x: number; y: number; zoom: number };
export const fullCrop: Crop = { x: 0, y: 0, width: 1, height: 1 };
export type Stroke = {
  id: string;
  points: Point[];
  color: string;
  width: number;
  highlight: boolean;
};
export type Surface = {
  id: string;
  kind: Kind;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  parentId: string | null;
  color: string;
  text?: import("./text").TextSettings;
  artwork?: "map" | "notes" | "badge";
  image?: string;
  shape?: ShapeKind;
  imageView?: ImageView;
  video?: string;
  audio?: string;
  filename?: string;
  volume?: number;
  loop?: boolean;
  animated?: boolean;
  paused?: boolean;
  locked?: boolean;
  sourceId?: string;
  sourceWidth?: number;
  sourceHeight?: number;
  crop?: Crop;
  strokes: Stroke[];
};
export type Scene = { objects: Surface[]; strokes: Stroke[] };
export type Transform = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};
export const uid = () => crypto.randomUUID();
export const clone = (scene: Scene): Scene => structuredClone(scene);
export const rotate = (p: Point, angle: number): Point => ({
  x: p.x * Math.cos(angle) - p.y * Math.sin(angle),
  y: p.x * Math.sin(angle) + p.y * Math.cos(angle),
});
export function worldTransform(scene: Scene, obj: Surface): Transform {
  const parent = scene.objects.find((o) => o.id === obj.parentId);
  if (!parent)
    return {
      x: obj.x,
      y: obj.y,
      width: obj.width,
      height: obj.height,
      rotation: obj.rotation,
    };
  const pw = worldTransform(scene, parent);
  const offset = rotate(
    { x: obj.x * pw.width, y: obj.y * pw.height },
    pw.rotation,
  );
  return {
    x: pw.x + offset.x,
    y: pw.y + offset.y,
    width: obj.width,
    height: obj.height,
    rotation: pw.rotation + obj.rotation,
  };
}
export function toLocal(p: Point, t: Transform): Point {
  const v = rotate({ x: p.x - t.x, y: p.y - t.y }, -t.rotation);
  return { x: v.x / t.width, y: v.y / t.height };
}
export function toWorld(p: Point, t: Transform): Point {
  const v = rotate({ x: p.x * t.width, y: p.y * t.height }, t.rotation);
  return { x: v.x + t.x, y: v.y + t.y };
}
export function contains(p: Point, t: Transform) {
  const q = toLocal(p, t);
  return Math.abs(q.x) <= 0.5 && Math.abs(q.y) <= 0.5;
}
export function isShape(obj: Surface) {
  return ["shape", "paper", "card"].includes(obj.kind);
}
export function shapeOf(obj: Surface): ShapeKind {
  return (
    obj.shape ??
    (obj.artwork === "badge"
      ? "circle"
      : obj.kind === "card"
        ? "rounded"
        : "rectangle")
  );
}
export function shapeVertices(shape: ShapeKind): Point[] {
  if (shape === "circle")
    return Array.from({ length: 48 }, (_, i) => ({
      x: Math.cos((i * Math.PI) / 24) * 0.5,
      y: Math.sin((i * Math.PI) / 24) * 0.5,
    }));
  if (shape === "triangle")
    return [
      { x: 0, y: -0.5 },
      { x: 0.5, y: 0.5 },
      { x: -0.5, y: 0.5 },
    ];
  if (shape === "diamond")
    return [
      { x: 0, y: -0.5 },
      { x: 0.5, y: 0 },
      { x: 0, y: 0.5 },
      { x: -0.5, y: 0 },
    ];
  if (shape === "hexagon")
    return [
      { x: -0.25, y: -0.5 },
      { x: 0.25, y: -0.5 },
      { x: 0.5, y: 0 },
      { x: 0.25, y: 0.5 },
      { x: -0.25, y: 0.5 },
      { x: -0.5, y: 0 },
    ];
  if (shape === "rounded") {
    return [
      [0.4, 0.4],
      [-0.4, 0.4],
      [-0.4, -0.4],
      [0.4, -0.4],
    ].flatMap(([x, y], i) =>
      Array.from({ length: 7 }, (_, j) => {
        const a = ((i * 90 + j * 15) * Math.PI) / 180;
        return { x: x + Math.cos(a) * 0.1, y: y + Math.sin(a) * 0.1 };
      }),
    );
  }
  return [
    { x: -0.5, y: -0.5 },
    { x: 0.5, y: -0.5 },
    { x: 0.5, y: 0.5 },
    { x: -0.5, y: 0.5 },
  ];
}
const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
export function containsSurface(p: Point, obj: Surface, t: Transform): boolean {
  const q = toLocal(p, t),
    shape = shapeOf(obj);
  if (!isShape(obj)) return contains(p, t);
  if (shape === "circle") return q.x * q.x + q.y * q.y <= 0.25;
  const vertices = shapeVertices(shape);
  return vertices.every(
    (a, i) => cross(a, vertices[(i + 1) % vertices.length], q) >= -1e-10,
  );
}
export function descendants(scene: Scene, id: string): string[] {
  return scene.objects
    .filter((o) => o.parentId === id)
    .flatMap((o) => [o.id, ...descendants(scene, o.id)]);
}
export function drawOrder(scene: Scene): Surface[] {
  const walk = (parentId: string | null): Surface[] =>
    scene.objects
      .filter((o) => o.parentId === parentId)
      .flatMap((o) => [o, ...walk(o.id)]);
  return walk(null);
}
export function reparent(scene: Scene, obj: Surface, parentId: string | null) {
  if (
    obj.id === parentId ||
    (parentId && descendants(scene, obj.id).includes(parentId))
  )
    return;
  const w = worldTransform(scene, obj);
  const parent = scene.objects.find((o) => o.id === parentId);
  if (parent) {
    const pw = worldTransform(scene, parent),
      local = toLocal(w, pw);
    obj.x = local.x;
    obj.y = local.y;
    obj.rotation = w.rotation - pw.rotation;
  } else {
    obj.x = w.x;
    obj.y = w.y;
    obj.rotation = w.rotation;
  }
  obj.parentId = parent?.id ?? null;
}
export function overlap(
  a: Transform,
  b: Transform,
  shapeA: ShapeKind = "rectangle",
  shapeB: ShapeKind = "rectangle",
): number {
  const original = shapeVertices(shapeA).map((p) => toLocal(toWorld(p, a), b));
  let poly = original;
  const boundary = shapeVertices(shapeB);
  for (let edge = 0; edge < boundary.length; edge++) {
    const ba = boundary[edge],
      bb = boundary[(edge + 1) % boundary.length];
    const input = poly;
    poly = [];
    if (!input.length) return 0;
    for (let i = 0; i < input.length; i++) {
      const p = input[i],
        q = input[(i + 1) % input.length];
      const dp = cross(ba, bb, p),
        dq = cross(ba, bb, q);
      const pi = dp >= -1e-10,
        qi = dq >= -1e-10;
      if (pi) poly.push(p);
      if (pi !== qi) {
        const t = dp / (dp - dq);
        poly.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    }
  }
  const area = (points: Point[]) =>
    Math.abs(
      points.reduce((sum, p, i) => {
        const q = points[(i + 1) % points.length];
        return sum + p.x * q.y - q.x * p.y;
      }, 0),
    ) / 2;
  return area(poly) / area(original);
}
/** Select visible shape footprints touched by a world-space rectangle. */
export function marqueeSelection(scene: Scene, start: Point, end: Point): string[] {
  const box: Transform = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2,
    width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y), rotation: 0 };
  if (!box.width || !box.height) return [];
  return scene.objects.filter(obj => {
    if (obj.locked) return false;
    const t = worldTransform(scene, obj), c = Math.abs(Math.cos(t.rotation)), s = Math.abs(Math.sin(t.rotation));
    if (Math.abs(t.x - box.x) > (t.width * c + t.height * s + box.width) / 2 ||
      Math.abs(t.y - box.y) > (t.width * s + t.height * c + box.height) / 2) return false;
    return overlap(t, box, isShape(obj) ? shapeOf(obj) : "rectangle") > 1e-10;
  }).map(obj => obj.id);
}
export function findParent(
  scene: Scene,
  obj: Surface,
  excluded: Set<string> = new Set(),
): Surface | undefined {
  const forbidden = new Set([
    obj.id,
    ...descendants(scene, obj.id),
    ...excluded,
  ]);
  const w = worldTransform(scene, obj);
  return drawOrder(scene)
    .reverse()
    .find(
      (candidate) =>
        !forbidden.has(candidate.id) &&
        candidate.kind !== "text" &&
        containsSurface(w, candidate, worldTransform(scene, candidate)) &&
        overlap(
          w,
          worldTransform(scene, candidate),
          isShape(obj) ? shapeOf(obj) : "rectangle",
          isShape(candidate) ? shapeOf(candidate) : "rectangle",
        ) >= 0.55,
    );
}
export function deleteSurfaces(scene: Scene, ids: Set<string>) {
  // Release surviving immediate children before removing any ancestor.
  const released = scene.objects
    .filter((o) => !ids.has(o.id) && o.parentId && ids.has(o.parentId))
    .map((o) => ({ o, w: worldTransform(scene, o) }));
  for (const { o, w } of released) {
    Object.assign(o, w);
    o.parentId = null;
  }
  scene.objects = scene.objects.filter((o) => !ids.has(o.id));
}
export function createSurface(kind: Kind, p: Point): Surface {
  return {
    id: uid(),
    kind,
    name:
      kind === "paper"
        ? "Blank paper"
        : kind === "card"
          ? "Little card"
          : kind === "screen"
            ? "Live screen"
            : "Pasted image",
    x: p.x,
    y: p.y,
    width: kind === "card" ? 180 : 420,
    height: kind === "card" ? 120 : 300,
    rotation: 0,
    parentId: null,
    color: kind === "card" ? "#d4ddb8" : "#f1ecdd",
    strokes: [],
  };
}
export function starterScene(): Scene {
  const map = {
    ...createSurface("paper", { x: -85, y: 0 }),
    name: "The quiet coast",
    width: 640,
    height: 440,
    rotation: -0.055,
    artwork: "map" as const,
  };
  const notes = {
    ...createSurface("card", { x: 0.34, y: 0.25 }),
    name: "Field notes",
    width: 198,
    height: 144,
    rotation: 0.11,
    parentId: map.id,
    color: "#e3d7af",
    artwork: "notes" as const,
  };
  const badge = {
    ...createSurface("card", { x: -0.14, y: -0.045 }),
    name: "Waymarker",
    width: 48,
    height: 48,
    rotation: 0.12,
    parentId: map.id,
    color: "#acbf9b",
    artwork: "badge" as const,
  };
  const paper = {
    ...createSurface("paper", { x: 395, y: -30 }),
    name: "Controls",
    width: 270,
    height: 340,
    rotation: 0.055,
  };
  return { objects: [map, notes, badge, paper], strokes: [] };
}

export function createShape(shape: ShapeKind, p: Point): Surface {
  const obj = createSurface("shape", p);
  obj.shape = shape;
  obj.name = {
    rectangle: "Rectangle",
    rounded: "Rounded rectangle",
    circle: "Circle",
    triangle: "Triangle",
    hexagon: "Hexagon",
    diamond: "Diamond",
  }[shape];
  obj.width = shape === "rectangle" || shape === "rounded" ? 300 : 140;
  obj.height = shape === "rectangle" || shape === "rounded" ? 210 : 140;
  obj.color = "#acbf9b";
  return obj;
}
export function copyHierarchy(scene: Scene, selection: Set<string>): Surface[] {
  const roots = [...selection].filter(
    (id) =>
      !scene.objects.some(
        (o) => selection.has(o.id) && descendants(scene, o.id).includes(id),
      ),
  );
  const ids = new Set(roots.flatMap((id) => [id, ...descendants(scene, id)]));
  return drawOrder(scene)
    .filter((o) => ids.has(o.id))
    .map((o) => {
      const copied = structuredClone(o);
      if (roots.includes(o.id)) {
        Object.assign(copied, worldTransform(scene, o));
        copied.parentId = null;
      }
      return copied;
    });
}
export function pasteHierarchy(
  scene: Scene,
  content: Surface[],
  offset: Point,
): string[] {
  const ids = new Map(content.map((o) => [o.id, uid()]));
  const roots: string[] = [];
  for (const source of content) {
    const obj = structuredClone(source);
    obj.id = ids.get(source.id)!;
    obj.strokes.forEach((s) => (s.id = uid()));
    if (source.parentId && ids.has(source.parentId))
      obj.parentId = ids.get(source.parentId)!;
    else {
      obj.parentId = null;
      obj.x += offset.x;
      obj.y += offset.y;
      roots.push(obj.id);
    }
    if (obj.kind === "screen" || obj.kind === "camera")
      obj.sourceId = source.sourceId ?? source.id;
    scene.objects.push(obj);
  }
  return roots;
}
export function imagePlacement(
  w: number,
  h: number,
  sw: number,
  sh: number,
  view: ImageView = { x: 0, y: 0, zoom: 1 },
) {
  const scale = Math.max(w / sw, h / sh) * Math.max(1, view.zoom),
    width = sw * scale,
    height = sh * scale;
  const x = Math.max(-(width - w) / 2, Math.min((width - w) / 2, view.x * w));
  const y = Math.max(-(height - h) / 2, Math.min((height - h) / 2, view.y * h));
  return {
    x: x - width / 2,
    y: y - height / 2,
    width,
    height,
    view: { x: x / w, y: y / h, zoom: Math.max(1, view.zoom) },
  };
}
export function applyCrop(obj: Surface, crop: Crop) {
  const old = obj.crop ?? fullCrop,
    oldMin = Math.min(obj.width, obj.height);
  obj.height =
    (obj.width * ((obj.sourceHeight ?? obj.height) * crop.height)) /
    ((obj.sourceWidth ?? obj.width) * crop.width);
  for (const stroke of obj.strokes) {
    stroke.points = stroke.points.map((p) => ({
      x: (old.x + (p.x + 0.5) * old.width - crop.x) / crop.width - 0.5,
      y: (old.y + (p.y + 0.5) * old.height - crop.y) / crop.height - 0.5,
    }));
    stroke.width *=
      ((oldMin / Math.min(obj.width, obj.height)) * old.width) / crop.width;
  }
  obj.crop = { ...crop };
}
