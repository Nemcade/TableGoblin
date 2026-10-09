import type { TableEngine } from "./engine";
import { sharedSnapshot, type RoomState, type SharedTable } from "./room-state";
import { tableFile } from "./table-storage";
export type RoomStatus = "connected" | "saving" | "offline";
export class RoomClient {
  state: RoomState;
  private source: EventSource;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private presenceTimer: ReturnType<typeof setInterval>;
  private inFlight = false;
  private pending = false;
  private connected = false;
  private closed = false;
  private signature: string;
  private lastPresence = "";
  private presenceSentAt = 0;
  private presenceInFlight = false;
  rejectedDraft: SharedTable | null = null;
  constructor(private engine: TableEngine, state: RoomState,
    private update: (state: RoomState, status: RoomStatus) => void,
    private error: (message: string) => void) {
    this.state = state; this.signature = JSON.stringify(state.table);
    engine.setRoomPermissions(state.me.role === "gm", state.me.role === "gm" || state.playerEditing, false);
    engine.enterRoom(state.table, () => this.schedule());
    this.source = new EventSource(`/api/rooms/${state.id}/events`);
    this.source.addEventListener("state", e => this.receiveState(JSON.parse((e as MessageEvent).data)));
    this.source.addEventListener("table", e => {
      if (this.closed) return;
      const { table, revision, actor } = JSON.parse((e as MessageEvent).data);
      if (revision <= this.state.revision) return;
      if (actor !== this.state.me.id) {
        if (this.pending || this.inFlight) this.keepDraft("Another participant changed the table before your edit arrived. Your unsent version can be exported.");
        engine.applyRoom(table); this.signature = JSON.stringify(table);
      } else engine.acknowledgeRoom(table);
      this.state = { ...this.state, table, revision };
      this.update(this.state, this.pending || this.inFlight ? "saving" : "connected");
    });
    this.source.addEventListener("presence", e => {
      if (this.closed) return;
      const next = JSON.parse((e as MessageEvent).data);
      this.state = { ...this.state, ...next };
      engine.setRoomPresence(next.participants, next.presence, this.state.me.id);
      this.update(this.state, this.connected ? this.pending || this.inFlight ? "saving" : "connected" : "offline");
    });
    this.source.onerror = this.offline;
    window.addEventListener("offline", this.offline);
    window.addEventListener("online", this.online);
    this.presenceTimer = setInterval(() => void this.sendPresence(), 120);
  }
  private offline = () => {
    if (this.closed || !this.connected) return;
    this.connected = false;
    this.engine.setRoomPermissions(this.state.me.role === "gm", this.state.me.role === "gm" || this.state.playerEditing, false);
    this.update(this.state, "offline");
  };
  private online = () => {
    void roomRequest(`/api/rooms/${this.state.id}/state`).then(next => this.receiveState(next)).catch(() => this.offline());
  };
  private receiveState(next: RoomState) {
    if (this.closed) return;
    const current = JSON.stringify(this.engine.getRoomTable()), signature = JSON.stringify(next.table);
    const hasEdits = this.pending && current !== this.signature;
    const retry = hasEdits && current !== signature && next.revision === this.state.revision && (next.me.role === "gm" || next.playerEditing);
    if (hasEdits && current !== signature && !retry) this.keepDraft("The room changed while disconnected. Your unsent version can be exported; the latest room version is now open.");
    if (current === signature) this.pending = false;
    this.state = next; this.connected = navigator.onLine;
    this.engine.setRoomPermissions(next.me.role === "gm", next.me.role === "gm" || next.playerEditing, this.connected);
    if (!retry) { this.engine.applyRoom(next.table); this.signature = signature; }
    this.engine.setRoomPresence(next.participants, next.presence, next.me.id);
    this.update(next, this.connected ? "connected" : "offline");
    if (retry) this.schedule();
  }
  private keepDraft(message: string) {
    this.rejectedDraft = this.engine.getRoomTable();
    this.pending = false;
    this.error(message);
  }
  private schedule() {
    if (this.closed) return;
    this.pending = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 180);
  }
  private async flush() {
    if (this.closed || !this.connected || this.inFlight || !this.pending) return;
    const table = this.engine.getRoomTable(), signature = JSON.stringify(table);
    this.pending = false;
    if (signature === this.signature) return;
    this.inFlight = true; this.update(this.state, "saving");
    try {
      const response = await fetch(`/api/rooms/${this.state.id}/table`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: this.state.revision, table }), signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (this.closed) return;
      if (!response.ok) {
        this.keepDraft(result.error || "Your edit was rejected by the room server.");
        const latest = result.state ?? await roomRequest(`/api/rooms/${this.state.id}/state`);
        this.state = latest; this.engine.applyRoom(latest.table); this.signature = JSON.stringify(latest.table);
      } else {
        // An update from another participant can arrive before this HTTP ack.
        // Preserve that newer revision and its matching signature.
        if (result.revision >= this.state.revision) {
          this.signature = signature;
          if (result.revision > this.state.revision) this.state = { ...this.state, table, revision: result.revision };
          this.engine.acknowledgeRoom(table);
        }
      }
    } catch {
      if (!this.closed) { this.pending = true; this.connected = false; this.error("The connection was interrupted. Your edit remains in this window. Reconnect or export it before leaving."); }
    } finally {
      this.inFlight = false;
      if (!this.closed) { this.engine.setRoomPermissions(this.state.me.role === "gm", this.state.me.role === "gm" || this.state.playerEditing, this.connected); this.update(this.state, this.connected ? "connected" : "offline"); if (this.pending && this.connected) this.schedule(); }
    }
  }
  private async sendPresence() {
    if (!this.connected || this.closed || this.presenceInFlight) return;
    const value = this.engine.getRoomPresence(), signature = JSON.stringify(value);
    if (signature === this.lastPresence && (!value.laser || Date.now() - this.presenceSentAt < 600)) return;
    this.presenceInFlight = true;
    try {
      const response = await fetch(`/api/rooms/${this.state.id}/presence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: signature, signal: AbortSignal.timeout(5000) });
      if (response.ok) { this.lastPresence = signature; this.presenceSentAt = Date.now(); }
    } catch {} finally { this.presenceInFlight = false; }
  }
  async permissions(playerEditing: boolean) {
    return await roomRequest(`/api/rooms/${this.state.id}/permissions`, { playerEditing });
  }
  requestSave() { this.schedule(); }
  async exportRejected() {
    if (!this.rejectedDraft) return;
    const file = await tableFile({ snapshot: sharedSnapshot(this.rejectedDraft), assets: [] });
    const url = URL.createObjectURL(new Blob([file], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "Table Goblin unsent room edit.goblin.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  async settle() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.inFlight && JSON.stringify(this.engine.getRoomTable()) === this.signature) { this.pending = false; return; }
    if (this.inFlight) throw new Error("Wait for the current room change to finish saving.");
    await this.flush();
    if (this.pending || !this.connected) throw new Error("The room is offline. Rejoin or export your current table before leaving.");
  }
  close() {
    this.closed = true; this.source.close(); clearInterval(this.presenceTimer);
    window.removeEventListener("offline", this.offline); window.removeEventListener("online", this.online);
    if (this.timer) clearTimeout(this.timer);
  }
}
export async function roomRequest(url: string, value?: unknown): Promise<RoomState> {
  const response = await fetch(url, value === undefined ? { signal: AbortSignal.timeout(8000) } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value), signal: AbortSignal.timeout(15000) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "The online service is unavailable. Start the online server to create or join a room.");
  return result;
}
