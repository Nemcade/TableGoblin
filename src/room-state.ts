import { parseSnapshot, type TableSnapshot } from "./table-storage.ts";
import { defaultMood } from "./mood.ts";
import { defaultGrid, defaultObscure } from "./table-widgets.ts";
import { defaultDiceGroup } from "./dice-types.ts";
import type { Scene } from "./model.ts";
import { validPresence, type Presence } from "./room-presence.ts";
export { validPresence } from "./room-presence.ts";
export type { Presence } from "./room-presence.ts";
import { locksAllowed, validAccess, type AccessMap, type DragLease } from "./room-permissions.ts";
import { emptyRoomDice, parseRoomDice, validRollReceipts, type RoomDice, type RollReceipt } from "./room-dice.ts";
import { roomImage } from "./room-artwork.ts";
import { roomMedia } from "./room-media.ts";
import { emptyRoomPlayback, parseRoomPlayback, validPlaybackReceipts, type RoomPlayback } from "./room-playback.ts";

export type SharedTable = Pick<TableSnapshot, "scene" | "mood" | "grid" | "obscure">;
export const ROOM_PROTOCOL = 9;
export type Participant = { id: string; name: string; color: string; role: "gm" | "player"; online: boolean; profileVersion?: number };
export const validParticipant = (p: any): p is Participant => p && typeof p.id === "string" && typeof p.name === "string" && /^#[0-9a-f]{6}$/i.test(p.color) && ["gm", "player"].includes(p.role) && typeof p.online === "boolean" &&
  (p.profileVersion === undefined || Number.isSafeInteger(p.profileVersion) && p.profileVersion >= 0);
export type RoomState = {
  protocol: number;
  id: string; title: string; revision: number; playerEditing: boolean;
  me: Participant; participants: Participant[]; presence: Presence[]; table: SharedTable;
  versions: import("./room-operations.ts").Versions;
  history: { undo: boolean; redo: boolean };
  accepted: { id: string; revision: number }[];
  access: AccessMap; leases: DragLease[];
  dice: RoomDice; diceAccepted: RollReceipt[]; serverTime: number;
  playback: RoomPlayback; playbackAccepted: { id: string; sequence: number }[];
  invite?: string;
};
/** Decode the API boundary; older servers can still display their saved table. */
export function readRoomState(value: unknown, previous?: RoomState): RoomState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  let v = value as Record<string, any>;
  if (v.id === undefined && previous?.protocol === 0) v = { ...previous, table: v.table, revision: v.revision };
  if (!/^[a-z0-9]{16}$/.test(v.id) || typeof v.title !== "string" || !Number.isSafeInteger(v.revision) || v.revision < 0 || typeof v.playerEditing !== "boolean" ||
    !validParticipant(v.me) || !Array.isArray(v.participants) || !v.participants.every(validParticipant) || !Array.isArray(v.presence) || !v.presence.every((p: any) => typeof p?.id === "string" && validPresence(p))) return null;
  const table = parseSharedTable(v.table);
  if (!table) return null;
  const metadata = v.history && typeof v.history.undo === "boolean" && typeof v.history.redo === "boolean" &&
    v.versions && typeof v.versions === "object" && !Array.isArray(v.versions) && Object.values(v.versions).every(n => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= v.revision) &&
    Array.isArray(v.accepted) && v.accepted.every((r: any) => r && typeof r.id === "string" && Number.isSafeInteger(r.revision) && r.revision >= 0 && r.revision <= v.revision);
  const protocol = v.protocol ?? (metadata ? 2 : 0);
  if (!Number.isSafeInteger(protocol) || protocol < 0 || protocol === ROOM_PROTOCOL && !metadata) return null;
  if (protocol === ROOM_PROTOCOL && (!v.access || typeof v.access !== "object" || Array.isArray(v.access) || !Object.values(v.access).every(validAccess) ||
    [...table.scene.objects.map(o => `object:${o.id}`), ...table.scene.strokes.map(o => `stroke:${o.id}`)].some(key => !validAccess(v.access[key])) ||
    !Array.isArray(v.leases) || !v.leases.every((l: any) => l && typeof l.client === "string" && typeof l.actor === "string" && Number.isFinite(l.expires) && Array.isArray(l.objects) && l.objects.every((id: any) => typeof id === "string")))) return null;
  const dice = parseRoomDice(v.dice);
  if (protocol === ROOM_PROTOCOL && (!dice || !validRollReceipts(v.diceAccepted, dice.sequence) || !Number.isSafeInteger(v.serverTime) || v.serverTime < 0)) return null;
  const playback = parseRoomPlayback(v.playback);
  if (protocol === ROOM_PROTOCOL && (!playback || !validPlaybackReceipts(v.playbackAccepted, playback.sequence) ||
    playback.tracks.some(t => !table.scene.objects.some(o => o.id === t.object && (o.audio ?? o.video) === t.ref)) ||
    table.scene.objects.some(o => (o.audio || o.video) && !playback.tracks.some(t => t.object === o.id)))) return null;
  return { ...v, protocol, table, dice: dice ?? emptyRoomDice(), diceAccepted: dice && validRollReceipts(v.diceAccepted, dice.sequence) ? v.diceAccepted : [], serverTime: Number.isSafeInteger(v.serverTime) ? v.serverTime : 0,
    playback: playback ?? emptyRoomPlayback(), playbackAccepted: playback && validPlaybackReceipts(v.playbackAccepted, playback.sequence) ? v.playbackAccepted : [],
    access: v.access ?? {}, leases: v.leases ?? [], versions: metadata ? v.versions : {}, history: metadata ? v.history : { undo: false, redo: false }, accepted: metadata ? v.accepted : [] } as RoomState;
}
export const emptySharedTable = (): SharedTable => ({
  scene: { objects: [], strokes: [] }, mood: { ...defaultMood },
  grid: { ...defaultGrid }, obscure: { ...defaultObscure, regions: [] },
});
export function sharedSnapshot(table: SharedTable): TableSnapshot {
  return {
    version: 1, ...table,
    dice: { color: null, fontColor: null, groups: [defaultDiceGroup()], activeGroup: "main", enabled: false, sound: false, history: [] },
    measurement: null, camera: { x: 0, y: 0, zoom: 1, width: 0, height: 0 },
    pen: { color: "#b66b45", thickness: 3, smoothing: .55, transforms: true },
  };
}
export function parseSharedTable(value: unknown, allowLocalMedia = false): SharedTable | null {
  if (!value || typeof value !== "object") return null;
  const table = value as SharedTable;
  if (!table.scene || !Array.isArray(table.scene.objects) || table.scene.objects.length > 1000) return null;
  // Local uploads are accepted only for client-side rebasing. The API boundary
  // always requires private room references, never blobs or external URLs.
  const mediaRef = (ref: unknown) => !!roomMedia(ref) || allowLocalMedia && typeof ref === "string" && /^(blob:|asset:)/.test(ref);
  if (table.scene.objects.some(o => !o || typeof o !== "object" || ["camera", "screen"].includes(o.kind) || o.sourceId ||
    (o.video !== undefined && (o.kind !== "video" || o.audio !== undefined || !mediaRef(o.video))) ||
    (o.audio !== undefined && (o.kind !== "audio" || o.video !== undefined || !mediaRef(o.audio))) ||
    (o.kind === "video" && !o.video || o.kind === "audio" && !o.audio) ||
    (o.image && !roomImage(o.image) && !/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(o.image)))) return null;
  const snapshot = parseSnapshot(sharedSnapshot(table), true, allowLocalMedia);
  if (!snapshot) return null;
  if (new Set(snapshot.scene.strokes.map(s => s.id)).size !== snapshot.scene.strokes.length) return null;
  return { scene: snapshot.scene, mood: snapshot.mood, grid: snapshot.grid,
    obscure: { ...snapshot.obscure, gm: false, gmOpacity: .28 } };
}
export function playerSceneAllowed(before: Scene, after: Scene): boolean {
  return locksAllowed(before, after);
}
