import {
  clone,
  marqueeSelection,
  containsSurface,
  createShape,
  isShape,
  copyHierarchy,
  pasteHierarchy,
  applyCrop,
  createSurface,
  deleteSurfaces,
  descendants,
  drawOrder,
  findParent,
  reparent,
  rotate,
  starterScene,
  toLocal,
  toWorld,
  uid,
  worldTransform,
  type Kind,
  type Point,
  type Scene,
  type Stroke,
  type Surface,
  type Transform,
  type ShapeKind,
  type Crop,
  type ImageView,
} from "./model";
import {
  handles,
  handlePositions,
  audioButton,
  Renderer,
  visibleHandles,
  type Camera,
  type LaserPoint,
  type Media,
} from "./render";
import { BrushSampler } from "./brush";
import { defaultText, textBox, textMode, textFonts, textRuns, validText, type TextSettings } from "./text";
import { waitForMediaData } from "./video-source";
import { TableAudio } from "./audio";
import { defaultMood, type Mood } from "./mood";
import { isHexColor } from "./colors.ts";
import { parseSharedTable, playerSceneAllowed, type SharedTable, type Participant, type Presence } from "./room-state";
import { LocalTableStore, tableFile, recoveryFile, readTableFile, type SaveStatus, type StoredTable, type TableSnapshot } from "./table-storage";
import { parseDiceSetup } from "./presets";
import { TableDice, type DiceState } from "./dice";
import {
  defaultGrid,
  defaultObscure,
  simplifyLasso,
  polygonArea,
  type GridSettings,
  type ObscureSettings,
  type ObscureSnapshot,
  type ObscureMode,
  type Measurement,
  type Region,
} from "./table-widgets";
export type Tool =
  "select" | "pen" | "highlighter" | "eraser" | "laser" | "measure" | "obscure";
export type ViewState = {
  storage: SaveStatus;
  loadError: string | null;
  recoveryAvailable: boolean;
  mediaErrors: number;
  tool: Tool;
  color: string;
  thickness: number;
  smoothing: number;
  mood: Mood;
  audioCount: number;
  dice: DiceState;
  grid: GridSettings;
  obscure: ObscureSettings;
  obscureUndo: boolean;
  obscureRedo: boolean;
  measurement: Measurement | null;
  zoom: number;
  selection: Surface[];
  parentName: string | null;
  canUndo: boolean;
  canRedo: boolean;
  objectCount: number;
  candidate: string | null;
  dragging: boolean;
  detaching: boolean;
  streams: number;
  transforms: boolean;
};
type Gesture =
  | { kind: "pan"; start: Point; camera: Camera }
  | { kind: "marquee"; start: Point; end: Point; previous: Set<string>; additive: boolean; moved: boolean; pointerId: number }
  | {
      kind: "move";
      start: Point;
      ids: string[];
      positions: Point[];
      oldParents: (string | null)[];
      before: Scene;
    }
  | {
      kind: "resize" | "rotate";
      id: string;
      handle: number;
      start: Point;
      transform: Transform;
      before: Scene;
    }
  | {
      kind: "stroke";
      surfaceId: string | null;
      stroke: Stroke;
      before: Scene;
      sampler: BrushSampler;
      pointerId: number;
      lastSampleTime: number;
    }
  | { kind: "erase"; surfaceId: string | null; before: Scene; last: Point }
  | { kind: "laser" }
  | { kind: "measure"; previous: Measurement | null; pointerId: number }
  | { kind: "obscure"; region: Region; pointerId: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const editing = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest(
    'input,textarea,select,[contenteditable="true"],[role="dialog"],[role="alertdialog"]',
  );
function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}
export class TableEngine {
  scene: Scene = { objects: [], strokes: [] };
  camera: Camera = { x: 0, y: 0, zoom: 1 };
  selection = new Set<string>();
  tool: Tool = "select";
  color = "#b66b45";
  thickness = 3;
  smoothing = 0.55;
  mood = { ...defaultMood };
  audio: TableAudio;
  dice: TableDice;
  grid = { ...defaultGrid };
  obscure: ObscureSettings = { ...defaultObscure, regions: [] };
  measurement: Measurement | null = null;
  private obscurePast: ObscureSnapshot[] = [];
  private obscureFuture: ObscureSnapshot[] = [];
  candidate: string | null = null;
  gesture: Gesture | null = null;
  media = new Map<string, Media>();
  lasers: LaserPoint[] = [];
  hover: Point | null = null;
  undoStack: Scene[] = [];
  redoStack: Scene[] = [];
  space = false;
  transforms = true;
  editingId: string | null = null;
  private textBefore: Scene | null = null;
  private surfaceColors = new Map<string, string>();
  private textColors = new Map<string, string | null>();
  roomActive = false;
  roomEditable = true;
  roomGM = true;
  roomConnected = true;
  private roomBackup: StoredTable | null = null;
  private roomAccepted: SharedTable | null = null;
  private roomChange: (() => void) | null = null;
  private roomPeers: { person: Participant; presence?: Presence }[] = [];
  private urls = new Set<string>();
  private dirty = true;
  private frame = 0;
  private renderer: Renderer;
  private observer: ResizeObserver;
  private viewWidth = 0;
  private viewHeight = 0;
  private disposed = false;
  storage: SaveStatus = "memory";
  loadError: string | null = null;
  private store: LocalTableStore | null = null;
  private savingEnabled = false;
  private lastSaved = "";
  private storageWarning = false;
  private assets = new Map<string, Blob>();
  constructor(
    public canvas: HTMLCanvasElement,
    private update: (state: ViewState) => void,
    private notify: (message: string) => void,
    private requestEdit: (id: string) => void = () => {},
  ) {
    this.audio = new TableAudio(() => this.emit());
    this.dice = new TableDice((save = true) => this.emit(save));
    this.renderer = new Renderer(canvas, () => this.invalidate(), () => this.mediaChanged(), id => {
      const obj = this.scene.objects.find(o => o.id === id);
      if (obj) { obj.paused = true; this.emit(false); }
    });
    canvas.addEventListener("pointerdown", this.pointerDown);
    canvas.addEventListener("pointermove", this.pointerMove);
    canvas.addEventListener(
      "pointerrawupdate",
      this.pointerRaw as EventListener,
    );
    canvas.addEventListener("pointerup", this.pointerUp);
    canvas.addEventListener("pointercancel", this.pointerCancel);
    canvas.addEventListener("pointerleave", this.pointerLeave);
    canvas.addEventListener("wheel", this.wheel, { passive: false });
    canvas.addEventListener("contextmenu", this.contextMenu);
    window.addEventListener("keydown", this.keyDown);
    window.addEventListener("keyup", this.keyUp);
    window.addEventListener("blur", this.blur);
    window.addEventListener("paste", this.paste);
    window.addEventListener("copy", this.copy);
    canvas.addEventListener("dblclick", this.doubleClick);
    canvas.addEventListener("dragover", this.dragOver);
    canvas.addEventListener("drop", this.drop);
    this.observer = new ResizeObserver(() => {
      const w = canvas.clientWidth,
        h = canvas.clientHeight;
      if (!this.viewWidth) {
        this.viewWidth = w;
        this.viewHeight = h;
        this.fit();
      } else {
        this.camera.x += (w - this.viewWidth) / 2;
        this.camera.y += (h - this.viewHeight) / 2;
        this.viewWidth = w;
        this.viewHeight = h;
      }
      this.invalidate();
    });
    this.observer.observe(canvas);
    document.fonts?.addEventListener("loadingdone", this.fontsChanged);
    this.frame = requestAnimationFrame(this.tick);
    this.emit();
  }
  private tick = () => {
    if (this.disposed) return;
    const now = performance.now();
    if (this.dice.step(now, this.camera, this.viewWidth, this.viewHeight))
      this.dirty = true;
    const hadLaser = this.lasers.length > 0;
    this.lasers = this.lasers.filter((p) => now - p.time < 650);
    if (hadLaser && !this.lasers.length) this.dirty = true;
    if (this.gesture?.kind === "laser" && this.hover) {
      const last = this.lasers.at(-1);
      if (last && now - last.time > 30) {
        this.lasers.push({ ...this.hover, time: now });
      }
    }
    if (
      this.dirty ||
      (this.mood.motion !== "still" &&
        this.mood.amount > 0 &&
        this.mood.speed > 0 &&
        this.mood.variation > 0) ||
      this.media.size ||
      this.lasers.length ||
      this.scene.objects.some((o) => (o.video || o.animated) && !o.paused)
    ) {
      const lifted = new Set(
        this.gesture?.kind === "move" ? this.gesture.ids : [],
      );
      this.renderer.render(
        this.scene,
        this.camera,
        this.tool === "measure" || this.tool === "obscure"
          ? new Set()
          : this.selection,
        this.candidate,
        lifted,
        this.media,
        this.lasers,
        this.hover,
        ["pen", "highlighter", "eraser"].includes(this.tool)
          ? {
              color: this.color,
              width:
                this.tool === "eraser"
                  ? 24
                  : this.thickness * (this.tool === "highlighter" ? 4 : 1),
              eraser: this.tool === "eraser",
            }
          : null,
        this.transforms && this.gesture?.kind !== "marquee",
        this.mood,
        {
          dice: this.dice,
          grid: this.grid,
          measurement: this.measurement,
          obscure: this.obscure,
          lasso: this.gesture?.kind === "obscure" ? this.gesture.region : null,
        },
        this.gesture?.kind === "marquee" && this.gesture.moved ? this.gesture : undefined,
        this.textBefore ? this.editingId : null,
      );
      this.paintRoomPresence();
      this.dirty = false;
    }
    this.frame = requestAnimationFrame(this.tick);
  };
  invalidate() {
    this.dirty = true;
  }
  private mediaChanged() {
    if (this.disposed) return;
    let converted = false;
    for (const obj of this.scene.objects) {
      const video = this.renderer.videos.get(obj.id)?.video;
      if (obj.video && obj.kind === "video" && video && video.readyState >= 2 && !video.error && video.videoWidth === 0 && video.videoHeight === 0 && video.duration > 0) {
        obj.kind = "audio"; obj.audio = obj.video; delete obj.video;
        delete obj.sourceWidth; delete obj.sourceHeight; delete obj.crop;
        obj.paused = true; obj.volume ??= .65; obj.loop ??= false;
        converted = true;
      }
    }
    this.emit(converted);
  }
  private emit(save = true) {
    if (this.disposed) return;
    // A removed live surface must stop capturing, even when removed through undo.
    for (const [id, item] of this.media) {
      if (!this.scene.objects.some((o) => (o.sourceId ?? o.id) === id)) {
        item.stream.getTracks().forEach((t) => t.stop());
        item.video.srcObject = null;
        this.media.delete(id);
      }
    }
    this.renderer.sync(this.scene);
    const selected = this.scene.objects.filter((o) => this.selection.has(o.id));
    const parent =
      selected.length === 1
        ? this.scene.objects.find((o) => o.id === selected[0].parentId)
        : null;
    this.update({
      storage: this.storage,
      loadError: this.loadError,
      recoveryAvailable: !!this.loadError || !!this.store?.hasRecovery,
      mediaErrors: this.renderer.failedMedia(this.scene).length,
      tool: this.tool,
      color: this.color,
      thickness: this.thickness,
      smoothing: this.smoothing,
      mood: { ...this.mood },
      audioCount: this.audio.count + this.scene.objects.filter(o => o.audio).length,
      dice: this.dice.state,
      grid: { ...this.grid },
      obscure: { ...this.obscure },
      obscureUndo: !!this.obscurePast.length,
      obscureRedo: !!this.obscureFuture.length,
      measurement: this.measurement ? structuredClone(this.measurement) : null,
      zoom: this.camera.zoom,
      selection: selected,
      parentName: parent?.name ?? null,
      canUndo: !!this.undoStack.length,
      canRedo: !!this.redoStack.length,
      objectCount: this.scene.objects.length,
      candidate: this.candidate,
      dragging: this.gesture?.kind === "move",
      detaching:
        this.gesture?.kind === "move" &&
        this.gesture.oldParents.some(Boolean) &&
        !this.candidate,
      streams: this.media.size,
      transforms: this.transforms,
    });
    this.invalidate();
    if (save && this.savingEnabled) this.saveLocal();
    if (save && this.roomActive && !this.gesture) this.roomChange?.();
  }
  getRoomTable(): SharedTable {
    return { scene: clone(this.scene), mood: { ...this.mood }, grid: { ...this.grid },
      obscure: { ...structuredClone(this.obscure), gm: false, gmOpacity: .28 } };
  }
  enterRoom(table: SharedTable, change: () => void) {
    if (!this.roomActive) {
      this.roomBackup = this.snapshot();
      this.savingEnabled = false;
      this.roomActive = true;
      this.audio.clear();
      this.media.forEach(media => media.stream.getTracks().forEach(track => track.stop()));
    }
    this.roomChange = change;
    this.applyRoom(table);
  }
  setRoomPermissions(gm: boolean, editable: boolean, connected: boolean) {
    this.roomGM = gm; this.roomEditable = editable; this.roomConnected = connected;
    if (!editable || !connected) { this.cancel(); if (!["select", "laser", "measure"].includes(this.tool)) this.setTool("select"); }
    this.emit(false);
  }
  applyRoom(table: SharedTable) {
    this.cancel();
    this.surfaceColors.clear(); this.textColors.clear();
    this.editingId = null; this.textBefore = null;
    this.scene = clone(table.scene);
    for (const obj of this.scene.objects) if (obj.text) this.ensureTextFonts(obj.text);
    this.mood = { ...table.mood }; this.grid = { ...table.grid };
    this.obscure = { ...structuredClone(table.obscure), gm: this.roomGM && this.obscure.gm, gmOpacity: this.obscure.gmOpacity ?? .28 };
    this.roomAccepted = structuredClone(table);
    this.undoStack = []; this.redoStack = []; this.obscurePast = []; this.obscureFuture = [];
    this.cleanSelection(); this.emit(false);
  }
  acknowledgeRoom(table: SharedTable) { this.roomAccepted = structuredClone(table); }
  leaveRoom() {
    const backup = this.roomBackup;
    this.roomActive = false; this.roomChange = null; this.roomPeers = [];
    this.roomEditable = this.roomGM = this.roomConnected = true;
    this.roomBackup = null; this.roomAccepted = null;
    this.editingId = null; this.textBefore = null;
    this.undoStack = []; this.redoStack = [];
    if (backup) this.restore(backup);
    this.savingEnabled = !this.loadError;
    this.emit(false);
  }
  setRoomPresence(participants: Participant[], entries: Presence[], me: string) {
    this.roomPeers = participants.filter(p => p.id !== me && p.online).map(person => ({ person, presence: entries.find(p => p.id === person.id) }));
    this.invalidate();
  }
  getRoomPresence(): Omit<Presence, "id"> {
    return { selection: [...this.selection].slice(0, 64), laser: this.gesture?.kind === "laser" ? this.hover : null };
  }
  private roomEditAllowed() {
    if (!this.roomActive || this.roomEditable && this.roomConnected) return true;
    this.notify(this.roomConnected ? "The GM has not enabled player editing." : "Reconnecting to the room. Editing will resume when connected.");
    return false;
  }
  private roomManageAllowed() {
    if (!this.roomActive || this.roomGM && this.roomConnected) return true;
    this.notify(this.roomConnected ? "Only the GM can change the room's settings." : "Wait for the room to reconnect.");
    return false;
  }
  private paintRoomPresence() {
    if (!this.roomActive || !this.roomPeers.length) return;
    const ctx = this.canvas.getContext("2d")!, dpr = devicePixelRatio || 1;
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = "12px system-ui"; ctx.lineWidth = 2;
    for (const { person, presence } of this.roomPeers) {
      ctx.strokeStyle = person.color; ctx.fillStyle = person.color;
      for (const id of presence?.selection ?? []) {
        const obj = this.scene.objects.find(o => o.id === id); if (!obj) continue;
        const t = worldTransform(this.scene, obj), x = t.x * this.camera.zoom + this.camera.x, y = t.y * this.camera.zoom + this.camera.y;
        ctx.save(); ctx.translate(x, y); ctx.rotate(t.rotation);
        ctx.setLineDash([5, 4]); ctx.strokeRect(-t.width * this.camera.zoom / 2 - 4, -t.height * this.camera.zoom / 2 - 4, t.width * this.camera.zoom + 8, t.height * this.camera.zoom + 8);
        ctx.setLineDash([]); ctx.fillText(person.name, -t.width * this.camera.zoom / 2, -t.height * this.camera.zoom / 2 - 10); ctx.restore();
      }
      if (presence?.laser) {
        const x = presence.laser.x * this.camera.zoom + this.camera.x, y = presence.laser.y * this.camera.zoom + this.camera.y;
        ctx.shadowColor = person.color; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0; ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.stroke();
        ctx.fillText(person.name, x + 17, y - 12);
      }
    }
    ctx.restore();
  }
  async restoreLocal() {
    if (this.roomActive) { this.notify("Leave the room to reopen your local table."); return; }
    if (this.store) await this.store.close();
    this.savingEnabled = false;
    this.loadError = null;
    this.storage = "loading";
    this.emit(false);
    try {
      this.store = new LocalTableStore((status) => { this.storage = status; this.emit(false); });
      const saved = await this.store.read();
      if (this.disposed) return;
      if (saved) this.restore(saved);
      this.savingEnabled = true;
      this.storage = "saved";
      this.emit();
      if (this.store.recoveryNotice) this.notify(this.store.recoveryNotice);
    } catch (error) {
      this.loadError = error instanceof Error ? error.message : "Local storage could not be opened. Automatic saving is paused.";
      this.storage = "error";
      this.emit(false);
    }
  }
  private snapshot(): StoredTable {
    const scene = clone(this.gesture && "before" in this.gesture ? this.gesture.before : this.scene);
    const assets: StoredTable["assets"] = [];
    const used = new Set<string>();
    for (const object of scene.objects) {
      for (const field of ["video", "audio"] as const) {
        const ref = object[field]; if (!ref) continue;
        const blob = this.assets.get(ref);
        if (!blob) throw new Error("A media file is unavailable. Replace it before saving this table.");
        if (!used.has(ref)) { used.add(ref); assets.push({ key: ref, blob }); }
        object[field] = `asset:${ref}`;
      }
      if (object.audio) object.paused = true;
    }
    const snapshot: TableSnapshot = {
      version: 1, scene, mood: { ...this.mood },
      dice: { ...this.dice.setup(), enabled: this.dice.state.enabled, sound: this.dice.state.sound, activeGroup: this.dice.state.activeGroup, history: structuredClone(this.dice.state.history) },
      grid: { ...this.grid }, obscure: structuredClone(this.obscure),
      measurement: this.measurement ? structuredClone(this.measurement) : null,
      camera: { ...this.camera, width: this.viewWidth, height: this.viewHeight },
      pen: { color: this.color, thickness: this.thickness, smoothing: this.smoothing, transforms: this.transforms },
    };
    return { snapshot, assets };
  }
  private saveLocal() {
    if (!this.store || this.disposed) return;
    try {
      const saved = this.snapshot(), signature = JSON.stringify(saved.snapshot);
      if (signature === this.lastSaved) return;
      this.lastSaved = signature;
      void this.store.save(saved).catch((error) => { this.lastSaved = ""; this.saveFailed(error); });
    } catch (error) { this.saveFailed(error); }
  }
  private saveFailed(error?: unknown) {
    this.storage = "error";
    this.emit(false);
    if (!this.storageWarning) {
      this.storageWarning = true;
      this.notify(`${error instanceof Error ? error.message : "The table could not be saved locally."} Export a table file to keep your work.`);
    }
  }
  private restore(saved: StoredTable) {
    const snapshot = saved.snapshot, scene = clone(snapshot.scene), sources = new Map<string, string>();
    for (const { key, blob } of saved.assets) {
      const url = URL.createObjectURL(blob);
      this.urls.add(url); this.assets.set(url, blob); sources.set(key, url);
    }
    for (const object of scene.objects) for (const field of ["video", "audio"] as const) if (object[field]) object[field] = sources.get(object[field]!.slice(6))!;
    this.scene = scene;
    for (const obj of scene.objects) if (obj.text) this.ensureTextFonts(obj.text);
    this.selection.clear();
    this.mood = { ...snapshot.mood };
    this.dice.applySetup(parseDiceSetup(snapshot.dice)!);
    this.dice.setSound(snapshot.dice.sound);
    this.dice.toggle(snapshot.dice.enabled);
    this.dice.selectGroup(snapshot.dice.activeGroup);
    this.dice.state = { ...this.dice.state, history: structuredClone(snapshot.dice.history), result: snapshot.dice.history[0] ?? null };
    this.grid = { ...snapshot.grid };
    this.obscure = structuredClone(snapshot.obscure);
    this.obscurePast = []; this.obscureFuture = [];
    this.measurement = snapshot.measurement ? structuredClone(snapshot.measurement) : null;
    this.viewWidth = this.canvas.clientWidth; this.viewHeight = this.canvas.clientHeight;
    this.camera = { x: snapshot.camera.x + (this.viewWidth - snapshot.camera.width) / 2, y: snapshot.camera.y + (this.viewHeight - snapshot.camera.height) / 2, zoom: snapshot.camera.zoom };
    Object.assign(this, snapshot.pen);
    this.tool = "select";
    this.renderer.sync(this.scene);
  }
  async exportTable() {
    try {
      const data = await tableFile(this.snapshot()), url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `Table Goblin ${new Date().toISOString().slice(0, 10)}.goblin.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      this.notify("Table file exported, including imported images, videos and audio.");
    } catch { this.notify("Could not export the table. Check that its media is available."); }
  }
  async exportSavedTable() {
    try {
      if (!this.store) throw new Error("Local storage is unavailable.");
      const original = await this.store.readOriginal(!this.loadError && this.store.hasRecovery);
      if (original === undefined) throw new Error("No saved table was found.");
      const data = await recoveryFile(original), url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `Table Goblin ${new Date().toISOString().slice(0, 10)}.recovery.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      this.notify("Original saved data exported for recovery. The browser copy has not been changed.");
    } catch (error) { this.notify(error instanceof Error ? error.message : "Could not export the original saved table."); }
  }
  async importTable(file: File) {
    try {
      const saved = await readTableFile(file);
      if (this.disposed) return;
      if (this.roomActive) {
        if (!this.roomManageAllowed()) return;
        const table = parseSharedTable(saved.snapshot);
        if (!table) { this.notify("This room can import shapes, text, drawings and PNG/JPG/WebP/GIF artwork. Remove video and audio sources from the file first."); return; }
        if ((this.scene.objects.length || this.scene.strokes.length) && !window.confirm("Replace the room table with this file? Everyone in the room will see the imported table.")) return;
        this.applyRoom(table); this.emit(); this.notify("Table imported into the room. Your local table is unchanged."); return;
      }
      if ((this.scene.objects.length || this.scene.strokes.length) && !window.confirm("Replace the current table with this file? Export your current table first if you want to keep a separate copy.")) return;
      this.cancel();
      const previous = clone(this.scene), wasEnabled = this.savingEnabled;
      this.savingEnabled = false;
      this.media.forEach((m) => { m.stream.getTracks().forEach((t) => t.stop()); m.video.srcObject = null; });
      this.media.clear();
      this.restore(saved);
      this.loadError = null;
      this.undoStack.push(previous); this.redoStack = [];
      this.savingEnabled = wasEnabled || !!this.store;
      this.emit();
      this.notify("Table imported. Undo restores the previous objects.");
    } catch (error) { this.notify(error instanceof Error ? error.message : "Could not read this table file."); }
  }
  private screen(e: { clientX: number; clientY: number }): Point {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  private world(p: Point): Point {
    return {
      x: (p.x - this.camera.x) / this.camera.zoom,
      y: (p.y - this.camera.y) / this.camera.zoom,
    };
  }
  private hit(p: Point, includeLocked = true): Surface | undefined {
    return drawOrder(this.scene)
      .reverse()
      .find((o) => (includeLocked || !o.locked) && containsSurface(p, o, worldTransform(this.scene, o)));
  }
  private commit(before: Scene) {
    if (this.roomActive && (!this.roomEditAllowed() || (!this.roomGM && !playerSceneAllowed(before, this.scene)))) {
      this.scene = before; this.cleanSelection(); this.emit(false); return;
    }
    if (this.roomActive && !parseSharedTable(this.getRoomTable())) {
      this.scene = before; this.cleanSelection(); this.emit(false);
      this.notify("Rooms currently support shapes, text, drawings and PNG/JPG/WebP/GIF images. Video and audio sharing will follow."); return;
    }
    if (JSON.stringify(before) !== JSON.stringify(this.scene)) {
      this.undoStack.push(before);
      if (this.undoStack.length > 80) this.undoStack.shift();
      this.redoStack = [];
    }
    this.emit();
  }
  private setWorld(obj: Surface, t: Transform) {
    if (obj.locked) return;
    const parent = this.scene.objects.find((o) => o.id === obj.parentId);
    if (parent) {
      const p = worldTransform(this.scene, parent),
        local = toLocal(t, p);
      obj.x = local.x;
      obj.y = local.y;
      obj.rotation = t.rotation - p.rotation;
    } else {
      obj.x = t.x;
      obj.y = t.y;
      obj.rotation = t.rotation;
    }
    obj.width = t.width;
    obj.height = t.height;
  }
  setTool(tool: Tool) {
    if (!["select", "laser", "measure"].includes(tool) && !this.roomEditAllowed()) return;
    if (tool === "obscure" && !this.roomManageAllowed()) return;
    this.cancel();
    this.tool = tool;
    this.canvas.style.cursor =
      tool === "select"
        ? "default"
        : ["laser", "measure", "obscure"].includes(tool)
          ? "crosshair"
          : "none";
    this.emit();
  }
  setColor(color: string) {
    this.color = color;
    this.emit();
  }
  setGrid(patch: Partial<GridSettings>) {
    if (!this.roomManageAllowed()) return;
    this.cancel();
    this.grid = { ...this.grid, ...patch };
    this.grid.size = Math.max(12, Math.min(240, this.grid.size));
    this.grid.units = Math.max(0.001, Math.min(1e6, this.grid.units));
    this.grid.angle = Math.max(-180, Math.min(180, this.grid.angle));
    this.grid.opacity = Math.max(0, Math.min(1, this.grid.opacity));
    this.grid.unit = this.grid.unit.slice(0, 24);
    if (!this.grid.enabled && this.tool === "measure") this.setTool("select");
    this.emit();
  }
  clearMeasurement() {
    this.cancel();
    this.measurement = null;
    this.emit();
  }
  setObscure(patch: Partial<Pick<ObscureSettings, "enabled" | "gm" | "gmOpacity" | "mode">>) {
    if (!this.roomManageAllowed()) return;
    this.cancel();
    if (patch.gmOpacity !== undefined) {
      patch = { ...patch };
      if (Number.isFinite(patch.gmOpacity)) patch.gmOpacity = Math.max(0, Math.min(1, patch.gmOpacity!));
      else delete patch.gmOpacity;
    }
    this.obscure = { ...this.obscure, ...patch };
    if (!this.obscure.enabled && this.tool === "obscure")
      this.setTool("select");
    this.emit();
  }
  private changeObscure(covered: boolean, regions: Region[]) {
    if (!this.roomManageAllowed()) return;
    if (
      covered === this.obscure.covered &&
      !regions.length &&
      !this.obscure.regions.length
    )
      return;
    this.obscurePast.push({
      covered: this.obscure.covered,
      regions: this.obscure.regions,
    });
    if (this.obscurePast.length > 80) this.obscurePast.shift();
    this.obscureFuture = [];
    this.obscure = {
      ...this.obscure,
      covered,
      regions,
      revision: this.obscure.revision + 1,
    };
    this.emit();
  }
  resetObscure(covered: boolean) {
    this.cancel();
    this.changeObscure(covered, []);
  }
  undoObscure(redo = false) {
    if (!this.roomManageAllowed()) return;
    this.cancel();
    const from = redo ? this.obscureFuture : this.obscurePast,
      to = redo ? this.obscurePast : this.obscureFuture,
      next = from.pop();
    if (!next) return;
    to.push({ covered: this.obscure.covered, regions: this.obscure.regions });
    this.obscure = {
      ...this.obscure,
      ...next,
      revision: this.obscure.revision + 1,
    };
    this.emit();
  }
  rollDice() {
    this.dice.roll(this.camera, this.viewWidth, this.viewHeight, this.mood);
  }
  setThickness(width: number) {
    this.thickness = width;
    this.emit();
  }
  setSmoothing(value: number) {
    this.smoothing = Math.max(0, Math.min(1, value));
    this.emit();
  }
  setMood(patch: Partial<Mood>, preview = false) {
    if (!this.roomManageAllowed()) return;
    patch = { ...patch };
    if (patch.campfireColor !== undefined && !isHexColor(patch.campfireColor))
      delete patch.campfireColor;
    if (patch.canopyColor !== undefined && !isHexColor(patch.canopyColor))
      delete patch.canopyColor;
    this.mood = { ...this.mood, ...patch };
    this.mood.hue = Math.max(0, Math.min(360, this.mood.hue));
    this.mood.saturation = Math.max(0, Math.min(100, this.mood.saturation));
    this.mood.lightness = Math.max(0, Math.min(100, this.mood.lightness));
    this.mood.gradient = Math.max(0, Math.min(1, this.mood.gradient));
    this.mood.texture = Math.max(0, Math.min(1, this.mood.texture));
    this.mood.amount = Math.max(0, Math.min(4, this.mood.amount));
    this.mood.speed = Math.max(0, Math.min(2, this.mood.speed));
    this.mood.spread = Math.max(0.25, Math.min(2, this.mood.spread));
    this.mood.variation = Math.max(0, Math.min(2, this.mood.variation));
    this.emit(!preview);
  }
  toggleTransforms() {
    this.cancel();
    this.transforms = !this.transforms;
    this.emit();
  }
  setSurfaceColor(color: string, preview = false) {
    if (!this.roomEditAllowed()) return;
    if (!isHexColor(color)) return;
    this.cancel();
    const targets = this.scene.objects.filter(o => isShape(o) &&
      (this.surfaceColors.size ? this.surfaceColors.has(o.id) : this.selection.has(o.id)));
    if (preview) {
      targets.forEach(o => { if (!this.surfaceColors.has(o.id)) this.surfaceColors.set(o.id, o.color); o.color = color; });
      this.emit(false);
    } else {
      const before = clone(this.scene);
      before.objects.forEach(o => { const original = this.surfaceColors.get(o.id); if (original !== undefined) o.color = original; });
      targets.forEach(o => { o.color = color; });
      this.surfaceColors.clear();
      this.commit(before);
    }
  }
  setTextColor(id: string, color: string | null, preview = false) {
    if (!this.roomEditAllowed()) return;
    if (color !== null && !isHexColor(color)) return;
    const obj = this.scene.objects.find(o => o.id === id && o.kind === "text" && !o.locked);
    if (!obj?.text) { this.textColors.delete(id); return; }
    if (preview) {
      if (!this.textBefore && !this.textColors.has(id)) this.textColors.set(id, obj.text.color);
      obj.text.color = color;
      this.emit(false);
    } else {
      const before = this.textBefore ? null : clone(this.scene);
      if (before && this.textColors.has(id)) before.objects.find(o => o.id === id)!.text!.color = this.textColors.get(id)!;
      obj.text.color = color;
      this.textColors.delete(id);
      if (before) this.commit(before); else this.emit();
    }
  }
  addShape(shape: ShapeKind, color = "#acbf9b") {
    this.cancel();
    const before = clone(this.scene);
    const obj = createShape(
      shape,
      this.world({ x: this.viewWidth / 2, y: this.viewHeight / 2 }),
    );
    obj.color = color;
    this.scene.objects.push(obj);
    this.selection = new Set([obj.id]);
    this.tool = "select";
    this.canvas.style.cursor = "default";
    this.commit(before);
    return obj;
  }
  edit(id: string) {
    if (!this.roomEditAllowed()) return;
    if (this.editingId === id) return;
    if (this.editingId) this.closeEditor();
    this.cancel();
    const obj = this.scene.objects.find((o) => o.id === id);
    if (obj?.locked) { this.notify(obj.kind === "text" ? "Unlock this text to edit it." : "Unlock this surface to edit its artwork or crop."); return; }
    if (
      obj &&
      (obj.kind === "text" || obj.image || obj.video || obj.kind === "screen" || obj.kind === "camera")
    ) {
      this.editingId = id;
      if (obj.kind === "text") this.textBefore = clone(this.scene);
      this.selection = new Set([id]);
      this.emit();
      this.requestEdit(id);
    }
  }
  closeEditor() {
    const before = this.textBefore;
    this.textBefore = null;
    const text = this.scene.objects.find(o => o.id === this.editingId && o.kind === "text");
    // Empty text is removed on finishing; Undo still restores an existing note.
    if (text && !text.text?.content.trim()) deleteSurfaces(this.scene, new Set([text.id]));
    this.editingId = null;
    this.cleanSelection();
    if (before && JSON.stringify(before) !== JSON.stringify(this.scene)) this.commit(before);
    else this.emit();
  }
  addText() {
    const before = clone(this.scene);
    const obj = this.add("text");
    this.undoStack.pop(); // Creation and its first typing session are one undoable action.
    this.edit(obj.id);
    this.textBefore = before;
    return obj;
  }
  saveText(id: string, text: TextSettings, width: number, record = true) {
    if (!this.roomEditAllowed()) return;
    const obj = this.scene.objects.find(o => o.id === id && o.kind === "text" && !o.locked);
    if (!obj || !validText(text) || !Number.isFinite(width)) return;
    const before = clone(this.scene);
    const transform = worldTransform(this.scene, obj), anchor = toWorld({ x: -.5, y: -.5 }, transform);
    obj.text = structuredClone(text);
    const box = textBox(text, Math.max(60, Math.min(2400, width)), this.canvas.getContext("2d")!);
    // Keep the text's upper-left local anchor steady while typing or changing its font.
    const offset = rotate({ x: box.width / 2, y: box.height / 2 }, transform.rotation);
    this.setWorld(obj, { ...box, x: anchor.x + offset.x, y: anchor.y + offset.y, rotation: transform.rotation });
    obj.name = text.content.trim().split(/\r?\n/)[0].slice(0, 80) || "Text";
    if (JSON.stringify(before) !== JSON.stringify(this.scene)) {
      if (this.textBefore && this.editingId === id) this.emit();
      else if (record) this.commit(before);
      else this.emit();
    }
    this.ensureTextFonts(text);
  }
  private ensureTextFonts(t: TextSettings) {
    const family = textFonts[t.font].family.split(",")[0];
    if (!["sans", "serif", "classic", "mono", "rounded", "handwritten"].includes(t.font)) {
      const variants = new Set(textRuns(t).map(r => `${r.style.italic ? "italic " : ""}${r.style.bold ? "700" : "400"} 28px ${family}`));
      if (!variants.size) variants.add(`28px ${family}`);
      variants.forEach(font => { void document.fonts.load(font).catch(() => {}); });
    }
  }
  private fontsChanged = () => {
    let changed = false;
    for (const obj of this.scene.objects) if (obj.kind === "text" && obj.text) {
      const box = textBox(obj.text, obj.width, this.canvas.getContext("2d")!);
      if (Math.abs(box.width - obj.width) > .1 || Math.abs(box.height - obj.height) > .1) {
        this.saveText(obj.id, obj.text, obj.width, false); changed = true;
      }
    }
    if (!changed) { this.invalidate(); this.emit(false); }
  };
  getSource(obj: Surface) {
    return this.renderer.source(obj, this.media);
  }
  getMediaIssue(obj: Surface) { return this.renderer.fileIssue(obj); }
  saveImageView(id: string, view: ImageView) {
    const obj = this.scene.objects.find((o) => o.id === id);
    if (!obj || obj.locked) return;
    const before = clone(this.scene);
    obj.imageView = { ...view };
    this.commit(before);
  }
  saveCrop(id: string, crop: Crop) {
    const obj = this.scene.objects.find((o) => o.id === id);
    if (!obj || obj.locked) return;
    const before = clone(this.scene);
    applyCrop(obj, crop);
    this.commit(before);
  }
  togglePlayback(id: string) {
    const obj = this.scene.objects.find((o) => o.id === id);
    if (!obj) return;
    const issue = obj.audio ? this.renderer.fileIssue(obj) : null;
    if (issue) { this.notify(`${obj.filename ?? obj.name}: ${issue}. Remove this object and try another file.`); return; }
    const before = clone(this.scene);
    obj.paused = !obj.paused;
    this.commit(before);
  }
  setFileAudio(id: string, patch: { volume?: number; loop?: boolean }) {
    const obj = this.scene.objects.find(o => o.id === id && o.kind === "audio");
    if (!obj) return;
    const before = clone(this.scene);
    if (patch.volume !== undefined) obj.volume = Math.max(0, Math.min(1, patch.volume));
    if (patch.loop !== undefined) obj.loop = patch.loop;
    this.commit(before);
  }
  restartAudio(id: string) {
    const obj = this.scene.objects.find(o => o.id === id && o.kind === "audio");
    if (!obj) return;
    const before = clone(this.scene), entry = this.renderer.audios.get(id);
    if (entry) entry.audio.currentTime = 0;
    obj.paused = false; this.commit(before);
  }
  stopAllAudio() {
    this.audio.clear();
    const before = clone(this.scene);
    for (const obj of this.scene.objects) if (obj.audio) {
      obj.paused = true;
      const entry = this.renderer.audios.get(obj.id); if (entry) entry.audio.currentTime = 0;
    }
    this.commit(before);
  }
  findUnavailableMedia() {
    const failed = this.renderer.failedMedia(this.scene);
    const selected = failed.findIndex(o => this.selection.has(o.id));
    const next = failed[(selected + 1) % failed.length];
    if (!next) { this.notify("No unavailable media found."); return; }
    this.locate(next.id);
    this.notify(`${next.name}: ${next.reason}. Right-click for object actions or press Delete to remove.`);
  }
  removeArt(id: string) {
    const obj = this.scene.objects.find((o) => o.id === id);
    if (!obj || !isShape(obj)) return;
    const before = clone(this.scene);
    delete obj.image;
    delete obj.imageView;
    delete obj.animated;
    delete obj.crop;
    this.commit(before);
  }
  setLocked(locked: boolean, ids = this.selection) {
    if (!this.roomManageAllowed()) return;
    this.cancel();
    const objects = this.scene.objects.filter(o => ids.has(o.id));
    if (!objects.some(o => !!o.locked !== locked)) return;
    const before = clone(this.scene);
    for (const obj of objects) obj.locked = locked;
    if (locked) this.selection = new Set([...this.selection].filter(id => !objects.some(o => o.id === id)));
    this.commit(before);
  }
  duplicate(ids = this.selection) {
    const content = copyHierarchy(this.scene, ids);
    if (content.length) this.placeCopies(content, { x: 28, y: 28 });
  }
  private placeCopies(content: Surface[], offset?: Point) {
    this.cancel();
    const before = clone(this.scene);
    if (!offset) {
      const roots = content.filter((o) => !o.parentId);
      const center = {
        x: roots.reduce((s, o) => s + o.x, 0) / roots.length,
        y: roots.reduce((s, o) => s + o.y, 0) / roots.length,
      };
      const p =
        this.hover ??
        this.world({ x: this.viewWidth / 2, y: this.viewHeight / 2 });
      offset = { x: p.x - center.x + 24, y: p.y - center.y + 24 };
    }
    for (const obj of content) if (obj.audio) obj.paused = true;
    this.selection = new Set(pasteHierarchy(this.scene, content, offset));
    this.tool = "select";
    this.commit(before);
  }
  undo() {
    if (!this.roomEditAllowed()) return;
    this.cancel();
    const scene = this.undoStack.pop();
    if (scene) {
      this.redoStack.push(clone(this.scene));
      this.scene = scene;
      this.cleanSelection();
      this.emit();
    }
  }
  redo() {
    if (!this.roomEditAllowed()) return;
    this.cancel();
    const scene = this.redoStack.pop();
    if (scene) {
      this.undoStack.push(clone(this.scene));
      this.scene = scene;
      this.cleanSelection();
      this.emit();
    }
  }
  private cleanSelection() {
    this.selection = new Set(
      [...this.selection].filter((id) =>
        this.scene.objects.some((o) => o.id === id),
      ),
    );
  }
  delete(ids = this.selection) {
    ids = new Set([...ids].filter(id => !this.scene.objects.find(o => o.id === id)?.locked));
    if (!ids.size) return;
    this.cancel();
    const before = clone(this.scene);
    deleteSurfaces(this.scene, ids);
    this.cleanSelection();
    this.commit(before);
  }
  reset(empty = true) {
    this.cancel();
    const before = clone(this.scene);
    this.scene = empty ? { objects: [], strokes: [] } : starterScene();
    this.selection.clear();
    this.commit(before);
    this.fit();
    this.notify(
      empty
        ? "A fresh, empty table. Undo brings everything back."
        : "Sample table restored.",
    );
  }
  add(kind: Kind, p?: Point) {
    this.cancel();
    const before = clone(this.scene);
    const obj = createSurface(
      kind,
      p ?? this.world({ x: this.viewWidth / 2, y: this.viewHeight / 2 }),
    );
    if (kind === "text") {
      obj.text = { ...defaultText }; obj.name = "Text"; obj.width = 300;
      Object.assign(obj, textBox(obj.text, obj.width, this.canvas.getContext("2d")!));
      this.ensureTextFonts(obj.text);
    }
    this.scene.objects.push(obj);
    this.selection = new Set([obj.id]);
    this.tool = "select";
    this.canvas.style.cursor = "default";
    this.commit(before);
    return obj;
  }
  async addImages(files: File[], p?: Point, maskSelection = false) {
    const target =
      maskSelection && this.selection.size === 1
        ? this.scene.objects.find((o) => this.selection.has(o.id) && isShape(o) && !o.locked)
        : undefined;
    const valid = files.filter((f) => f.type.startsWith("image/"));
    if (!valid.length) {
      this.notify("Drop an image file to place it on the table.");
      return;
    }
    const base =
      p ??
      this.hover ??
      this.world({ x: this.viewWidth / 2, y: this.viewHeight / 2 });
    for (const [i, file] of valid.entries()) {
      try {
        const data = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.onerror = reject;
          r.readAsDataURL(file);
        });
        const img = new Image();
        img.src = data;
        await img.decode();
        if (!(img.naturalWidth > 0) || !(img.naturalHeight > 0)) throw new Error("Image has no readable dimensions.");
        if (this.disposed) return;
        const before = clone(this.scene);
        if (
          target &&
          i === 0 &&
          this.scene.objects.some((o) => o.id === target.id)
        ) {
          const current = this.scene.objects.find((o) => o.id === target.id)!;
          current.image = data;
          current.imageView = { x: 0, y: 0, zoom: 1 };
          current.animated = file.type === "image/gif";
          current.sourceWidth = img.naturalWidth;
          current.sourceHeight = img.naturalHeight;
          delete current.artwork;
          delete current.crop;
          this.selection = new Set([current.id]);
          this.commit(before);
          this.notify(
            "Art fitted to the shape. Double-click to adjust its framing.",
          );
          continue;
        }
        const obj = createSurface("image", {
          x: base.x + i * 26,
          y: base.y + i * 26,
        });
        const scale = Math.min(
          1,
          500 / img.naturalWidth,
          400 / img.naturalHeight,
        );
        obj.width = img.naturalWidth * scale;
        obj.height = img.naturalHeight * scale;
        obj.image = data;
        obj.sourceWidth = img.naturalWidth;
        obj.sourceHeight = img.naturalHeight;
        obj.animated = file.type === "image/gif";
        obj.name =
          file.name === "image.png"
            ? "Pasted image"
            : file.name.replace(/\.[^.]+$/, "");
        this.scene.objects.push(obj);
        this.selection = new Set([obj.id]);
        this.tool = "select";
        this.canvas.style.cursor = "default";
        this.commit(before);
      } catch {
        this.notify(
          `Could not read ${file.name}. Try a PNG, JPG, WebP, or SVG.`,
        );
      }
    }
    if (!target)
      this.notify(
        valid.length === 1
          ? "Image placed. Pick it up and put it anywhere."
          : `${valid.length} images placed.`,
      );
  }
  async addFiles(files: File[], p?: Point, maskSelection = false) {
    if (!this.roomEditAllowed()) return;
    if (this.roomActive) {
      if (files.some(f => !/^image\/(png|jpeg|webp|gif)$/.test(f.type))) this.notify("Online rooms currently accept PNG, JPG, WebP and GIF images. Video and audio sharing will follow.");
      files = files.filter(f => /^image\/(png|jpeg|webp|gif)$/.test(f.type));
      if (files.reduce((n, f) => n + f.size, 0) > 5 * 1024 * 1024) { this.notify("Choose images under 5 MB total for this room playtest."); return; }
    }
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length) await this.addImages(images, p, maskSelection);
    for (const [index, file] of files.filter(
      (f) => /^(video|audio)\//.test(f.type) || /\.(mp4|webm|mp3|wav|m4a|ogg|oga|opus|aac|flac)$/i.test(f.name),
    ).entries()) {
      const url = URL.createObjectURL(file),
        video = document.createElement("video");
      this.urls.add(url);
      const suffix = file.name.split(".").at(-1)?.toLowerCase();
      const formats: Record<string, string> = { mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", aac: "audio/aac", flac: "audio/flac" };
      this.assets.set(url, new Blob([file], { type: /^(video|audio)\//.test(file.type) ? file.type : formats[suffix ?? ""] ?? "video/mp4" }));
      video.muted = true;
      video.src = url;
      try {
        const kind = await waitForMediaData(video);
        if (this.disposed) return;
        const before = clone(this.scene);
        const obj = createSurface(
          kind,
          p ?? this.world({ x: this.viewWidth / 2, y: this.viewHeight / 2 }),
        );
        obj[kind] = url;
        obj.name = file.name.replace(/\.[^.]+$/, "");
        obj.filename = file.name;
        obj.x += index * 26; obj.y += index * 26;
        if (kind === "video") {
          obj.sourceWidth = video.videoWidth; obj.sourceHeight = video.videoHeight;
          obj.width = 480; obj.height = (480 * video.videoHeight) / video.videoWidth; obj.paused = false;
        } else { obj.width = 300; obj.height = 100; obj.paused = true; obj.volume = .65; obj.loop = false; }
        this.scene.objects.push(obj);
        this.selection = new Set([obj.id]);
        this.tool = "select";
        this.commit(before);
        this.notify(kind === "audio" ? "Audio placed. Press Play on the tile; right-click for volume and loop." : "Video placed. Looping, with sound muted.");
      } catch (error) {
        this.urls.delete(url);
        this.assets.delete(url);
        URL.revokeObjectURL(url);
        this.notify(
          `${file.name}: ${error instanceof Error ? error.message : "This media file could not be read."}`,
        );
      } finally {
        video.removeAttribute("src");
        video.load();
      }
    }
    if (
      !images.length &&
      !files.some(
        (f) => /^(video|audio)\//.test(f.type) || /\.(mp4|webm|mp3|wav|m4a|ogg|oga|opus|aac|flac)$/i.test(f.name),
      )
    )
      this.notify("Drop an image, GIF, video or audio file.");
  }
  async addScreen(targetId?: string) {
    if (this.roomActive) { this.notify("Live capture is currently available on local tables. Room streaming will follow."); return; }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      this.notify(
        "Screen sharing needs a browser with capture support, on localhost. Try Chrome or Edge.",
      );
      return;
    }
    let capture: MediaStream | undefined;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      capture = stream;
      await this.connectLive(stream, "screen", stream.getVideoTracks()[0]?.label || "Live screen", targetId);
    } catch (err) {
      capture?.getTracks().forEach((t) => t.stop());
      if (err instanceof DOMException && err.name === "NotAllowedError")
        this.notify("Screen sharing cancelled.");
      else
        this.notify(
          "Could not start capture. Use Chrome or Edge and allow screen sharing.",
        );
    }
  }
  async addCamera(stream: MediaStream, name: string, targetId?: string) {
    if (this.roomActive) { stream.getTracks().forEach(t => t.stop()); this.notify("Camera sharing in rooms will follow."); return; }
    await this.connectLive(stream, "camera", name || stream.getVideoTracks()[0]?.label || "Live camera", targetId);
  }
  private async connectLive(stream: MediaStream, kind: "screen" | "camera", name: string, targetId?: string) {
    const video = document.createElement("video");
    try {
      if (this.disposed) throw new Error("The table has closed.");
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      const track = stream.getVideoTracks()[0];
      if (this.disposed || !track || track.readyState === "ended")
        throw new Error("Source stopped before it could be connected.");
      const target = targetId ? this.scene.objects.find(o => o.id === targetId) : undefined;
      if (targetId && (!target || target.kind !== kind))
        throw new Error("The original surface is no longer available.");
      const obj = target ?? this.add(kind);
      if (!target) obj.width = kind === "camera" ? 420 : 520;
      const key = obj.sourceId ?? obj.id, previous = this.media.get(key);
      const item = { video, stream };
      this.media.set(key, item);
      // Replace only after the new source is playing; cancellation keeps the old feed.
      previous?.stream.getTracks().forEach(t => t.stop());
      if (previous) previous.video.srcObject = null;
      const dimensions = () => {
        if (this.media.get(key) !== item || this.disposed) return;
        // Actual frames take precedence over track settings, which may stay stale
        // when the user resizes a window or switches the browser's shared source.
        const sw = video.videoWidth || track.getSettings().width || 1280;
        const sh = video.videoHeight || track.getSettings().height || 720;
        let changed = false;
        for (const surface of this.scene.objects) {
          if ((surface.sourceId ?? surface.id) !== key) continue;
          if (surface.sourceWidth === sw && surface.sourceHeight === sh) continue;
          const crop = surface.crop ?? { x: 0, y: 0, width: 1, height: 1 };
          surface.sourceWidth = sw;
          surface.sourceHeight = sh;
          if (!surface.locked) surface.height = surface.width * sh * crop.height / (sw * crop.width);
          changed = true;
        }
        if (changed) this.emit();
      };
      // Every copy keeps its placement, crop, name, hierarchy, and drawings.
      if (!target) obj.name = name;
      video.addEventListener("resize", dimensions);
      dimensions();
      track.addEventListener(
        "ended",
        () => {
          // An old source's queued ended event must not remove its replacement.
          if (this.media.get(key) !== item) return;
          this.media.delete(key);
          stream.getTracks().forEach((t) => t.stop());
          video.srcObject = null;
          if (!this.disposed) {
            this.emit();
            this.notify("Live source ended. Select its surface to reconnect.");
          }
        },
        { once: true },
      );
      this.emit();
      this.notify(target ? "Source connected. Crops and drawings were kept." : "Live source placed. Double-click to crop it.");
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      throw err;
    }
  }
  async addDisplayAudio() {
    if (!navigator.mediaDevices?.getDisplayMedia)
      throw new Error(
        "Tab and computer audio capture needs Chrome or Edge on localhost.",
      );
    this.audio.prepare();
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      systemAudio: "include",
    } as DisplayMediaStreamOptions & { systemAudio: string });
    try {
      if (this.disposed) throw new Error("The table has closed.");
      if (!stream.getAudioTracks().length)
        throw new Error(
          "No audio was shared. Choose a tab or entire screen and enable Share audio in the browser picker. Available sources depend on your browser and system.",
        );
      this.audio.add(
        stream,
        stream.getAudioTracks()[0].label || "Tab / computer audio",
        "display",
      );
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      throw err;
    }
  }
  async addInputAudio(deviceId: string) {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error("Audio inputs are unavailable in this browser.");
    this.audio.prepare();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    try {
      if (this.disposed) throw new Error("The table has closed.");
      this.audio.add(
        stream,
        stream.getAudioTracks()[0]?.label || "Audio input",
        "input",
      );
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      throw err;
    }
  }
  stopScreen(id: string) {
    const key = this.scene.objects.find((o) => o.id === id)?.sourceId ?? id;
    const item = this.media.get(key);
    if (item) {
      this.media.delete(key);
      item.stream.getTracks().forEach((t) => t.stop());
      item.video.srcObject = null;
      this.emit();
      this.notify("Live source stopped.");
    }
  }
  selectForContext(point: Point) {
    this.cancel();
    const surface = this.hit(this.world(point));
    if (surface && !this.selection.has(surface.id)) this.selection = new Set([surface.id]);
    this.emit(false);
    return this.selection.size > 0;
  }
  locate(id: string) {
    this.cancel();
    const surface = this.scene.objects.find(o => o.id === id);
    if (!surface) return;
    this.selection = new Set([id]);
    this.tool = "select";
    this.canvas.style.cursor = "default";
    const t = worldTransform(this.scene, surface);
    const c = Math.abs(Math.cos(t.rotation)), s = Math.abs(Math.sin(t.rotation));
    const width = t.width * c + t.height * s, height = t.width * s + t.height * c;
    const zoom = Math.max(0.1, Math.min(this.camera.zoom, (this.viewWidth - 140) / width, (this.viewHeight - 220) / height));
    this.camera = { x: this.viewWidth / 2 - t.x * zoom, y: this.viewHeight / 2 - t.y * zoom, zoom };
    this.emit();
  }
  fit() {
    this.cancel();
    const points = this.scene.objects.flatMap((o) => {
      const t = worldTransform(this.scene, o);
      return handles.filter((_, i) => i % 2 === 0).map((p) => toWorld(p, t));
    });
    if (!points.length) {
      this.camera = { x: this.viewWidth / 2, y: this.viewHeight / 2, zoom: 1 };
    } else {
      const minX = Math.min(...points.map((p) => p.x)),
        maxX = Math.max(...points.map((p) => p.x)),
        minY = Math.min(...points.map((p) => p.y)),
        maxY = Math.max(...points.map((p) => p.y));
      const zoom = Math.max(
        0.1,
        Math.min(
          1.1,
          (this.viewWidth - 170) / (maxX - minX + 100),
          (this.viewHeight - 230) / (maxY - minY + 80),
        ),
      );
      this.camera = {
        x: this.viewWidth / 2 - ((minX + maxX) / 2) * zoom,
        y: this.viewHeight / 2 - ((minY + maxY) / 2) * zoom,
        zoom,
      };
    }
    this.emit();
  }
  zoom(
    factor: number,
    p: Point = { x: this.viewWidth / 2, y: this.viewHeight / 2 },
  ) {
    const w = this.world(p);
    this.camera.zoom = Math.max(0.1, Math.min(4, this.camera.zoom * factor));
    this.camera.x = p.x - w.x * this.camera.zoom;
    this.camera.y = p.y - w.y * this.camera.zoom;
    this.emit();
  }
  private pointerDown = (e: PointerEvent) => {
    if (this.storage === "loading") return;
    if (this.gesture || e.button === 2 || this.editingId) return;
    e.preventDefault();
    this.canvas.focus();
    this.canvas.setPointerCapture(e.pointerId);
    const s = this.screen(e),
      p = this.world(s);
    this.hover = p;
    if (e.button === 1 || this.space) {
      this.gesture = { kind: "pan", start: s, camera: { ...this.camera } };
      this.canvas.style.cursor = "grabbing";
      return;
    }
    if (this.roomActive && (!this.roomEditable || !this.roomConnected) && this.tool === "select") {
      const obj = this.hit(p);
      if (obj) {
        if (!e.shiftKey) this.selection = new Set([obj.id]);
        else if (this.selection.has(obj.id)) this.selection.delete(obj.id); else this.selection.add(obj.id);
        this.emit(false);
      } else {
        this.gesture = { kind: "marquee", start: p, end: p, previous: new Set(this.selection), additive: e.shiftKey, moved: false, pointerId: e.pointerId };
        if (!e.shiftKey) this.selection.clear(); this.emit(false);
      }
      return;
    }
    if (this.tool === "select" && !e.shiftKey) {
      const obj = this.hit(p);
      if (obj?.kind === "audio") {
        const t = worldTransform(this.scene, obj), button = audioButton(obj, t.width, t.height);
        const local = toLocal(p, t);
        if (Math.hypot(local.x * t.width - button.x, local.y * t.height) <= button.radius) {
          this.togglePlayback(obj.id); return;
        }
      }
    }
    if (this.tool === "measure" && this.grid.enabled) {
      this.gesture = {
        kind: "measure",
        previous: this.measurement,
        pointerId: e.pointerId,
      };
      this.measurement = { start: p, end: p };
      this.emit();
      return;
    }
    if (this.tool === "obscure" && this.obscure.enabled) {
      const mode: ObscureMode = e.shiftKey
        ? this.obscure.mode === "reveal"
          ? "cover"
          : "reveal"
        : this.obscure.mode;
      this.gesture = {
        kind: "obscure",
        region: { mode, points: [p] },
        pointerId: e.pointerId,
      };
      this.emit();
      return;
    }
    if (this.tool === "laser") {
      this.gesture = { kind: "laser" };
      this.lasers.push({ ...p, time: performance.now(), start: true });
      this.invalidate();
      return;
    }
    const obj = this.hit(p, this.tool !== "select"),
      before = clone(this.scene);
    if (this.tool === "eraser") {
      this.gesture = {
        kind: "erase",
        surfaceId: obj?.id ?? null,
        before,
        last: p,
      };
      this.eraseAt(p);
      return;
    }
    if (this.tool === "pen" || this.tool === "highlighter") {
      const t = obj ? worldTransform(this.scene, obj) : null;
      const stroke: Stroke = {
        id: uid(),
        points: [t ? toLocal(p, t) : p],
        width: t
          ? (this.thickness * (this.tool === "highlighter" ? 4 : 1)) /
            Math.min(t.width, t.height)
          : this.thickness * (this.tool === "highlighter" ? 4 : 1),
        color: this.color,
        highlight: this.tool === "highlighter",
      };
      (obj ? obj.strokes : this.scene.strokes).push(stroke);
      this.gesture = {
        kind: "stroke",
        surfaceId: obj?.id ?? null,
        stroke,
        before,
        sampler: new BrushSampler(s, e.timeStamp, this.smoothing),
        pointerId: e.pointerId,
        lastSampleTime: e.timeStamp,
      };
      this.selection.clear();
      this.emit();
      return;
    }
    if (this.selection.size === 1 && this.transforms && !this.scene.objects.find(o => this.selection.has(o.id))?.locked) {
      const selected = this.scene.objects.find((o) =>
        this.selection.has(o.id),
      )!;
      const t = worldTransform(this.scene, selected),
        index = handlePositions(t, this.camera).findIndex(
          (h, i) =>
            visibleHandles(t, this.camera, selected).includes(i) && distance(s, h) < 8,
        );
      if (index !== -1) {
        this.gesture = {
          kind: index === 8 ? "rotate" : "resize",
          id: selected.id,
          handle: index,
          start: p,
          transform: t,
          before,
        };
        return;
      }
    }
    if (!obj) {
      this.gesture = { kind: "marquee", start: p, end: p, previous: new Set(this.selection), additive: e.shiftKey, moved: false, pointerId: e.pointerId };
      if (!e.shiftKey) this.selection.clear();
      this.emit(false);
      return;
    }
    if (e.shiftKey) {
      if (this.selection.has(obj.id)) {
        this.selection.delete(obj.id);
        this.emit();
        return;
      }
      this.selection.add(obj.id);
    } else if (!this.selection.has(obj.id)) this.selection = new Set([obj.id]);
    const ids = [...this.selection].filter(
      (id) =>
        !this.scene.objects.find(o => o.id === id)?.locked &&
        !this.scene.objects.some(
          (o) =>
            this.selection.has(o.id) && !o.locked &&
            descendants(this.scene, o.id).includes(id),
        ),
    );
    const moving = ids.map((id) =>
      this.scene.objects.find((o) => o.id === id)!,
    );
    const oldParents = moving.map((o) => o.parentId);
    const positions = moving.map((o) => {
      const w = worldTransform(this.scene, o);
      reparent(this.scene, o, null);
      return { x: w.x, y: w.y };
    });
    this.scene.objects = [
      ...this.scene.objects.filter((o) => !ids.includes(o.id)),
      ...moving,
    ];
    this.gesture = {
      kind: "move",
      start: p,
      ids,
      positions,
      oldParents,
      before,
    };
    this.emit();
  };
  private pointerMove = (e: PointerEvent) => {
    const s = this.screen(e),
      p = this.world(s);
    this.hover = p;
    const g = this.gesture;
    if (!g) {
      if (this.tool === "select") {
        let cursor = "default";
        if (this.selection.size === 1 && this.transforms) {
          const obj = this.scene.objects.find((o) => this.selection.has(o.id));
          if (obj && !obj.locked) {
            const i = handlePositions(
              worldTransform(this.scene, obj),
              this.camera,
            ).findIndex(
              (h, i) =>
                visibleHandles(
                  worldTransform(this.scene, obj),
                  this.camera,
                  obj,
                ).includes(i) && distance(h, s) < 8,
            );
            if (i === 8) cursor = "grab";
            else if (i >= 0) {
              const direction = rotate(
                handles[i],
                worldTransform(this.scene, obj).rotation,
              );
              const octant = Math.round(
                Math.atan2(direction.y, direction.x) / (Math.PI / 4),
              );
              cursor = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"][
                ((octant % 4) + 4) % 4
              ];
            }
          }
        }
        if (cursor === "default" && this.hit(p, false)) cursor = "grab";
        this.canvas.style.cursor = this.space ? "grab" : cursor;
      }
      this.invalidate();
      return;
    }
    if (g.kind === "pan") {
      this.camera.x = g.camera.x + s.x - g.start.x;
      this.camera.y = g.camera.y + s.y - g.start.y;
      this.hover = this.world(s);
      this.invalidate();
      return;
    }
    if (g.kind === "marquee") {
      if (g.pointerId !== e.pointerId) return;
      this.updateMarquee(p);
      return;
    }
    if (g.kind === "laser") {
      this.lasers.push({ ...p, time: performance.now() });
      this.invalidate();
      return;
    }
    if (g.kind === "measure") {
      if (g.pointerId !== e.pointerId) return;
      this.measurement = { start: this.measurement!.start, end: p };
      this.emit();
      return;
    }
    if (g.kind === "obscure") {
      if (g.pointerId !== e.pointerId) return;
      const samples = e.getCoalescedEvents?.() ?? [];
      for (const sample of samples.length ? samples : [e]) {
        const point = this.world(this.screen(sample));
        if (distance(point, g.region.points.at(-1)!) * this.camera.zoom >= 1.5)
          g.region.points.push(point);
      }
      this.invalidate();
      return;
    }
    if (g.kind === "move") {
      g.ids.forEach((id, i) => {
        const o = this.scene.objects.find((o) => o.id === id)!;
        o.x = g.positions[i].x + p.x - g.start.x;
        o.y = g.positions[i].y + p.y - g.start.y;
      });
      const excluded = new Set(
        g.ids.flatMap((id) => [id, ...descendants(this.scene, id)]),
      );
      const next =
        g.ids.length === 1
          ? (findParent(
              this.scene,
              this.scene.objects.find((o) => o.id === g.ids[0])!,
              excluded,
            )?.id ?? null)
          : null;
      if (next !== this.candidate) {
        this.candidate = next;
        this.emit();
      }
      this.invalidate();
      return;
    }
    if (g.kind === "stroke") {
      this.collectStroke(e);
      return;
    }
    if (g.kind === "erase") {
      const steps = Math.ceil(distance(p, g.last) / 8);
      for (let i = 1; i <= steps; i++)
        this.eraseAt({
          x: g.last.x + ((p.x - g.last.x) * i) / steps,
          y: g.last.y + ((p.y - g.last.y) * i) / steps,
        });
      g.last = p;
      this.invalidate();
      return;
    }
    const obj = this.scene.objects.find((o) => o.id === g.id)!;
    const start = g.transform;
    if (g.kind === "rotate") {
      let angle =
        start.rotation +
        Math.atan2(p.y - start.y, p.x - start.x) -
        Math.atan2(g.start.y - start.y, g.start.x - start.x);
      if (e.shiftKey)
        angle = (Math.round(angle / (Math.PI / 12)) * Math.PI) / 12;
      this.setWorld(obj, { ...start, rotation: angle });
    } else {
      const h = handles[g.handle];
      const delta = rotate(
        { x: p.x - g.start.x, y: p.y - g.start.y },
        -start.rotation,
      );
      let width =
        h.x === 0
          ? start.width
          : Math.max(28, start.width + delta.x * Math.sign(h.x));
      let height =
        h.y === 0
          ? start.height
          : Math.max(28, start.height + delta.y * Math.sign(h.y));
      const aspect =
        e.shiftKey || (obj.kind === "text" && obj.text && textMode(obj.text) === "label") ||
        ((obj.kind === "image" ||
          obj.kind === "screen" ||
          obj.kind === "camera" ||
          obj.kind === "video") &&
          !e.altKey);
      if (aspect) {
        const ratio = start.width / start.height;
        if (h.x === 0) width = height * ratio;
        else if (h.y === 0) height = width / ratio;
        else if (
          Math.abs(width - start.width) / start.width >
          Math.abs(height - start.height) / start.height
        )
          height = width / ratio;
        else width = height * ratio;
      }
      if (obj.kind === "text" && obj.text) {
        const originalText = g.before.objects.find(o => o.id === obj.id)!.text!;
        // Labels scale as type. Paragraph handles only change wrapping width.
        if (textMode(obj.text) === "label") obj.text.size = Math.max(8, Math.min(200, originalText.size * width / start.width));
        const box = textBox(obj.text, width, this.canvas.getContext("2d")!);
        width = box.width; height = box.height;
      }
      const anchor = toWorld({ x: -h.x, y: -h.y }, start);
      const offset = rotate(
        { x: h.x * width, y: h.y * height },
        start.rotation,
      );
      this.setWorld(obj, {
        x: anchor.x + offset.x,
        y: anchor.y + offset.y,
        width,
        height,
        rotation: start.rotation,
      });
    }
    this.invalidate();
  };
  private updateMarquee(end: Point) {
    const g = this.gesture;
    if (g?.kind !== "marquee") return;
    g.end = end;
    if (distance(g.start, end) * this.camera.zoom >= 3) g.moved = true;
    this.selection = new Set(g.additive ? [...g.previous].filter(id => !this.scene.objects.find(o => o.id === id)?.locked) : []);
    if (g.moved) for (const id of marqueeSelection(this.scene, g.start, end)) this.selection.add(id);
    this.emit(false);
  }
  private pointerUp = (e: PointerEvent) => {
    const g = this.gesture;
    if (!g) return;
    if (g.kind === "marquee") {
      if (g.pointerId !== e.pointerId) return;
      this.updateMarquee(this.world(this.screen(e)));
    }
    if (g.kind === "measure") {
      if (g.pointerId !== e.pointerId) return;
      this.measurement = {
        start: this.measurement!.start,
        end: this.world(this.screen(e)),
      };
    }
    if (g.kind === "obscure") {
      if (g.pointerId !== e.pointerId) return;
      g.region.points.push(this.world(this.screen(e)));
      const points = simplifyLasso(g.region.points, 1.2 / this.camera.zoom);
      if (
        points.length >= 3 &&
        polygonArea(points) * this.camera.zoom ** 2 > 20
      )
        this.changeObscure(this.obscure.covered, [
          ...this.obscure.regions,
          { mode: g.region.mode, points },
        ]);
    }
    if (g.kind === "stroke") {
      if (g.pointerId !== e.pointerId) return;
      this.appendStroke(g, g.sampler.finish(this.screen(e)));
    }
    if (g.kind === "move") {
      if (
        distance(g.start, this.world(this.screen(e))) * this.camera.zoom <
        3
      ) {
        this.scene = g.before;
      } else {
        const excluded = new Set(
          g.ids.flatMap((id) => [id, ...descendants(this.scene, id)]),
        );
        for (const id of g.ids) {
          const obj = this.scene.objects.find((o) => o.id === id)!;
          const parent = findParent(this.scene, obj, excluded);
          reparent(this.scene, obj, parent?.id ?? null);
        }
      }
    }
    this.gesture = null;
    this.candidate = null;
    if ("before" in g) this.commit(g.before);
    else this.emit();
    this.canvas.style.cursor =
      this.tool === "select"
        ? "default"
        : ["laser", "measure", "obscure"].includes(this.tool)
          ? "crosshair"
          : "none";
    if (this.canvas.hasPointerCapture(e.pointerId))
      this.canvas.releasePointerCapture(e.pointerId);
  };
  private pointerRaw = (e: PointerEvent) => {
    if (this.gesture?.kind === "stroke") this.collectStroke(e);
  };
  private collectStroke(e: PointerEvent) {
    const g = this.gesture;
    if (g?.kind !== "stroke" || g.pointerId !== e.pointerId) return;
    const samples = e.getCoalescedEvents?.() ?? [];
    for (const event of samples.length ? samples : [e]) {
      // Chromium can deliver the same samples in raw-update and pointer-move.
      if (event.timeStamp <= g.lastSampleTime) continue;
      g.lastSampleTime = event.timeStamp;
      this.appendStroke(
        g,
        g.sampler.sample(this.screen(event), event.timeStamp),
      );
    }
    this.invalidate();
  }
  private appendStroke(
    g: Extract<Gesture, { kind: "stroke" }>,
    points: Point[],
  ) {
    const obj = this.scene.objects.find((o) => o.id === g.surfaceId);
    const t = obj ? worldTransform(this.scene, obj) : null;
    for (const s of points) {
      const p = this.world(s);
      g.stroke.points.push(t ? toLocal(p, t) : p);
    }
  }
  private eraseAt(p: Point) {
    const gesture = this.gesture;
    if (gesture?.kind !== "erase") return;
    const obj = this.scene.objects.find((o) => o.id === gesture.surfaceId),
      t = obj ? worldTransform(this.scene, obj) : undefined;
    const list = obj ? obj.strokes : this.scene.strokes;
    const remaining = list.filter((stroke) => {
      const pts = t ? stroke.points.map((p) => toWorld(p, t)) : stroke.points;
      const radius =
        12 +
        (t ? stroke.width * Math.min(t.width, t.height) : stroke.width) / 2;
      return !pts.some(
        (q, i) => segmentDistance(p, q, pts[Math.max(0, i - 1)]) <= radius,
      );
    });
    if (obj) obj.strokes = remaining;
    else this.scene.strokes = remaining;
    this.invalidate();
  }
  private cancel() {
    if (this.gesture?.kind === "marquee") this.selection = new Set(this.gesture.previous);
    if (this.gesture?.kind === "measure")
      this.measurement = this.gesture.previous;
    if (this.gesture && "before" in this.gesture)
      this.scene = this.gesture.before;
    this.gesture = null;
    this.candidate = null;
    this.invalidate();
  }
  private pointerCancel = () => {
    this.cancel();
    this.emit();
  };
  private pointerLeave = () => {
    if (!this.gesture) {
      this.hover = null;
      this.invalidate();
    }
  };
  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    if (this.gesture) return;
    this.zoom(Math.exp(-e.deltaY * 0.0015), this.screen(e));
  };
  private contextMenu = (e: Event) => e.preventDefault();
  private keyDown = (e: KeyboardEvent) => {
    if (this.storage === "loading") return;
    if (editing(e.target) || this.editingId) return;
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === "z") {
      e.preventDefault();
      if (this.tool === "obscure") this.undoObscure(e.shiftKey);
      else if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === "y") {
      e.preventDefault();
      if (this.tool === "obscure") this.undoObscure(true);
      else this.redo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === "d") {
      e.preventDefault();
      this.duplicate();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === "Space") {
      if (e.target instanceof Element && e.target.closest("button")) return;
      e.preventDefault();
      this.space = true;
      this.canvas.style.cursor = "grab";
      return;
    }
    if (key === "delete" || key === "backspace") {
      e.preventDefault();
      this.delete();
      return;
    }
    if (key === "escape") {
      const marquee = this.gesture?.kind === "marquee";
      this.cancel();
      if (!marquee) this.selection.clear();
      this.setTool("select");
      return;
    }
    const keys: Record<string, Tool> = {
      v: "select",
      d: "pen",
      h: "highlighter",
      e: "eraser",
      l: "laser",
    };
    if (this.grid.enabled) keys.m = "measure";
    if (this.obscure.enabled) keys.o = "obscure";
    if (keys[key]) {
      this.setTool(keys[key]);
      return;
    }
    if (key === "home") {
      e.preventDefault();
      this.fit();
    }
    if (key === "t") this.toggleTransforms();
    if (key === "+" || key === "=") this.zoom(1.2);
    if (key === "-") this.zoom(1 / 1.2);
  };
  private keyUp = (e: KeyboardEvent) => {
    if (e.code === "Space") {
      this.space = false;
      this.canvas.style.cursor =
        this.tool === "select"
          ? "default"
          : ["laser", "measure", "obscure"].includes(this.tool)
            ? "crosshair"
            : "none";
    }
  };
  private blur = () => {
    this.space = false;
    this.cancel();
    this.emit();
  };
  private paste = (e: ClipboardEvent) => {
    if (editing(e.target) || this.editingId) return;
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((i) => i.kind === "file")
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length) {
      e.preventDefault();
      void this.addFiles(files, undefined, true);
      return;
    }
    const data =
      e.clipboardData?.getData("application/x-table-goblin") ||
      e.clipboardData?.getData("text/plain") ||
      "";
    const prefix = data.match(/^TABLE_GOBLIN_V1\r?\n/);
    if (prefix) {
      try {
        const content = JSON.parse(data.slice(prefix[0].length)) as Surface[];
        if (!validClipboard(content)) throw new Error("Invalid clipboard");
        e.preventDefault();
        this.placeCopies(content);
        this.notify("Copied surfaces placed, with everything resting on them.");
      } catch {
        this.notify("Could not read these copied surfaces.");
      }
    }
  };
  private copy = (e: ClipboardEvent) => {
    if (editing(e.target) || this.editingId || !this.selection.size) return;
    const content = copyHierarchy(this.scene, this.selection);
    if (!content.length) return;
    const data = "TABLE_GOBLIN_V1\n" + JSON.stringify(content);
    e.preventDefault();
    e.clipboardData?.setData("text/plain", data);
    try {
      e.clipboardData?.setData("application/x-table-goblin", data);
    } catch {}
    this.notify("Copied with all attached surfaces. Ctrl+V to place a copy.");
  };
  private doubleClick = (e: MouseEvent) => {
    if (this.tool !== "select") return;
    const obj = this.hit(this.world(this.screen(e)));
    if (obj?.kind === "audio") this.togglePlayback(obj.id);
    else if (obj) this.edit(obj.id);
  };
  private dragOver = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };
  private drop = (e: DragEvent) => {
    e.preventDefault();
    void this.addFiles(
      Array.from(e.dataTransfer?.files ?? []),
      this.world(this.screen(e)),
    );
  };
  dispose() {
    document.fonts?.removeEventListener("loadingdone", this.fontsChanged);
    if (this.savingEnabled) this.saveLocal();
    this.savingEnabled = false;
    this.disposed = true;
    void this.store?.close();
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.media.forEach((m) => {
      m.stream.getTracks().forEach((t) => t.stop());
      m.video.srcObject = null;
    });
    this.media.clear();
    this.audio.dispose();
    this.dice.dispose();
    this.renderer.dispose();
    this.urls.forEach((url) => URL.revokeObjectURL(url));
    this.urls.clear();
    this.assets.clear();
    this.canvas.removeEventListener("pointerdown", this.pointerDown);
    this.canvas.removeEventListener("pointermove", this.pointerMove);
    this.canvas.removeEventListener(
      "pointerrawupdate",
      this.pointerRaw as EventListener,
    );
    this.canvas.removeEventListener("pointerup", this.pointerUp);
    this.canvas.removeEventListener("pointercancel", this.pointerCancel);
    this.canvas.removeEventListener("pointerleave", this.pointerLeave);
    this.canvas.removeEventListener("wheel", this.wheel);
    this.canvas.removeEventListener("contextmenu", this.contextMenu);
    this.canvas.removeEventListener("dragover", this.dragOver);
    this.canvas.removeEventListener("drop", this.drop);
    window.removeEventListener("keydown", this.keyDown);
    window.removeEventListener("keyup", this.keyUp);
    window.removeEventListener("blur", this.blur);
    window.removeEventListener("paste", this.paste);
    window.removeEventListener("copy", this.copy);
    this.canvas.removeEventListener("dblclick", this.doubleClick);
  }
}

function validClipboard(value: unknown): value is Surface[] {
  if (!Array.isArray(value) || !value.length || value.length > 1000)
    return false;
  const ids = new Set(value.map((o) => o?.id));
  if (ids.size !== value.length) return false;
  const finite = (n: unknown) =>
    typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e7;
  for (const o of value) {
    if (
      typeof o.id !== "string" ||
      typeof o.name !== "string" ||
      ![
        "shape",
        "paper",
        "card",
        "image",
        "screen",
        "camera",
        "video",
        "audio",
        "text",
      ].includes(o.kind) ||
      typeof o.color !== "string" ||
      ![o.x, o.y, o.width, o.height, o.rotation].every(finite) ||
      o.width <= 0 ||
      o.height <= 0 ||
      !Array.isArray(o.strokes)
    )
      return false;
    if ((o.kind === "text" || o.text !== undefined) && !validText(o.text)) return false;
    if (o.parentId !== null && !ids.has(o.parentId)) return false;
    if (
      o.shape &&
      ![
        "rectangle",
        "rounded",
        "circle",
        "triangle",
        "hexagon",
        "diamond",
      ].includes(o.shape)
    )
      return false;
    if (
      o.imageView &&
      (![o.imageView.x, o.imageView.y, o.imageView.zoom].every(finite) ||
        o.imageView.zoom < 1 ||
        o.imageView.zoom > 20)
    )
      return false;
    if (
      o.crop &&
      (![o.crop.x, o.crop.y, o.crop.width, o.crop.height].every(finite) ||
        o.crop.x < 0 ||
        o.crop.y < 0 ||
        o.crop.width <= 0 ||
        o.crop.height <= 0 ||
        o.crop.x + o.crop.width > 1.000001 ||
        o.crop.y + o.crop.height > 1.000001)
    )
      return false;
    const seen = new Set([o.id]);
    let parent = o.parentId;
    while (parent) {
      if (seen.has(parent)) return false;
      seen.add(parent);
      parent = value.find((item) => item.id === parent)?.parentId;
    }
    if (
      o.image &&
      (typeof o.image !== "string" || !o.image.startsWith("data:image/"))
    )
      return false;
    if (
      o.video &&
      (typeof o.video !== "string" || !o.video.startsWith("blob:"))
    )
      return false;
    if (o.audio && (typeof o.audio !== "string" || !o.audio.startsWith("blob:"))) return false;
    if (o.volume !== undefined && (!finite(o.volume) || o.volume < 0 || o.volume > 1)) return false;
    if (o.loop !== undefined && typeof o.loop !== "boolean") return false;
    for (const s of o.strokes) {
      if (
        typeof s.id !== "string" ||
        typeof s.color !== "string" ||
        !finite(s.width) ||
        !Array.isArray(s.points) ||
        !s.points.every((p: Point) => finite(p.x) && finite(p.y))
      )
        return false;
    }
  }
  return true;
}
