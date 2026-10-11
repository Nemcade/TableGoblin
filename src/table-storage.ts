import type { Scene, Point, Stroke, Surface } from "./model";
import type { Mood } from "./mood";
import type { DiceSetup, RollRecord } from "./dice-types";
import type { GridSettings, ObscureSettings, Measurement } from "./table-widgets";
import { parseDiceSetup, parseGrid, parseMood } from "./presets.ts";
import { validText } from "./text.ts";
import { roomImage, inlineRoomArtwork } from "./room-artwork.ts";
import { roomMedia, inlineRoomMedia } from "./room-media.ts";

export type SaveStatus = "memory" | "loading" | "saving" | "saved" | "error";
export type TableSnapshot = {
  version: 1;
  scene: Scene;
  mood: Mood;
  dice: DiceSetup & { enabled: boolean; sound: boolean; activeGroup: string; history: RollRecord[] };
  grid: GridSettings;
  obscure: ObscureSettings;
  measurement: Measurement | null;
  camera: { x: number; y: number; zoom: number; width: number; height: number };
  pen: { color: string; thickness: number; smoothing: number; transforms: boolean };
};
export type StoredTable = { snapshot: TableSnapshot; assets: { key: string; blob: Blob }[] };
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e9;
const text = (s: unknown, max = 128): s is string => typeof s === "string" && s.length <= max;
const point = (p: unknown): p is Point => record(p) && finite(p.x) && finite(p.y);
const strokes = (v: unknown): v is Stroke[] => Array.isArray(v) && v.length <= 50000 && v.every((s) => record(s) && text(s.id) && text(s.color) && finite(s.width) && s.width > 0 && typeof s.highlight === "boolean" && Array.isArray(s.points) && s.points.length <= 1000000 && s.points.every(point));
export function sceneIssue(v: unknown, allowRoomArtwork = false, allowLocalMedia = false): string | null {
  if (!record(v) || !Array.isArray(v.objects) || v.objects.length > 5000) return "The object list is invalid.";
  if (!strokes(v.strokes)) return "The table drawings are invalid.";
  const ids = new Set<string>();
  for (const o of v.objects) {
    if (!record(o) || !text(o.id) || !o.id || ids.has(o.id)) return "An object has an invalid or duplicate identity.";
    const label = text(o.name, 1024) ? `Object “${o.name.slice(0, 60)}”` : "An object";
    if (!text(o.name, 1024) || !["shape", "paper", "card", "image", "screen", "camera", "video", "audio", "text"].includes(o.kind) || !text(o.color)) return `${label} has invalid properties.`;
    if ((o.kind === "text" || o.text !== undefined) && !validText(o.text)) return `${label} has invalid text settings.`;
    if (![o.x, o.y, o.width, o.height, o.rotation].every(finite) || o.width <= 0 || o.height <= 0) return `${label} has invalid size or placement.`;
    if (!strokes(o.strokes)) return `${label} has invalid drawings.`;
    if (o.parentId !== null && !text(o.parentId)) return `${label} has an invalid parent.`;
    if (o.shape !== undefined && !["rectangle", "rounded", "circle", "triangle", "hexagon", "diamond"].includes(o.shape)) return `${label} has an invalid shape.`;
    if (o.image !== undefined && (typeof o.image !== "string" || !o.image.startsWith("data:image/") && !(allowRoomArtwork && roomImage(o.image)))) return `${label} has invalid image data.`;
    const mediaRef = (ref: unknown) => typeof ref === "string" && (ref.startsWith("asset:") || allowRoomArtwork && !!roomMedia(ref) || allowLocalMedia && ref.startsWith("blob:"));
    if (o.video !== undefined && !mediaRef(o.video)) return `${label} has an invalid video reference.`;
    if (o.audio !== undefined && !mediaRef(o.audio)) return `${label} has an invalid audio reference.`;
    if (o.filename !== undefined && !text(o.filename, 1024)) return `${label} has an invalid filename.`;
    if (o.volume !== undefined && (!finite(o.volume) || o.volume < 0 || o.volume > 1)) return `${label} has invalid audio volume.`;
    if (o.imageView !== undefined && (!record(o.imageView) || ![o.imageView.x, o.imageView.y, o.imageView.zoom].every(finite) || o.imageView.zoom < 1 || o.imageView.zoom > 20)) return `${label} has invalid artwork framing.`;
    if (o.crop !== undefined && (!record(o.crop) || ![o.crop.x, o.crop.y, o.crop.width, o.crop.height].every(finite) || o.crop.x < 0 || o.crop.y < 0 || o.crop.width <= 0 || o.crop.height <= 0 || o.crop.x + o.crop.width > 1.000001 || o.crop.y + o.crop.height > 1.000001)) return `${label} has an invalid crop.`;
    if ([o.sourceWidth, o.sourceHeight].some((n) => n !== undefined && (!finite(n) || n <= 0))) return `${label} has invalid media dimensions.`;
    if ([o.paused, o.animated, o.locked, o.loop].some((n) => n !== undefined && typeof n !== "boolean")) return `${label} has an invalid playback or lock flag.`;
    ids.add(o.id);
  }
  const parents = new Map<string, string | null>(v.objects.map((o: Surface) => [o.id, o.parentId]));
  for (const o of v.objects) {
    const visited = new Set([o.id]);
    let parent = o.parentId;
    while (parent !== null) {
      if (!ids.has(parent) || visited.has(parent)) return "The object hierarchy has a missing parent or a cycle.";
      visited.add(parent); parent = parents.get(parent);
    }
  }
  return null;
}
export function parseScene(v: unknown): Scene | null {
  return sceneIssue(v) ? null : structuredClone(v) as Scene;
}
export function snapshotIssue(v: unknown, allowRoomArtwork = false, allowLocalMedia = false): string | null {
  if (!record(v) || v.version !== 1) return "The table format is unsupported.";
  const issue = sceneIssue(v.scene, allowRoomArtwork, allowLocalMedia);
  if (issue) return issue;
  if (!parseMood(v.mood)) return "The theme settings are invalid.";
  if (!parseDiceSetup(v.dice)) return "The dice setup is invalid.";
  if (!parseGrid(v.grid) || typeof v.grid.enabled !== "boolean") return "The grid settings are invalid.";
  if (!record(v.dice) || typeof v.dice.enabled !== "boolean" || typeof v.dice.sound !== "boolean" || !v.dice.groups.some((g: { id: string }) => g.id === v.dice.activeGroup) || !Array.isArray(v.dice.history) || v.dice.history.length > 12) return "The dice selection or history is invalid.";
  for (const r of v.dice.history) {
    if (!record(r) || !text(r.id) || !text(r.notation, 1024) || !finite(r.total) || !Array.isArray(r.dice) || r.dice.length > 20 || !r.dice.every((d: any) => record(d) && [4, 6, 8, 10, 12, 20, 100].includes(d.sides) && Number.isInteger(d.value) && d.value >= 1 && d.value <= d.sides && (d.groupName === undefined || text(d.groupName, 24)) && (d.groupId === undefined || text(d.groupId)) && [d.color, d.fontColor].every((c) => c === undefined || c === null || /^#[0-9a-f]{6}$/i.test(c))) || r.total !== r.dice.reduce((sum: number, d: any) => sum + d.value, 0)) return "A dice history result is invalid.";
  }
  if (!record(v.camera) || ![v.camera.x, v.camera.y, v.camera.zoom, v.camera.width, v.camera.height].every(finite) || v.camera.zoom < .1 || v.camera.zoom > 4 || v.camera.width < 0 || v.camera.height < 0) return "The table view settings are invalid.";
  if (!record(v.pen) || !text(v.pen.color) || !finite(v.pen.thickness) || v.pen.thickness <= 0 || v.pen.thickness > 100 || !finite(v.pen.smoothing) || v.pen.smoothing < 0 || v.pen.smoothing > 1 || typeof v.pen.transforms !== "boolean") return "The pen settings are invalid.";
  if (v.measurement !== null && (!record(v.measurement) || !point(v.measurement.start) || !point(v.measurement.end))) return "The ruler measurement is invalid.";
  if (!record(v.obscure) || [v.obscure.enabled, v.obscure.gm, v.obscure.covered].some((b) => typeof b !== "boolean") || !["reveal", "cover"].includes(v.obscure.mode) || !finite(v.obscure.revision) || !Array.isArray(v.obscure.regions) || v.obscure.regions.length > 50000 || !v.obscure.regions.every((r: any) => record(r) && ["reveal", "cover"].includes(r.mode) && Array.isArray(r.points) && r.points.length <= 1000000 && r.points.every(point))) return "The obscure layer is invalid.";
  if (v.obscure.gmOpacity !== undefined && (!finite(v.obscure.gmOpacity) || v.obscure.gmOpacity < 0 || v.obscure.gmOpacity > 1)) return "The GM cover opacity is invalid.";
  return null;
}
export function parseSnapshot(v: unknown, allowRoomArtwork = false, allowLocalMedia = false): TableSnapshot | null {
  return snapshotIssue(v, allowRoomArtwork, allowLocalMedia) ? null : structuredClone(v) as TableSnapshot;
}

export function storedIssue(v: unknown): string | null {
  if (!record(v)) return "The saved record is invalid.";
  const issue = snapshotIssue(v.snapshot);
  if (issue) return issue;
  if (!Array.isArray(v.assets)) return "The media list is invalid.";
  const keys = new Set<string>();
  for (const asset of v.assets) {
    if (!record(asset) || !text(asset.key) || keys.has(asset.key) || !(asset.blob instanceof Blob) || !/^(video|audio)\//.test(asset.blob.type)) return "A saved media asset is invalid.";
    keys.add(asset.key);
  }
  if (v.snapshot.scene.objects.some((o: Surface) => [o.video, o.audio].some(ref => ref && !keys.has(ref.slice(6))))) return "A media surface is missing its saved file.";
  return null;
}
export function validateStored(v: unknown): StoredTable | null {
  return storedIssue(v) ? null : structuredClone(v) as StoredTable;
}

/** Older imports could divide 0 / 0 for a file with no decodable video track. */
export function recoverVideoMetadata(v: unknown): StoredTable | null {
  if (!record(v) || !record(v.snapshot) || !record(v.snapshot.scene) || !Array.isArray(v.snapshot.scene.objects)) return null;
  const copy = structuredClone(v);
  let repaired = false;
  for (const o of copy.snapshot.scene.objects) {
    if (!record(o) || o.kind !== "video" || o.sourceWidth !== 0 || o.sourceHeight !== 0 || (finite(o.height) && o.height > 0) || !finite(o.width) || o.width <= 0 || ![o.x, o.y, o.rotation].every(finite)) continue;
    // Keep the file and surface identity in a manageable placeholder; no content is removed.
    o.height = o.width * 9 / 16;
    delete o.sourceWidth; delete o.sourceHeight;
    repaired = true;
  }
  return repaired ? validateStored(copy) : null;
}

/** One atomic record contains the scene and its media, so references cannot outlive a failed asset write. */
export class LocalTableStore {
  private database: Promise<IDBDatabase>;
  private pending: StoredTable | null = null;
  private writing: Promise<void> | null = null;
  private rejected = false;
  hasRecovery = false;
  recoveryNotice: string | null = null;
  private status: (status: SaveStatus) => void;
  constructor(status: (status: SaveStatus) => void) {
    this.status = status;
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open("table-goblin", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("tables");
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Local table storage is blocked by another tab."));
    });
  }
  async read(): Promise<StoredTable | null> {
    this.recoveryNotice = null;
    this.hasRecovery = await this.readOriginal(true) !== undefined;
    const value = await this.readOriginal();
    if (value === undefined) return null;
    const issue = storedIssue(value);
    if (issue) {
      const recovered = recoverVideoMetadata(value);
      if (recovered) {
        // Retain an untouched browser copy before any autosave can replace the broken record.
        if (!this.hasRecovery) {
          const database = await this.database;
          await new Promise<void>((resolve, reject) => {
            const tx = database.transaction("tables", "readwrite");
            tx.objectStore("tables").put(value, "before-recovery");
            tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error("Could not keep the original recovery copy."));
          });
          this.hasRecovery = true;
        }
        this.recoveryNotice = "Table recovered. A video without readable dimensions is kept as a placeholder. The original save is available in Table options → Export saved data.";
        return recovered;
      }
      throw new Error(`The saved table could not be opened. ${issue} The original is kept intact; automatic saving is paused.`);
    }
    return validateStored(value);
  }
  async readOriginal(backup = false): Promise<unknown> {
    const database = await this.database;
    return new Promise<unknown>((resolve, reject) => {
      const request = database.transaction("tables").objectStore("tables").get(backup ? "before-recovery" : "current");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  save(value: StoredTable): Promise<void> {
    const issue = storedIssue(value);
    if (issue) {
      this.rejected = true;
      this.status("error");
      return Promise.reject(new Error(`The table was not saved: ${issue}`));
    }
    this.pending = value;
    this.rejected = false;
    this.status("saving");
    if (!this.writing) {
      this.writing = this.drain().then(() => this.status(this.rejected ? "error" : "saved"), (error) => { this.pending = null; this.status("error"); throw error; }).finally(() => { this.writing = null; });
    }
    return this.writing;
  }
  private async drain() {
    const database = await this.database;
    while (this.pending) {
      const value = this.pending; this.pending = null;
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction("tables", "readwrite");
        transaction.objectStore("tables").put(value, "current");
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error ?? new Error("Local saving failed."));
        transaction.onerror = () => reject(transaction.error);
      });
    }
  }
  async close() { try { await this.writing; (await this.database).close(); } catch {} }
}

export async function tableFile(stored: StoredTable): Promise<string> {
  const snapshot = structuredClone(stored.snapshot);
  snapshot.scene.objects = await inlineRoomArtwork(snapshot.scene.objects);
  const media = await inlineRoomMedia(snapshot.scene.objects); snapshot.scene.objects = media.objects;
  const assets = await Promise.all([...stored.assets, ...media.assets].map(async ({ key, blob }) => ({ key, data: await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
  }) })));
  return JSON.stringify({ app: "table-goblin", version: 1, snapshot, assets });
}
/** Export rejected data without validating, repairing, or replacing the original. */
export async function recoveryFile(original: unknown): Promise<string> {
  const encode = async (v: unknown): Promise<unknown> => {
    if (typeof v === "number" && !Number.isFinite(v)) return { $number: String(v) };
    if (v === undefined) return { $undefined: true };
    if (v instanceof Blob) return { blobType: v.type, data: await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = () => reject(reader.error); reader.readAsDataURL(v);
    }) };
    if (Array.isArray(v)) return Promise.all(v.map(encode));
    if (record(v)) return Object.fromEntries(await Promise.all(Object.entries(v).map(async ([key, value]) => [key, await encode(value)])));
    return v;
  };
  return JSON.stringify({ app: "table-goblin-recovery", version: 1, issue: storedIssue(original), original: await encode(original) });
}
export async function readTableFile(file: File): Promise<StoredTable> {
  const value = JSON.parse(await file.text());
  if (!record(value) || value.app !== "table-goblin" || value.version !== 1 || !Array.isArray(value.assets) || !parseSnapshot(value.snapshot)) throw new Error("This is not a valid Table Goblin table file.");
  const assets = value.assets.map((asset: any) => {
    if (!record(asset) || !text(asset.key) || typeof asset.data !== "string" || !/^data:(video|audio)\/[a-z0-9.+-]+;base64,/i.test(asset.data)) throw new Error("Invalid media in table file.");
    const [header, encoded] = asset.data.split(","), raw = atob(encoded), bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    return { key: asset.key, blob: new Blob([bytes], { type: header.slice(5, -7) }) };
  });
  const stored = validateStored({ snapshot: value.snapshot, assets });
  if (!stored) throw new Error("The table file is missing media or contains invalid data.");
  return stored;
}
