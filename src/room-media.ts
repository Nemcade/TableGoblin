import type { Surface } from "./model.ts";

export const roomMediaLimit = 64 * 1024 * 1024;
export const roomMediaTypes = ["video/mp4", "audio/mp4", "video/webm", "audio/webm", "audio/mpeg", "audio/wav", "audio/ogg", "video/ogg", "audio/flac", "audio/aac"];
export function roomMedia(value: unknown) {
  const match = typeof value === "string" && value.match(/^\/api\/rooms\/([a-f0-9]{16})\/media\/([a-f0-9]{64}\.(mp4|webm|mp3|wav|ogg|flac|aac))$/);
  return match ? { room: match[1], file: match[2] } : null;
}
/** Portable media has ordinary asset keys; private URLs never escape an export. */
export async function inlineRoomMedia(objects: Surface[]) {
  const result = structuredClone(objects), assets: { key: string; blob: Blob }[] = [], known = new Map<string, string>();
  for (const object of result) for (const field of ["video", "audio"] as const) {
    const ref = object[field], media = roomMedia(ref);
    if (!media || !ref) continue;
    if (!known.has(ref)) {
      const response = await fetch(ref, { credentials: "same-origin", signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error("Room media is unavailable. Reconnect before copying or exporting it.");
      const blob = await response.blob();
      if (!roomMediaTypes.includes(blob.type) || !blob.size || blob.size > roomMediaLimit) throw new Error("Room media could not be read.");
      const key = `room-${media.file}`; known.set(ref, key); assets.push({ key, blob });
    }
    object[field] = `asset:${known.get(ref)}`;
  }
  return { objects: result, assets };
}
