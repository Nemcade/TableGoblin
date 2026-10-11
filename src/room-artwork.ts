import type { Surface } from "./model.ts";

export const roomImagePattern = /^\/api\/rooms\/([a-f0-9]{16})\/assets\/([a-f0-9]{64}\.(png|jpg|webp|gif))$/;
export function roomImage(value: unknown) {
  const match = typeof value === "string" && value.match(roomImagePattern);
  return match ? { room: match[1], file: match[2] } : null;
}
export const roomImageLimit = 20 * 1024 * 1024;
export async function imageData(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
  });
}
/** Portable copies contain artwork bytes, never credentials or room URLs. */
export async function inlineRoomArtwork(objects: Surface[]): Promise<Surface[]> {
  const result = structuredClone(objects), images = new Map<string, string>();
  for (const object of result) if (roomImage(object.image)) {
    const url = object.image!;
    if (!images.has(url)) {
      const response = await fetch(url, { credentials: "same-origin", signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error("Room artwork is unavailable. Reconnect before copying or exporting this table.");
      const blob = await response.blob();
      if (!/^image\/(png|jpeg|webp|gif)$/.test(blob.type) || blob.size > roomImageLimit) throw new Error("Room artwork could not be read.");
      images.set(url, await imageData(blob));
    }
    object.image = images.get(url);
  }
  return result;
}
