import type { TableEngine } from "./engine";
import { ROOM_PROTOCOL, readRoomState, sharedSnapshot, type RoomState, type SharedTable } from "./room-state";
import { tableFile } from "./table-storage";
import { advanceVersions, applyChanges, expectations, operationConflict, tableChanges, type RoomOperation } from "./room-operations";
import { editsAllowed, hierarchy, type ObjectAccess, type DragLease } from "./room-permissions";
export type RoomStatus = "connected" | "saving" | "offline" | "update-required";
export class RoomClient {
  state: RoomState;
  private source: EventSource;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private presenceTimer: ReturnType<typeof setInterval>;
  private inFlight = false;
  private pending = false;
  private connected = false;
  private closed = false;
  private flight: { operation: RoomOperation; acknowledged: boolean } | null = null;
  private reversing: { id: string; redo: boolean } | null = null;
  private lastPresence = "";
  private presenceSentAt = 0;
  private presenceInFlight = false;
  private warnedVersion = false;
  private browser = crypto.randomUUID();
  private leaseWork: Promise<void> = Promise.resolve();
  private leasePending = 0;
  private leased = false;
  private leaseTimer: ReturnType<typeof setInterval>;
  rejectedDraft: SharedTable | null = null;
  constructor(private engine: TableEngine, state: RoomState,
    private update: (state: RoomState, status: RoomStatus) => void,
    private error: (message: string) => void) {
    const decoded = readRoomState(state);
    if (!decoded) throw new Error("The room server sent an invalid room. Your local table has been kept intact.");
    this.state = decoded;
    this.configurePermissions(false);
    engine.enterRoom(decoded.table, () => this.schedule());
    engine.setRoomDrags(this.browser, decoded.leases, ids => this.claimDrag(ids), () => queueMicrotask(() => void this.releaseIdleDrag()));
    this.source = new EventSource(`/api/rooms/${state.id}/events?client=${this.browser}`);
    this.source.addEventListener("leases", e => {
      if (this.closed) return;
      const leases = JSON.parse((e as MessageEvent).data) as DragLease[];
      this.state = { ...this.state, leases }; engine.setRoomDrags(this.browser, leases);
    });
    this.source.addEventListener("state", e => this.receiveEvent(e));
    this.source.addEventListener("table", e => {
      if (this.closed) return;
      this.receiveEvent(e);
    });
    this.source.addEventListener("presence", e => {
      if (this.closed) return;
      const next = JSON.parse((e as MessageEvent).data);
      this.state = { ...this.state, ...next };
      engine.setRoomPresence(next.participants, next.presence, this.state.me.id);
      this.updateStatus();
    });
    this.source.onerror = this.offline;
    window.addEventListener("offline", this.offline);
    window.addEventListener("online", this.online);
    window.addEventListener("beforeunload", this.beforeUnload);
    this.presenceTimer = setInterval(() => void this.sendPresence(), 120);
    this.leaseTimer = setInterval(() => {
      if (this.leased && this.connected && !this.leasePending) this.leaseWork = this.leaseWork.then(async () => {
        if (!this.leased || this.closed) return;
        try { await this.leaseRequest("renew"); }
        catch { this.leased = false; this.engine.abortRoomDrag(); this.engine.roomNotice("The drag connection was interrupted. Grab the object again."); }
      });
    }, 1000);
  }
  private offline = () => {
    if (this.closed || !this.connected) return;
    this.connected = false;
    this.configurePermissions(false);
    this.update(this.state, "offline");
  };
  private online = () => {
    void roomRequest(`/api/rooms/${this.state.id}/state`).then(next => this.receiveState(next)).catch(() => this.offline());
  };
  private beforeUnload = (event: BeforeUnloadEvent) => {
    if (!this.closed && (this.inFlight || this.flight && !this.flight.acknowledged || tableChanges(this.state.table, this.engine.getRoomTable()).length)) {
      event.preventDefault(); event.returnValue = "";
    }
  };
  private configurePermissions(connected: boolean) {
    const supported = this.state.protocol === ROOM_PROTOCOL;
    this.engine.setRoomAccess(this.state.me.id, this.state.playerEditing, this.state.access, this.state.participants, (ids, policy) => this.share(ids, policy));
    this.engine.setRoomPermissions(supported && this.state.me.role === "gm", supported, connected);
  }
  private receiveEvent(event: Event) {
    try { this.receiveState(JSON.parse((event as MessageEvent).data)); }
    catch { this.offline(); this.error("The room update could not be read. Your current table has been kept intact. Restart the online server and refresh both browsers."); }
  }
  private receiveState(value: unknown) {
    const next = readRoomState(value, this.state);
    if (!next) { this.offline(); this.error("The room server sent an invalid update. Your current table has been kept intact. Restart the online server and refresh both browsers."); return; }
    if (this.closed || next.revision < this.state.revision) return;
    if (next.protocol !== ROOM_PROTOCOL) {
      this.pending = false; this.state = next; this.connected = navigator.onLine;
      this.engine.mergeRoom(next.table); this.configurePermissions(this.connected);
      this.engine.setRoomHistory({ undo: false, redo: false }, () => {});
      this.engine.setRoomPresence(next.participants, next.presence, next.me.id);
      this.updateStatus();
      if (!this.warnedVersion) { this.warnedVersion = true; this.error("The room server is from a different app version. The table is visible in read-only mode. Close the existing online server window, reopen Open Online Table Goblin.bat, then refresh both browsers. Saved rooms and player identities are kept."); }
      return;
    }
    if (this.reversing && next.accepted.some(r => r.id === this.reversing!.id)) this.reversing = null;
    let base = this.state.table, versions = this.state.versions;
    const receipt = this.flight && next.accepted.find(r => r.id === this.flight!.operation.id);
    if (receipt && this.flight && !this.flight.acknowledged) {
      const optimistic = applyChanges(base, this.flight.operation.changes);
      if (optimistic) { versions = advanceVersions(base, optimistic, this.flight.operation.changes, versions, receipt.revision); base = optimistic; }
      this.flight.acknowledged = true;
    }
    const changes = tableChanges(base, this.engine.getRoomTable());
    const operation = { id: "local-rebase-only", changes, expected: expectations(base, changes, versions) };
    const local = applyChanges(next.table, changes);
    const permitted = !!local && editsAllowed(next.table, local, next.access, next.me.id, next.me.role === "gm", next.playerEditing);
    const conflict = changes.length > 0 && (!permitted || operationConflict(next.table, operation, next.versions));
    const merged = conflict ? null : applyChanges(next.table, changes);
    if (conflict || !merged) {
      this.keepDraft("An object or its group changed before your edit arrived. Your unsent version can be exported; the latest room version is open.");
      this.engine.applyRoom(next.table);
    } else this.engine.mergeRoom(merged);
    this.state = next; this.connected = navigator.onLine;
    this.engine.setRoomDrags(this.browser, next.leases);
    this.engine.acknowledgeRoom(next.table);
    this.configurePermissions(this.connected);
    this.engine.setRoomHistory(next.history, redo => void this.reverse(redo));
    this.engine.setRoomPresence(next.participants, next.presence, next.me.id);
    this.updateStatus();
    if (this.pending && this.connected && !this.inFlight) this.schedule();
  }
  private keepDraft(message: string) {
    const draft = this.engine.getRoomTable();
    if (!this.rejectedDraft || tableChanges(this.state.table, draft).length) this.rejectedDraft = draft;
    this.pending = false;
    this.error(message);
  }
  private schedule() {
    if (this.closed || this.state.protocol !== ROOM_PROTOCOL) return;
    this.pending = true;
    if (this.engine.editingId) this.updateStatus();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 180);
  }
  private async flush() {
    if (this.closed || !this.connected || this.inFlight || !this.pending) return;
    // Pointer gestures and inline text sessions commit when finished. A remote
    // event must not turn their intermediate state into a durable operation.
    if (this.engine.gesture || this.engine.editingId || this.leasePending) { this.schedule(); return; }
    const changes = tableChanges(this.state.table, this.engine.getRoomTable());
    this.pending = false;
    if (!this.flight && !changes.length) { this.updateStatus(); void this.releaseIdleDrag(); return; }
    if (!this.flight) this.flight = { operation: { id: crypto.randomUUID(), changes, expected: expectations(this.state.table, changes, this.state.versions) }, acknowledged: false };
    if (this.flight.acknowledged) { this.flight = null; if (changes.length) this.schedule(); else this.updateStatus(); return; }
    this.inFlight = true; this.update(this.state, "saving");
    try {
      const response = await fetch(`/api/rooms/${this.state.id}/operations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...this.flight.operation, client: this.browser }), signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (this.closed) return;
      if (!response.ok) {
        this.keepDraft(result.error || "Your edit was rejected by the room server.");
        const received = result.state ?? await roomRequest(`/api/rooms/${this.state.id}/state`);
        const latest = received.revision < this.state.revision ? this.state : received;
        this.flight = null; this.engine.applyRoom(latest.table); this.state = latest;
        this.engine.setRoomHistory(latest.history, redo => void this.reverse(redo));
      } else this.receiveState(result);
      this.flight = null;
      if (tableChanges(this.state.table, this.engine.getRoomTable()).length) this.pending = true;
    } catch {
      if (!this.closed) { this.pending = true; this.connected = false; this.error("The connection was interrupted. Your edit remains in this window. Reconnect or export it before leaving."); }
    } finally {
      this.inFlight = false;
      if (!this.closed) { this.configurePermissions(this.connected); this.updateStatus(); if (this.pending && this.connected) this.schedule(); void this.releaseIdleDrag(); }
    }
  }
  private updateStatus() {
    this.update(this.state, !this.connected ? "offline" : this.state.protocol !== ROOM_PROTOCOL ? "update-required" : this.pending || this.inFlight ? "saving" : "connected");
  }
  async reconnect() { this.receiveState(await roomRequest(`/api/rooms/${this.state.id}/state`)); }
  private async reverse(redo: boolean) {
    if (this.state.protocol !== ROOM_PROTOCOL) return;
    if (!this.connected || this.closed || this.inFlight || this.engine.gesture || this.engine.editingId) { this.error("Finish your current edit before using Undo or Redo."); return; }
    if (this.pending || tableChanges(this.state.table, this.engine.getRoomTable()).length) {
      this.pending = true; await this.flush();
      if (!this.connected || this.pending) return;
    }
    this.inFlight = true; this.updateStatus();
    this.reversing ??= { id: crypto.randomUUID(), redo };
    try {
      const request = this.reversing;
      const response = await fetch(`/api/rooms/${this.state.id}/${request.redo ? "redo" : "undo"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: request.id, client: this.browser }), signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (this.closed) return;
      if (response.ok) this.receiveState(result);
      else { this.error(result.error || "This edit could not be reversed."); if (result.state) this.receiveState(result.state); }
      this.reversing = null;
    } catch { this.offline(); this.error("The connection was interrupted. Reconnect to check whether Undo or Redo was saved."); }
    finally { this.inFlight = false; if (!this.closed) this.updateStatus(); }
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
  private async share(ids: string[], policy: ObjectAccess) {
    await this.settle();
    this.receiveState(await roomRequest(`/api/rooms/${this.state.id}/access`, { ids, policy, revision: this.state.revision, client: this.browser }));
  }
  private async leaseRequest(action: "claim" | "renew" | "release", ids?: string[]) {
    const changes = (ids ?? []).map(id => ({ key: `object:${id}`, value: this.state.table.scene.objects.find(o => o.id === id)! }));
    const response = await fetch(`/api/rooms/${this.state.id}/leases`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, client: this.browser, ...(ids ? { ids, expected: expectations(this.state.table, changes, this.state.versions) } : {}) }), signal: AbortSignal.timeout(5000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "This object could not be grabbed.");
    if (!this.closed) { this.state = { ...this.state, leases: result.leases }; this.engine.setRoomDrags(this.browser, result.leases); }
  }
  private claimDrag(ids: string[]) {
    if (!ids.length || this.closed) return;
    // A new piece has no peer-visible version to claim yet. Preserve it when
    // it is positioned immediately, before its first debounced save.
    const known = new Set(hierarchy(this.engine.scene, ids).filter(id => this.state.table.scene.objects.some(o => o.id === id)));
    ids = [...known].filter(id => !known.has(this.state.table.scene.objects.find(o => o.id === id)?.parentId ?? ""));
    if (!ids.length) return;
    if (this.leased && this.state.leases.some(l => l.client === this.browser && l.expires > Date.now() && ids.every(id => l.objects.includes(id)))) return;
    const gesture = this.engine.gesture, scope = hierarchy(this.state.table.scene, ids);
    this.leasePending++;
    this.leaseWork = this.leaseWork.then(async () => {
      if (this.closed) return;
      try { await this.leaseRequest("claim", ids); this.leased = true; }
      catch (error) {
        if (this.closed) return;
        if (this.engine.gesture === gesture) this.engine.abortRoomDrag();
        const remaining = tableChanges(this.state.table, this.engine.getRoomTable()).filter(c => !scope.includes(c.key.slice(7)));
        this.engine.mergeRoom(applyChanges(this.state.table, remaining) ?? this.state.table);
        this.engine.roomNotice(error instanceof Error ? error.message : "This object could not be grabbed.");
      }
    }).finally(() => { this.leasePending--; if (!this.closed) { if (this.pending) this.schedule(); void this.releaseIdleDrag(); } });
  }
  private async releaseIdleDrag() {
    if (!this.leased || this.leasePending || this.inFlight || this.engine.gesture || tableChanges(this.state.table, this.engine.getRoomTable()).length) return;
    // Serialize a release with the next claim, including a quick second grab.
    this.leased = false;
    this.leaseWork = this.leaseWork.then(() => this.leaseRequest("release")).catch(() => {});
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
    if (!this.inFlight && !this.flight && !tableChanges(this.state.table, this.engine.getRoomTable()).length) { this.pending = false; return; }
    if (this.inFlight) throw new Error("Wait for the current room change to finish saving.");
    await this.flush();
    if (this.pending || !this.connected) throw new Error("The room is offline. Rejoin or export your current table before leaving.");
  }
  close() {
    this.closed = true; this.source.close(); clearInterval(this.presenceTimer); clearInterval(this.leaseTimer);
    void fetch(`/api/rooms/${this.state.id}/leases`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "release", client: this.browser }), keepalive: true }).catch(() => {});
    window.removeEventListener("offline", this.offline); window.removeEventListener("online", this.online);
    window.removeEventListener("beforeunload", this.beforeUnload);
    if (this.timer) clearTimeout(this.timer);
  }
}
export async function roomRequest(url: string, value?: unknown): Promise<RoomState> {
  const response = await fetch(url, value === undefined ? { signal: AbortSignal.timeout(8000) } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value), signal: AbortSignal.timeout(15000) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "The online service is unavailable. Start the online server to create or join a room.");
  const state = readRoomState(result);
  if (!state) throw new Error("The room server sent an invalid response. Restart the online server and refresh this page. Your saved table has been kept intact.");
  return state;
}
