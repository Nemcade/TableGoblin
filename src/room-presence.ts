import type { Camera } from "./render.ts";
import type { Point } from "./model.ts";

/** Visible world area, independent of a participant's screen size. */
export type RoomView = { x: number; y: number; width: number; height: number };
export type Presence = { id: string; selection: string[]; laser: Point | null; view?: RoomView | null };
const coordinate = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e7;
export function validRoomView(value: unknown): value is RoomView {
  const v = value as RoomView | null;
  return !!v && !Array.isArray(v) && coordinate(v.x) && coordinate(v.y) &&
    [v.width, v.height].every(n => Number.isFinite(n) && n > 0 && n <= 200000);
}
export function validPresence(value: unknown): value is Omit<Presence, "id"> {
  const v = value as Presence | null;
  return !!v && !Array.isArray(v) && Array.isArray(v.selection) && v.selection.length <= 64 &&
    v.selection.every(id => typeof id === "string" && id.length <= 128) &&
    (v.laser === null || !!v.laser && coordinate(v.laser.x) && coordinate(v.laser.y)) &&
    (v.view === undefined || v.view === null || validRoomView(v.view));
}
export function viewFromCamera(camera: Camera, width: number, height: number): RoomView | null {
  if (!Number.isFinite(camera.zoom) || camera.zoom <= 0) return null;
  const view = { x: (width / 2 - camera.x) / camera.zoom, y: (height / 2 - camera.y) / camera.zoom,
    width: width / camera.zoom, height: height / camera.zoom };
  return validRoomView(view) ? view : null;
}
export function cameraAtView(view: RoomView, width: number, height: number): Camera | null {
  if (!validRoomView(view) || ![width, height].every(n => Number.isFinite(n) && n > 0 && n <= 20000)) return null;
  const zoom = Math.max(.1, Math.min(4, width / view.width, height / view.height));
  return { x: width / 2 - view.x * zoom, y: height / 2 - view.y * zoom, zoom };
}
