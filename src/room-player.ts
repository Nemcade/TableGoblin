import type { Surface } from "./model";
import { roomMedia } from "./room-media.ts";
import { emptyRoomPlayback, playbackPosition, type RoomPlayback } from "./room-playback.ts";

/** Listening is local; transport follows a server-clock anchor without room edits. */
export class RoomFilePlayer {
  playback = emptyRoomPlayback();
  active = false;
  enabled = false;
  private clock: number | null = null;
  private muted = new Map<string, boolean>();
  private elements = new Map<string, { obj: Surface; media: HTMLMediaElement; version: number; checked: number; starting: boolean; blocked: boolean }>();
  private changed: () => void;
  constructor(changed: () => void) { this.changed = changed; }
  apply(playback: RoomPlayback, serverTime?: number) {
    this.active = true; this.playback = playback;
    // Arrival delay is not clock drift. Keep the least-delayed sample so a
    // queued table update or duplicate HTTP reply cannot rewind playing music.
    if (serverTime !== undefined) {
      const sample = serverTime - performance.now();
      this.clock = this.clock === null ? sample : Math.max(this.clock, sample);
    }
    for (const [id, entry] of this.elements) if (!playback.tracks.some(t => t.object === id && t.ref === (entry.obj.audio ?? entry.obj.video))) { entry.media.pause(); this.elements.delete(id); this.muted.delete(id); }
  }
  isMuted(obj: Surface) { return this.muted.get(obj.id) ?? !!obj.video; }
  mute(obj: Surface, value: boolean) { this.muted.set(obj.id, value); if (!value) this.enable(); this.changed(); }
  silence() { for (const t of this.playback.tracks) this.muted.set(t.object, true); this.changed(); }
  enable() {
    this.enabled = true;
    for (const entry of this.elements.values()) { entry.blocked = false; this.sync(entry.obj, entry.media); }
    this.changed();
  }
  get needsSound() {
    return [...this.elements.values()].some(e => !this.isMuted(e.obj) && (!this.enabled || e.blocked) && this.position(e.obj)?.playing);
  }
  position(obj: Surface) {
    const t = this.playback.tracks.find(t => t.object === obj.id && t.ref === (obj.audio ?? obj.video));
    if (!t) return null;
    const duration = this.elements.get(obj.id)?.media.duration;
    return { ...playbackPosition(t, performance.now() + (this.clock ?? 0), Number.isFinite(duration) && duration! > 0 ? duration : t.duration), duration: Number.isFinite(duration) ? duration! : t.duration, track: t };
  }
  sync(obj: Surface, media: HTMLMediaElement): boolean {
    if (!this.active || !roomMedia(obj.audio ?? obj.video)) return false;
    let entry = this.elements.get(obj.id);
    if (!entry || entry.media !== media) { entry = { obj, media, version: -1, checked: -Infinity, starting: false, blocked: false }; this.elements.set(obj.id, entry); }
    entry.obj = obj;
    const target = this.position(obj);
    if (!target) { media.pause(); return true; }
    media.loop = target.track.loop; media.volume = obj.volume ?? (obj.audio ? .65 : 1);
    media.muted = this.isMuted(obj) || !this.enabled || entry.blocked;
    obj.paused = !target.playing; obj.loop = target.track.loop;
    const now = performance.now();
    if (media.readyState >= 1 && !media.seeking && Number.isFinite(target.duration) && target.duration > 0 && (entry.version !== target.track.version || now - entry.checked >= 250)) {
      const command = entry.version !== target.track.version;
      let difference = target.position - media.currentTime;
      if (target.track.loop && !command && target.playing)
        difference = ((difference + target.duration / 2) % target.duration + target.duration) % target.duration - target.duration / 2;
      // Explicit controls and large drift still seek. During ordinary playback,
      // correct small differences gently; never chase the clock while buffering.
      if (command || !target.playing || media.readyState >= 3) {
        if (Math.abs(difference) > (command || !target.playing ? .04 : .75)) {
          try { media.currentTime = target.position; } catch { /* Seekable data can arrive later. */ }
          media.playbackRate = 1;
        } else media.playbackRate = target.playing && Math.abs(difference) > .08 ? 1 + Math.sign(difference) * .03 : 1;
      } else media.playbackRate = 1;
      entry.checked = now; entry.version = target.track.version;
    }
    if (!target.playing) { media.playbackRate = 1; media.pause(); }
    else if (media.paused && !entry.starting && !entry.blocked && media.readyState >= 2 && !media.error) {
      const pending = entry; pending.starting = true;
      void media.play().catch(() => {
        if (this.elements.get(obj.id) !== pending || !this.active) return;
        pending.blocked = true; this.changed();
      }).finally(() => { pending.starting = false; });
    }
    return true;
  }
  tick() { for (const e of this.elements.values()) this.sync(e.obj, e.media); }
  clear() {
    for (const e of this.elements.values()) { e.media.playbackRate = 1; e.media.pause(); }
    this.elements.clear(); this.muted.clear(); this.playback = emptyRoomPlayback(); this.clock = null; this.enabled = false; this.active = false;
  }
}
