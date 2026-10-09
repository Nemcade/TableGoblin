import {
  drawOrder,
  isShape,
  shapeOf,
  shapeVertices,
  imagePlacement,
  fullCrop,
  toWorld,
  worldTransform,
  type Point,
  type Scene,
  type Stroke,
  type Surface,
  type Transform,
  type Crop,
  type ShapeKind,
} from "./model";
import { AnimatedGif } from "./animated-gif";
import { paintText, textMode } from "./text";
import { mediaState, videoState, videoLoadTimeout } from "./video-source";
import { withAlpha } from "./colors";
import {
  defaultMood,
  themePalette,
  backgroundFinish,
  paintAtmosphere,
  type Mood,
} from "./mood";
import {
  drawGrid,
  drawMeasurement,
  drawLasso,
  ObscureRenderer,
} from "./widget-render";
import type {
  GridSettings,
  Measurement,
  ObscureSettings,
  Region,
} from "./table-widgets";
import type { TableDice } from "./dice";
export type Camera = { x: number; y: number; zoom: number };
export type Media = { video: HTMLVideoElement; stream: MediaStream };
export type LaserPoint = Point & { time: number; start?: boolean };
export const handles = [
  { x: -0.5, y: -0.5 },
  { x: 0, y: -0.5 },
  { x: 0.5, y: -0.5 },
  { x: 0.5, y: 0 },
  { x: 0.5, y: 0.5 },
  { x: 0, y: 0.5 },
  { x: -0.5, y: 0.5 },
  { x: -0.5, y: 0 },
];
export function screenPoint(p: Point, camera: Camera): Point {
  return { x: p.x * camera.zoom + camera.x, y: p.y * camera.zoom + camera.y };
}
export function handlePositions(t: Transform, camera: Camera) {
  return [
    ...handles.map((p) => screenPoint(toWorld(p, t), camera)),
    screenPoint(
      toWorld({ x: 0, y: -0.5 - 30 / (t.height * camera.zoom) }, t),
      camera,
    ),
  ];
}
export function visibleHandles(t: Transform, camera: Camera, obj?: Surface): number[] {
  // Fewer targets at distant zoom levels; the center always stays free to pick up.
  const size = Math.min(t.width, t.height) * camera.zoom;
  const visible = size < 30
    ? [8]
    : size < 85
      ? [0, 2, 4, 6, 8]
      : [0, 1, 2, 3, 4, 5, 6, 7, 8];
  return obj?.kind === "text" && obj.text && textMode(obj.text) === "paragraph" ? visible.filter(i => i !== 1 && i !== 5) : visible;
}
export function surfacePath(shape: ShapeKind, w: number, h: number): Path2D {
  const p = new Path2D();
  if (shape === "circle") p.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (shape === "rounded")
    p.roundRect(-w / 2, -h / 2, w, h, { x: w * 0.1, y: h * 0.1 });
  else {
    shapeVertices(shape).forEach((v, i) => {
      if (i === 0) p.moveTo(v.x * w, v.y * h);
      else p.lineTo(v.x * w, v.y * h);
    });
    p.closePath();
  }
  return p;
}
export function drawContent(
  ctx: CanvasRenderingContext2D,
  obj: Surface,
  source: CanvasImageSource,
  w: number,
  h: number,
) {
  const sw =
    source instanceof HTMLVideoElement
      ? source.videoWidth
      : source instanceof HTMLImageElement
        ? source.naturalWidth
        : (source as HTMLCanvasElement).width;
  const sh =
    source instanceof HTMLVideoElement
      ? source.videoHeight
      : source instanceof HTMLImageElement
        ? source.naturalHeight
        : (source as HTMLCanvasElement).height;
  if (!sw || !sh) return;
  const crop: Crop = obj.crop ?? fullCrop;
  const scale = Math.min(w / (sw * crop.width), h / (sh * crop.height));
  const dest = isShape(obj)
    ? imagePlacement(w, h, sw * crop.width, sh * crop.height, obj.imageView)
    : obj.kind === "screen" || obj.kind === "camera"
      ? { x: -sw * crop.width * scale / 2, y: -sh * crop.height * scale / 2, width: sw * crop.width * scale, height: sh * crop.height * scale }
      : { x: -w / 2, y: -h / 2, width: w, height: h };
  ctx.drawImage(
    source,
    sw * crop.x,
    sh * crop.y,
    sw * crop.width,
    sh * crop.height,
    dest.x,
    dest.y,
    dest.width,
    dest.height,
  );
}
function path(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  width: number,
  color: string,
) {
  if (!points.length) return;
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[Math.max(0, i - 1)],
      b = points[i],
      c = points[i + 1],
      d = points[Math.min(points.length - 1, i + 2)];
    ctx.bezierCurveTo(
      b.x + (c.x - a.x) / 6,
      b.y + (c.y - a.y) / 6,
      c.x - (d.x - b.x) / 6,
      c.y - (d.y - b.y) / 6,
      c.x,
      c.y,
    );
  }
  ctx.stroke();
}
function strokes(ctx: CanvasRenderingContext2D, list: Stroke[], t?: Transform) {
  for (const stroke of list) {
    ctx.globalAlpha = stroke.highlight ? 0.28 : 1;
    path(
      ctx,
      t
        ? stroke.points.map((p) => ({ x: p.x * t.width, y: p.y * t.height }))
        : stroke.points,
      t ? stroke.width * Math.min(t.width, t.height) : stroke.width,
      stroke.color,
    );
  }
  ctx.globalAlpha = 1;
}
function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  font = "sans-serif",
) {
  ctx.fillStyle = color;
  ctx.font = `${size}px ${font}`;
  ctx.fillText(text, x, y);
}
function fittedLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, maxWidth: number) {
  ctx.font = `${size}px "Segoe UI", sans-serif`;
  let shown = text;
  while (shown.length > 1 && ctx.measureText(shown).width > maxWidth) shown = shown.slice(0, -2) + "…";
  ctx.fillStyle = color; ctx.fillText(shown, x, y);
}
export function audioButton(obj: Surface, width = obj.width, height = obj.height) {
  const scale = Math.min(1, width / 300, height / 100);
  return { x: -width / 2 + 40 * scale, y: 0, radius: 19 * scale, scale };
}
function mediaPlaceholder(ctx: CanvasRenderingContext2D, obj: Surface, w: number, h: number, message: string, mood: Mood) {
  const palette = themePalette(mood), scale = Math.min(1, w / 260, h / 130);
  ctx.fillStyle = palette.panel; ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeStyle = withAlpha(palette.ink, .09); ctx.lineWidth = 1;
  for (let x = -w / 2 - h; x < w / 2; x += 28) { ctx.beginPath(); ctx.moveTo(x, h / 2); ctx.lineTo(x + h, -h / 2); ctx.stroke(); }
  ctx.textAlign = "center";
  fittedLabel(ctx, obj.filename ?? obj.name, 0, -8 * scale, 15 * scale, palette.ink, w - 28 * scale);
  fittedLabel(ctx, message, 0, 17 * scale, 12 * scale, palette.muted, w - 28 * scale);
  ctx.textAlign = "left";
}
function audioTile(ctx: CanvasRenderingContext2D, obj: Surface, w: number, h: number, message: string, mood: Mood) {
  const palette = themePalette(mood), button = audioButton(obj, w, h), s = button.scale;
  ctx.fillStyle = palette.panel; ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = palette.accent; ctx.beginPath(); ctx.arc(button.x, 0, button.radius, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = palette.onAccent;
  if (obj.paused !== false) {
    ctx.beginPath(); ctx.moveTo(button.x - 4 * s, -7 * s); ctx.lineTo(button.x + 7 * s, 0); ctx.lineTo(button.x - 4 * s, 7 * s); ctx.fill();
  } else { ctx.fillRect(button.x - 6 * s, -7 * s, 4 * s, 14 * s); ctx.fillRect(button.x + 2 * s, -7 * s, 4 * s, 14 * s); }
  const x = -w / 2 + 74 * s;
  fittedLabel(ctx, obj.filename ?? obj.name, x, -5 * s, 14 * s, palette.ink, w - 92 * s);
  fittedLabel(ctx, message, x, 17 * s, 11 * s, palette.muted, w - 92 * s);
}
function mapArt(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.save();
  ctx.scale(w / 640, h / 440);
  ctx.translate(-320, -220);
  const land = new Path2D(
    "M 0 115 C 75 77 76 131 122 116 S 145 152 197 131 S 260 168 282 199 S 351 202 348 252 S 400 288 405 316 S 417 385 463 440 L 0 440 Z",
  );
  ctx.fillStyle = "#dce2d4";
  ctx.fillRect(24, 86, 592, 322);
  ctx.fillStyle = "#eae5d4";
  ctx.fill(land);
  ctx.save();
  ctx.clip(land);
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    ctx.moveTo(-60, 130 + i * 25);
    ctx.bezierCurveTo(170, 55 + i * 25, 145, 295 + i * 13, 490, 300 + i * 21);
    ctx.strokeStyle = "#c9c8ad";
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = "#8c9b87";
  ctx.lineWidth = 1.5;
  ctx.stroke(land);
  ctx.fillStyle = "#f1ecdd";
  ctx.fillRect(0, 0, 640, 86);
  ctx.fillRect(0, 0, 24, 440);
  ctx.fillRect(616, 0, 24, 440);
  ctx.fillRect(0, 408, 640, 32);
  label(ctx, "THE QUIET COAST", 28, 42, 22, "#384c42", "Georgia");
  label(ctx, "COAST MAP", 29, 65, 8, "#7c8270");
  ctx.textAlign = "right";
  label(ctx, "FIELD MAP / 001", 609, 40, 8, "#7c8270");
  label(ctx, "NORTHWEST REACH", 609, 56, 8, "#7c8270");
  ctx.textAlign = "left";
  ctx.setLineDash([4, 5]);
  ctx.strokeStyle = "#ae7952";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(89, 348);
  ctx.bezierCurveTo(98, 276, 168, 305, 180, 236);
  ctx.bezierCurveTo(194, 196, 237, 219, 263, 202);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const [x, y, name] of [
    [89, 348, "OLD HARBOR"],
    [180, 236, "THE LOOKOUT"],
    [263, 202, "SALT HOUSE"],
  ] as const) {
    ctx.fillStyle = "#f1ecdd";
    ctx.strokeStyle = "#7c775a";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    label(ctx, name, x + 10, y + 3, 8, "#686f57");
  }
  ctx.save();
  ctx.translate(420, 224);
  ctx.rotate(-0.25);
  label(ctx, "T h e   S t i l l   S e a", 0, 0, 14, "#81958b", "Georgia");
  ctx.restore();
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(441 + i * 7, 295 + i * 14);
    ctx.bezierCurveTo(
      490 + i * 5,
      282 + i * 14,
      537,
      315 + i * 14,
      588,
      292 + i * 14,
    );
    ctx.lineWidth = 0.65;
    ctx.strokeStyle = "#bccbbf";
    ctx.stroke();
  }
  ctx.save();
  ctx.translate(558, 130);
  ctx.strokeStyle = "#748875";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -15);
  ctx.lineTo(0, 15);
  ctx.moveTo(-12, 0);
  ctx.lineTo(12, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -12);
  ctx.lineTo(-4, 2);
  ctx.lineTo(0, 0);
  ctx.lineTo(4, 2);
  ctx.closePath();
  ctx.fillStyle = "#748875";
  ctx.fill();
  ctx.textAlign = "center";
  label(ctx, "N", 0, -21, 9, "#748875");
  ctx.restore();
  label(
    ctx,
    "Drag this map to move attached objects.",
    29,
    428,
    10,
    "#7d8270",
    "Georgia",
  );
  ctx.restore();
}
function artwork(ctx: CanvasRenderingContext2D, obj: Surface) {
  const w = obj.width,
    h = obj.height;
  if (obj.artwork === "map") {
    mapArt(ctx, w, h);
    return;
  }
  if (obj.artwork === "notes") {
    ctx.save();
    ctx.scale(w / 198, h / 144);
    ctx.translate(-99, -72);
    label(ctx, "Session notes", 18, 30, 17, "#605840", "Georgia");
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = "#c5b994";
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(17, 62 + i * 24);
      ctx.lineTo(181, 62 + i * 24);
      ctx.stroke();
    }
    label(ctx, "Find the old harbor", 19, 55, 11, "#71654a");
    label(ctx, "Ask about the lighthouse", 19, 79, 11, "#71654a");
    label(ctx, "Explore the shoreline", 19, 103, 11, "#71654a");
    ctx.restore();
    return;
  }
  if (obj.artwork === "badge") {
    ctx.strokeStyle = "#425643";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, w * 0.28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -w * 0.17);
    ctx.lineTo(w * 0.13, w * 0.1);
    ctx.lineTo(-w * 0.13, w * 0.1);
    ctx.closePath();
    ctx.stroke();
    return;
  }
  if (obj.name === "Controls") {
    ctx.save();
    ctx.scale(w / 270, h / 340);
    ctx.translate(-135, -170);
    label(ctx, "QUICK REFERENCE", 26, 38, 9, "#8a8b77");
    label(ctx, "Table controls", 26, 81, 25, "#3e4e3e", "Georgia");

    ctx.strokeStyle = "#c4ccb4";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(26, 137);
    ctx.lineTo(243, 137);
    ctx.stroke();
    const rows = [
      ["01", "Move surfaces", "Drag any object."],
      ["02", "Attach objects", "Drop a smaller object onto the map."],
      ["03", "Draw", "Marks stay on their surface."],
    ];
    rows.forEach((r, i) => {
      label(ctx, r[0], 26, 167 + i * 48, 9, "#929681");
      label(ctx, r[1], 49, 168 + i * 48, 12, "#485344");
      label(ctx, r[2], 49, 186 + i * 48, 10, "#92917e");
    });
    label(
      ctx,
      "Open Help for keyboard shortcuts.",
      26,
      318,
      11,
      "#88917d",
      "Georgia",
    );
    ctx.restore();
  }
}
export class Renderer {
  private obscureRenderer = new ObscureRenderer();
  images = new Map<string, HTMLImageElement>();
  videos = new Map<string, { url: string; video: HTMLVideoElement; timer: ReturnType<typeof setTimeout>; timedOut: boolean }>();
  audios = new Map<string, { url: string; audio: HTMLAudioElement; timer: ReturnType<typeof setTimeout>; timedOut: boolean; starting: boolean; playError: string | null }>();
  gifs = new Map<string, { url: string; gif: AnimatedGif | null }>();
  pattern: CanvasPattern | null = null;
  constructor(
    public canvas: HTMLCanvasElement,
    private invalidate: () => void = () => {},
    private changed: () => void = invalidate,
    private audioStopped: (id: string) => void = () => {},
  ) {}
  source(obj: Surface, media: Map<string, Media>): CanvasImageSource | null {
    if (obj.kind === "screen" || obj.kind === "camera") {
      const video = media.get(obj.sourceId ?? obj.id)?.video;
      return video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0 ? video : null;
    }
    if (obj.audio) { this.audioSource(obj); return null; }
    if (obj.video) {
      let entry = this.videos.get(obj.id);
      if (!entry || entry.url !== obj.video) {
        if (entry) {
          clearTimeout(entry.timer);
          entry.video.pause();
          entry.video.removeAttribute("src");
          entry.video.load();
        }
        const video = document.createElement("video");
        video.src = obj.video;
        video.muted = true;
        video.playsInline = true;
        video.loop = true;
        const target = { url: obj.video, video, timedOut: false, timer: setTimeout(() => {
          if (this.videos.get(obj.id) !== target) return;
          target.timedOut = true; this.changed(); this.invalidate();
        }, videoLoadTimeout) };
        const change = () => {
          if (this.videos.get(obj.id) !== target) return;
          if (videoState(video).state !== "loading") clearTimeout(target.timer);
          this.changed(); this.invalidate();
        };
        video.onloadedmetadata = change; video.onloadeddata = change; video.onerror = change;
        entry = target;
        this.videos.set(obj.id, entry);
      }
      if (obj.paused && !entry.video.paused) entry.video.pause();
      else if (!obj.paused && entry.video.paused && videoState(entry.video, entry.timedOut).state !== "error")
        void entry.video.play().catch(() => {});
      return videoState(entry.video, entry.timedOut).state === "ready" ? entry.video : null;
    }
    if (obj.image) {
      if (obj.animated) {
        let entry = this.gifs.get(obj.id);
        if (!entry || entry.url !== obj.image) {
          entry = { url: obj.image, gif: null };
          this.gifs.set(obj.id, entry);
          const target = entry;
          void AnimatedGif.load(obj.image)
            .then((gif) => {
              target.gif = gif;
              this.invalidate();
            })
            .catch(() => this.invalidate());
        }
        if (entry.gif) return entry.gif.tick(!!obj.paused);
      }
      let image = this.images.get(obj.image);
      if (!image) {
        image = new Image();
        image.onload = this.invalidate;
        image.onerror = () => { this.changed(); this.invalidate(); };
        image.src = obj.image;
        this.images.set(obj.image, image);
      }
      return image.complete && image.naturalWidth ? image : null;
    }
    return null;
  }
  private audioSource(obj: Surface) {
    let entry = this.audios.get(obj.id);
    if (!entry || entry.url !== obj.audio) {
      if (entry) { clearTimeout(entry.timer); entry.audio.pause(); entry.audio.removeAttribute("src"); entry.audio.load(); }
      const audio = new Audio(obj.audio); audio.preload = "auto";
      const target = { url: obj.audio!, audio, timedOut: false, starting: false, playError: null as string | null, timer: setTimeout(() => {
        if (this.audios.get(obj.id) !== target) return;
        target.timedOut = true; this.changed(); this.invalidate();
      }, videoLoadTimeout) };
      const change = () => {
        if (this.audios.get(obj.id) !== target) return;
        if (mediaState(audio).state !== "loading") clearTimeout(target.timer);
        this.changed(); this.invalidate();
      };
      audio.onloadeddata = change; audio.onerror = change;
      audio.onended = () => { if (this.audios.get(obj.id) === target) this.audioStopped(obj.id); };
      entry = target; this.audios.set(obj.id, entry);
    }
    entry.audio.volume = obj.volume ?? .65; entry.audio.loop = obj.loop ?? false;
    if (obj.paused !== false) entry.audio.pause();
    else if (entry.audio.paused && !entry.starting && mediaState(entry.audio, entry.timedOut).state !== "error") {
      const target = entry;
      target.starting = true; target.playError = null;
      void target.audio.play().catch(() => {
        if (this.audios.get(obj.id) !== target) return;
        target.playError = "Playback unavailable · press Play to retry";
        this.audioStopped(obj.id);
      }).finally(() => { target.starting = false; this.invalidate(); });
    }
    return entry;
  }
  fileIssue(obj: Surface): string | null {
    if (obj.video) {
      const entry = this.videos.get(obj.id);
      if (entry?.url === obj.video) { const state = videoState(entry.video, entry.timedOut); return state.state === "error" ? state.message : null; }
    }
    if (obj.audio) {
      const entry = this.audios.get(obj.id);
      if (entry?.url === obj.audio) { const state = mediaState(entry.audio, entry.timedOut); return state.state === "error" ? state.message.replace(/Video/g, "Audio") : null; }
    }
    if (obj.image) { const image = this.images.get(obj.image); if (image?.complete && !image.naturalWidth) return "Image could not be read"; }
    if ((obj.kind === "video" && !obj.video) || (obj.kind === "audio" && !obj.audio)) return "No media file";
    return null;
  }
  failedMedia(scene: Scene) { return scene.objects.filter(o => this.fileIssue(o)).map(o => ({ id: o.id, name: o.filename ?? o.name, reason: this.fileIssue(o)! })); }
  sync(scene: Scene) {
    for (const obj of scene.objects) if (obj.video || obj.audio || obj.image) this.source(obj, new Map());
    for (const [id, entry] of this.videos) {
      if (!scene.objects.some((o) => o.id === id && o.video === entry.url)) {
        this.videos.delete(id); clearTimeout(entry.timer); entry.video.pause(); entry.video.removeAttribute("src"); entry.video.load();
      }
    }
    for (const [id, entry] of this.audios) {
      if (!scene.objects.some((o) => o.id === id && o.audio === entry.url)) {
        this.audios.delete(id); clearTimeout(entry.timer); entry.audio.pause(); entry.audio.removeAttribute("src"); entry.audio.load();
      }
    }
    for (const [id, entry] of this.gifs) {
      if (!scene.objects.some((o) => o.id === id)) entry.gif?.tick(true);
    }
  }
  dispose() {
    this.videos.forEach((entry) => {
      clearTimeout(entry.timer);
      entry.video.pause();
      entry.video.removeAttribute("src");
      entry.video.load();
    });
    this.videos.clear();
    this.audios.forEach((entry) => { clearTimeout(entry.timer); entry.audio.pause(); entry.audio.removeAttribute("src"); entry.audio.load(); });
    this.audios.clear();
    this.gifs.clear();
    this.images.clear();
  }
  render(
    scene: Scene,
    camera: Camera,
    selection: Set<string>,
    candidate: string | null,
    lifted: Set<string>,
    media: Map<string, Media>,
    laser: LaserPoint[],
    hover: Point | null,
    pen: { color: string; width: number; eraser: boolean } | null,
    transforms = true,
    mood: Mood = defaultMood,
    widgets?: {
      grid: GridSettings;
      measurement: Measurement | null;
      obscure: ObscureSettings;
      lasso: Region | null;
      dice: TableDice;
    },
    marquee?: { start: Point; end: Point },
    hiddenTextId: string | null = null,
  ) {
    const ctx = this.canvas.getContext("2d")!;
    const dpr = Math.min(devicePixelRatio, 2);
    const width = this.canvas.clientWidth,
      height = this.canvas.clientHeight;
    if (
      this.canvas.width !== Math.round(width * dpr) ||
      this.canvas.height !== Math.round(height * dpr)
    ) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = `hsl(${mood.hue} ${mood.saturation}% ${mood.lightness}%)`;
    ctx.fillRect(0, 0, width, height);
    if (!this.pattern) {
      const tile = document.createElement("canvas");
      tile.width = 128;
      tile.height = 128;
      const tc = tile.getContext("2d")!;
      let seed = 137;
      for (let i = 0; i < 2500; i++) {
        seed = (seed * 16807) % 2147483647;
        const x = seed % 128;
        seed = (seed * 16807) % 2147483647;
        const y = seed % 128;
        tc.fillStyle = i % 2 ? "rgba(255,255,255,.022)" : "rgba(0,0,0,.04)";
        tc.fillRect(x, y, 1, 1);
      }
      this.pattern = ctx.createPattern(tile, "repeat");
    }
    ctx.save();
    ctx.globalAlpha *= mood.texture * backgroundFinish(mood);
    ctx.fillStyle = this.pattern!;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
    paintAtmosphere(ctx, width, height, mood, performance.now());
    if (widgets) drawGrid(ctx, width, height, camera, widgets.grid, mood);
    ctx.save();
    ctx.translate(camera.x, camera.y);
    ctx.scale(camera.zoom, camera.zoom);
    strokes(ctx, scene.strokes);
    for (const obj of drawOrder(scene)) {
      const t = worldTransform(scene, obj),
        s = screenPoint(t, camera),
        radius = (Math.hypot(t.width, t.height) * camera.zoom) / 2 + 60;
      if (
        s.x + radius < 0 ||
        s.x - radius > width ||
        s.y + radius < 0 ||
        s.y - radius > height
      )
        continue;
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate(t.rotation);
      const shape = isShape(obj) ? shapeOf(obj) : "rectangle";
      const outline = surfacePath(shape, t.width, t.height);
      ctx.shadowColor = "rgba(0,0,0,.38)";
      ctx.shadowBlur = lifted.has(obj.id) ? 24 : 12;
      ctx.shadowOffsetY = lifted.has(obj.id) ? 12 : 5;
      ctx.fillStyle =
        obj.kind === "screen" || obj.kind === "camera" ? "#172320" : obj.color;
      if (obj.kind !== "text") ctx.fill(outline);
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.save();
      ctx.clip(outline);
      const source = this.source(obj, media);
      if (obj.kind === "text") { if (obj.id !== hiddenTextId) paintText(ctx, obj, scene, mood); }
      else if (obj.kind === "audio") {
        const entry = this.audios.get(obj.id), issue = this.fileIssue(obj);
        audioTile(ctx, obj, t.width, t.height, issue ?? entry?.playError ?? (obj.paused !== false ? "Audio · paused" : "Audio · playing"), mood);
      }
      else if (source) drawContent(ctx, obj, source, t.width, t.height);
      else if (
        obj.kind === "screen" ||
        obj.kind === "camera" ||
        obj.kind === "video"
      ) {
        mediaPlaceholder(ctx, obj, t.width, t.height, this.fileIssue(obj) ?? (obj.kind === "screen" ? "Screen stopped · reconnect in Live feeds" : obj.kind === "camera" ? "Camera stopped · reconnect in Live feeds" : "Loading video…"), mood);
      } else if (obj.image) mediaPlaceholder(ctx, obj, t.width, t.height, this.fileIssue(obj) ?? "Loading image…", mood);
      else artwork(ctx, obj);
      strokes(ctx, obj.strokes, t);
      if (isShape(obj) && obj.image) {
        ctx.strokeStyle = obj.color;
        ctx.lineWidth = Math.min(t.width, t.height) * 0.08;
        ctx.stroke(outline);
      }
      ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,.14)";
      ctx.lineWidth = 0.7;
      if (obj.kind !== "text") ctx.stroke(outline);
      if (candidate === obj.id) {
        ctx.strokeStyle = "#c4d8ac";
        ctx.lineWidth = 2 / camera.zoom;
        ctx.stroke(surfacePath(shape, t.width - 8, t.height - 8));
      }
      ctx.restore();
    }
    ctx.restore();
    for (const id of selection) {
      const obj = scene.objects.find((o) => o.id === id);
      if (!obj) continue;
      const t = worldTransform(scene, obj),
        points = handlePositions(t, camera);
      ctx.strokeStyle = "#c5d8ad";
      ctx.lineWidth = 1;
      if (!transforms || obj.locked) {
        const p = screenPoint(t, camera);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(t.rotation);
        ctx.stroke(
          surfacePath(
            isShape(obj) ? shapeOf(obj) : "rectangle",
            t.width * camera.zoom + 3,
            t.height * camera.zoom + 3,
          ),
        );
        ctx.restore();
        if (obj.locked) {
          const p = points[0];
          ctx.save(); ctx.translate(p.x + 9, p.y + 9);
          ctx.fillStyle = themePalette(mood).panel;
          ctx.fillRect(-4, -8, 18, 20);
          ctx.strokeStyle = themePalette(mood).accent;
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.roundRect(0, 0, 10, 8, 1.5); ctx.stroke();
          ctx.beginPath(); ctx.arc(5, 0, 3, Math.PI, 0); ctx.stroke(); ctx.restore();
        }
        continue;
      }
      ctx.beginPath();
      for (const [i, p] of [
        points[0],
        points[2],
        points[4],
        points[6],
      ].entries()) {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.stroke();
      if (selection.size === 1 && transforms) {
        ctx.beginPath();
        ctx.moveTo(points[1].x, points[1].y);
        ctx.lineTo(points[8].x, points[8].y);
        ctx.stroke();
        points.forEach((p, i) => {
          if (!visibleHandles(t, camera, obj).includes(i)) return;
          ctx.fillStyle = "#d5e2c1";
          ctx.strokeStyle = "#384b3b";
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          if (i === 8) ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
          else ctx.roundRect(p.x - 3.5, p.y - 3.5, 7, 7, 1.5);
          ctx.fill();
          ctx.stroke();
        });
      }
    }
    const now = performance.now();
    for (let i = 0; i < laser.length; i++) {
      const p = laser[i],
        alpha = Math.max(0, 1 - (now - p.time) / 650);
      if (!alpha) continue;
      const a = screenPoint(p, camera);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = "#f3a18c";
      ctx.lineWidth = 3;
      ctx.shadowColor = "#f68b6a";
      ctx.shadowBlur = 10;
      if (i > 0 && !p.start) {
        const b = screenPoint(laser[i - 1], camera);
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(a.x, a.y);
        ctx.stroke();
      }
      if (i === laser.length - 1) {
        ctx.fillStyle = "#ffe2c5";
        ctx.beginPath();
        ctx.arc(a.x, a.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
    if (widgets) {
      widgets.dice.draw(ctx, camera, mood);
      this.obscureRenderer.draw(
        ctx,
        width,
        height,
        dpr,
        camera,
        widgets.obscure,
        mood,
      );
      drawMeasurement(ctx, camera, widgets.measurement, widgets.grid, mood);
      drawLasso(ctx, camera, widgets.lasso, mood);
    }
    if (marquee) {
      const a = screenPoint(marquee.start, camera), b = screenPoint(marquee.end, camera);
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
      ctx.save();
      const accent = themePalette(mood).accent;
      ctx.fillStyle = withAlpha(accent, 0.10);
      ctx.strokeStyle = withAlpha(accent, 0.85);
      ctx.lineWidth = 1;
      ctx.fillRect(x, y, w, h);
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
      ctx.restore();
    }
    if (hover && pen) {
      const p = screenPoint(hover, camera);
      ctx.strokeStyle = pen.eraser ? "#eef0de" : pen.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(
        p.x,
        p.y,
        Math.max(3, (pen.width * camera.zoom) / 2),
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
  }
}
