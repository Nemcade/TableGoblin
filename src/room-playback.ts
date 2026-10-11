import type { SharedTable } from "./room-state.ts";
import { roomMedia } from "./room-media.ts";

export type PlaybackTrack = { object: string; ref: string; version: number; playing: boolean; loop: boolean; position: number; duration: number; updatedAt: number };
export type RoomPlayback = { sequence: number; tracks: PlaybackTrack[] };
export type PlaybackRequest = { id: string; object: string; ref: string; version: number; action: "play" | "pause" | "restart" | "seek" | "loop"; duration: number; position?: number; loop?: boolean };
export const emptyRoomPlayback = (): RoomPlayback => ({ sequence: 0, tracks: [] });
const time = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 604800;
const version = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
export function parseRoomPlayback(value: unknown): RoomPlayback | null {
  const v = value as RoomPlayback;
  if (!v || !version(v.sequence) || !Array.isArray(v.tracks) || v.tracks.length > 1000 || new Set(v.tracks.map(t => t?.object)).size !== v.tracks.length ||
    v.tracks.some(t => !t || typeof t.object !== "string" || !t.object || !roomMedia(t.ref) || !version(t.version) || t.version > v.sequence || typeof t.playing !== "boolean" || typeof t.loop !== "boolean" ||
      !time(t.position) || !time(t.duration) || t.duration > 0 && t.position > t.duration || !version(t.updatedAt))) return null;
  return structuredClone(v);
}
export function parsePlaybackRequest(value: unknown): PlaybackRequest | null {
  const v = value as PlaybackRequest;
  if (!v || typeof v.id !== "string" || !/^[a-z0-9-]{16,80}$/i.test(v.id) || typeof v.object !== "string" || !v.object || !roomMedia(v.ref) || !version(v.version) ||
    !["play", "pause", "restart", "seek", "loop"].includes(v.action) || !time(v.duration) || v.duration <= 0 ||
    (v.action === "seek" && (!time(v.position) || v.position > v.duration)) || (v.action === "loop" && typeof v.loop !== "boolean")) return null;
  return { id: v.id, object: v.object, ref: v.ref, version: v.version, action: v.action, duration: v.duration,
    ...(v.action === "seek" ? { position: v.position } : {}), ...(v.action === "loop" ? { loop: v.loop } : {}) };
}
export function playbackPosition(track: PlaybackTrack, now: number, duration = track.duration) {
  const raw = track.position + (track.playing ? Math.max(0, now - track.updatedAt) / 1000 : 0);
  const bounded = Number.isFinite(duration) && duration > 0;
  return { position: bounded ? track.loop ? raw % duration : Math.min(raw, duration) : raw,
    playing: track.playing && !(bounded && !track.loop && raw >= duration) };
}
export function reconcilePlayback(playback: RoomPlayback, table: SharedTable, now: number): RoomPlayback {
  const files = table.scene.objects.filter(o => roomMedia(o.audio ?? o.video));
  const changed = files.length !== playback.tracks.length || files.some(o => !playback.tracks.some(t => t.object === o.id && t.ref === (o.audio ?? o.video)));
  if (!changed) return playback;
  const sequence = playback.sequence + 1;
  return { sequence, tracks: files.map(o => playback.tracks.find(t => t.object === o.id && t.ref === (o.audio ?? o.video)) ??
    { object: o.id, ref: (o.audio ?? o.video)!, version: sequence, playing: !!o.video, loop: !!o.video, position: 0, duration: 0, updatedAt: now }) };
}
export function changePlayback(track: PlaybackTrack, request: PlaybackRequest, now: number, nextVersion: number): PlaybackTrack {
  const current = playbackPosition(track, now, request.duration);
  return { ...track, version: nextVersion, updatedAt: now, duration: request.duration,
    position: request.action === "restart" || request.action === "play" && !current.playing && current.position >= request.duration ? 0 : request.action === "seek" ? request.position! : current.position,
    playing: request.action === "restart" || request.action === "play" ? true : request.action === "pause" ? false : current.playing,
    loop: request.action === "loop" ? request.loop! : track.loop };
}
export const validPlaybackReceipts = (v: any, sequence: number): v is { id: string; sequence: number }[] => Array.isArray(v) && v.length <= 256 &&
  v.every(r => r && typeof r.id === "string" && version(r.sequence) && r.sequence <= sequence);
