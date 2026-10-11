import type { TableEngine } from "./engine";
import { ROOM_PROTOCOL, readRoomState, validParticipant, validPresence, type RoomState, type SharedTable } from "./room-state";
import { recoveryFile, tableFile } from "./table-storage";
import { advanceVersions, applyChanges, expectations, operationConflict, tableChanges, type RoomOperation, type Change } from "./room-operations";
import { editsAllowed, hierarchy, type ObjectAccess, type DragLease } from "./room-permissions";
import { parseRoomDice, validRollReceipts, type RollRequest } from "./room-dice";
import type { DiceSetup } from "./dice-types";
import type { RollArea } from "./dice-throw";
import { roomImage, roomImageLimit } from "./room-artwork";
import { roomMedia, roomMediaLimit, roomMediaTypes } from "./room-media";
class ArtworkRejected extends Error {}
export type RoomStatus = "connected" | "saving" | "offline" | "update-required" | "removed";
class RoomRequestError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}
type ManagementRequest = { id: string; kind: "invitation" | "remove"; invite: string; member?: string };
type ProfileRequest = { id: string; name: string; color: string; version: number };
export class RoomClient {
  state: RoomState;
  private source: EventSource;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private presenceTimer: ReturnType<typeof setInterval>;
  private inFlight = false;
  private pending = false;
  private connected = false;
  private closed = false;
  private removed = false;
  private management: ManagementRequest | null = null;
  private managing = false;
  private profile: ProfileRequest | null = null;
  private profiling = false;
  private get inactive() { return this.closed || this.removed; }
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
  private rollFlight: RollRequest | null = null;
  private rollPosting = false;
  private diceClock = -Infinity;
  private uploadedArtwork = new Map<string, string>();
  rejectedDraft: SharedTable | null = null;
  constructor(private engine: TableEngine, state: RoomState,
    private update: (state: RoomState, status: RoomStatus) => void,
    private error: (message: string) => void) {
    const decoded = readRoomState(state);
    if (!decoded) throw new Error("The room server sent an invalid room. Your local table has been kept intact.");
    this.state = decoded;
    engine.roomId = decoded.id;
    this.configurePermissions(false);
    engine.enterRoom(decoded.table, () => this.schedule());
    if (decoded.protocol === ROOM_PROTOCOL) this.receiveDice(decoded);
    engine.setRoomDrags(this.browser, decoded.leases, ids => this.claimDrag(ids), () => queueMicrotask(() => void this.releaseIdleDrag()));
    this.source = new EventSource(`/api/rooms/${state.id}/events?client=${this.browser}`);
    this.source.addEventListener("removed", () => this.remove());
    this.source.addEventListener("dice", e => {
      if (this.inactive) return;
      try {
        this.receiveDice(JSON.parse((e as MessageEvent).data));
        if (!this.connected) this.online();
      }
      catch { this.offline(); this.error("The shared roll could not be read. Reconnect to load the saved room history."); }
    });
    this.source.addEventListener("leases", e => {
      if (this.inactive) return;
      const leases = JSON.parse((e as MessageEvent).data) as DragLease[];
      this.state = { ...this.state, leases }; engine.setRoomDrags(this.browser, leases);
    });
    this.source.addEventListener("state", e => this.receiveEvent(e));
    this.source.addEventListener("table", e => {
      if (this.inactive) return;
      this.receiveEvent(e);
    });
    this.source.addEventListener("presence", e => {
      if (this.inactive) return;
      try {
        const next = JSON.parse((e as MessageEvent).data);
        if (!Array.isArray(next.participants) || !next.participants.every(validParticipant) || !Array.isArray(next.presence) || !next.presence.every((p: any) => typeof p?.id === "string" && validPresence(p))) throw new Error("Invalid presence");
        this.state = { ...this.state, participants: next.participants, presence: next.presence };
        engine.setRoomPresence(next.participants, next.presence, this.state.me.id);
        this.updateStatus();
      } catch { this.offline(); this.error("The participant update could not be read. Reconnect to load the room."); }
    });
    this.source.onerror = () => {
      this.offline();
      if (!this.inactive) void roomRequest(`/api/rooms/${this.state.id}/state`).catch(error => {
        if (error instanceof RoomRequestError) this.checkRemoved(error);
      });
    };
    window.addEventListener("offline", this.offline);
    window.addEventListener("online", this.online);
    window.addEventListener("beforeunload", this.beforeUnload);
    this.presenceTimer = setInterval(() => void this.sendPresence(), 120);
    this.leaseTimer = setInterval(() => {
      if (this.leased && this.connected && !this.leasePending) this.leaseWork = this.leaseWork.then(async () => {
        if (!this.leased || this.inactive) return;
        try { await this.leaseRequest("renew"); }
        catch { if (!this.inactive) { this.leased = false; this.engine.abortRoomDrag(); this.engine.roomNotice("The drag connection was interrupted. Grab the object again."); } }
      });
    }, 1000);
  }
  private offline = () => {
    if (this.inactive || !this.connected) return;
    this.connected = false;
    this.configurePermissions(false);
    this.update(this.state, "offline");
  };
  private online = () => {
    if (this.inactive) return;
    void this.reconnect().catch(() => this.offline());
  };
  private remove() {
    if (this.inactive) return;
    const draft = this.engine.getRoomTable();
    if (tableChanges(this.state.table, draft).length) this.rejectedDraft = structuredClone(draft);
    this.removed = true; this.connected = false; this.pending = false; this.rollFlight = null; this.profile = null;
    this.source.close(); clearInterval(this.presenceTimer); clearInterval(this.leaseTimer);
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    // Close inline typing only after preserving its latest content.
    if (this.engine.editingId) this.engine.closeEditor();
    this.configurePermissions(false);
    this.engine.setRoomHistory({ undo: false, redo: false }, () => {});
    this.engine.setRoomDrags(this.browser, []); this.engine.setRoomPresence([], [], this.state.me.id);
    this.engine.setRoomDiceSending(false);
    this.updateStatus();
    this.error("The GM removed you from this room. Your local table is still saved separately.");
  }
  private checkRemoved(result: { code?: string }) {
    if (result.code !== "ROOM_REMOVED") return false;
    this.remove(); return true;
  }
  private beforeUnload = (event: BeforeUnloadEvent) => {
    if (!this.closed && (this.rejectedDraft || this.management || this.profile || this.rollFlight || this.inFlight || this.flight && !this.flight.acknowledged || tableChanges(this.state.table, this.engine.getRoomTable()).length)) {
      event.preventDefault(); event.returnValue = "";
    }
  };
  private configurePermissions(connected: boolean) {
    const supported = !this.removed && this.state.protocol === ROOM_PROTOCOL;
    this.engine.setRoomAccess(this.state.me.id, this.state.playerEditing, this.state.access, this.state.participants, (ids, policy) => this.share(ids, policy));
    this.engine.setRoomPermissions(supported && this.state.me.role === "gm", supported, connected);
  }
  private receiveEvent(event: Event) {
    if (this.inactive) return;
    try { this.receiveState(JSON.parse((event as MessageEvent).data)); }
    catch { this.offline(); this.error("The room update could not be read. Your current table has been kept intact. Restart the online server and refresh both browsers."); }
  }
  private receiveState(value: unknown) {
    if (this.inactive) return;
    let next = readRoomState(value, this.state);
    if (!next) { this.offline(); this.error("The room server sent an invalid update. Your current table has been kept intact. Restart the online server and refresh both browsers."); return; }
    if (next.protocol === ROOM_PROTOCOL) {
      this.receiveDice(next);
      if (this.state.dice.sequence > next.dice.sequence) next = { ...next, dice: this.state.dice, diceAccepted: this.state.diceAccepted };
    }
    if (this.inactive || next.revision < this.state.revision) return;
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
    if (this.management && next.accepted.some(r => r.id === this.management!.id)) this.management = null;
    if (this.profile && next.accepted.some(r => r.id === this.profile!.id)) this.profile = null;
    let base = this.state.table, versions = this.state.versions;
    const receipt = this.flight && next.accepted.find(r => r.id === this.flight!.operation.id);
    if (receipt && this.flight && !this.flight.acknowledged) {
      const optimistic = applyChanges(base, this.flight.operation.changes);
      if (optimistic) { versions = advanceVersions(base, optimistic, this.flight.operation.changes, versions, receipt.revision); base = optimistic; }
      this.flight.acknowledged = true;
    }
    const changes = tableChanges(base, this.engine.getRoomTable());
    const operation = { id: "local-rebase-only", changes, expected: expectations(base, changes, versions) };
    const local = applyChanges(next.table, changes, true);
    const permitted = !!local && editsAllowed(next.table, local, next.access, next.me.id, next.me.role === "gm", next.playerEditing);
    const conflict = changes.length > 0 && (!permitted || operationConflict(next.table, operation, next.versions));
    const merged = conflict ? null : applyChanges(next.table, changes, true);
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
    if (this.rollFlight && this.connected && !this.rollPosting) void this.submitRoll();
    if (this.management && this.connected && !this.managing) void this.retryManagement();
    if (this.profile && this.connected && !this.profiling) void this.postProfile().catch(error => { if (!this.inactive) this.error(error.message); });
  }
  private keepDraft(message: string) {
    const draft = this.engine.getRoomTable();
    if (!this.rejectedDraft || tableChanges(this.state.table, draft).length) this.rejectedDraft = draft;
    this.pending = false;
    this.error(message);
  }
  private schedule() {
    if (this.inactive || this.state.protocol !== ROOM_PROTOCOL) return;
    this.pending = true;
    if (this.engine.editingId) this.updateStatus();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 180);
  }
  private async flush() {
    if (this.inactive || !this.connected || this.inFlight || !this.pending) return;
    // Pointer gestures and inline text sessions commit when finished. A remote
    // event must not turn their intermediate state into a durable operation.
    if (this.engine.gesture || this.engine.editingId || this.leasePending) { this.schedule(); return; }
    let changes = tableChanges(this.state.table, this.engine.getRoomTable());
    this.pending = false;
    if (!this.flight && !changes.length) { this.updateStatus(); void this.releaseIdleDrag(); return; }
    if (this.flight?.acknowledged) { this.flight = null; if (changes.length) this.schedule(); else this.updateStatus(); return; }
    this.inFlight = true; this.update(this.state, "saving");
    try {
      if (!this.flight) {
        const images = await this.uploadArtwork(changes);
        const media = await this.uploadMedia(changes);
        for (const [ref, url] of media) images.set(ref, url);
        if (this.inactive) return;
        this.engine.replaceRoomAssets(images);
        if (!this.connected || this.engine.gesture || this.engine.editingId || this.leasePending) { this.pending = true; return; }
        // A remote edit may have arrived while the image was uploading. Build
        // the operation against the rebased table, never the pre-upload snapshot.
        changes = tableChanges(this.state.table, this.engine.getRoomTable());
        if (!changes.length) return;
        this.flight = { operation: { id: crypto.randomUUID(), changes, expected: expectations(this.state.table, changes, this.state.versions) }, acknowledged: false };
      }
      const response = await fetch(`/api/rooms/${this.state.id}/operations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...this.flight.operation, client: this.browser }), signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (this.inactive) return;
      if (this.checkRemoved(result)) return;
      if (!response.ok) {
        this.keepDraft(result.error || "Your edit was rejected by the room server.");
        const received = result.state ?? await roomRequest(`/api/rooms/${this.state.id}/state`);
        if (this.inactive) return;
        const latest = received.revision < this.state.revision ? this.state : received;
        this.flight = null; this.engine.applyRoom(latest.table); this.state = latest;
        this.engine.setRoomHistory(latest.history, redo => void this.reverse(redo));
      } else this.receiveState(result);
      this.flight = null;
      if (tableChanges(this.state.table, this.engine.getRoomTable()).length) this.pending = true;
    } catch (error) {
      if (error instanceof RoomRequestError && this.checkRemoved(error)) return;
      if (!this.inactive && error instanceof ArtworkRejected) {
        this.keepDraft(error.message); this.flight = null; this.engine.applyRoom(this.state.table);
      } else if (!this.inactive) { this.pending = true; this.connected = false; this.error("The connection was interrupted. Your edit remains in this window. Reconnect or export it before leaving."); }
    } finally {
      this.inFlight = false;
      if (!this.inactive) { this.configurePermissions(this.connected); this.updateStatus(); if (this.pending && this.connected) this.schedule(); void this.releaseIdleDrag(); }
    }
  }
  private async uploadArtwork(changes: Change[]) {
    const images = new Set(changes.filter(c => c.key.startsWith("object:") && (c.value as import("./model").Surface | null)?.image !== this.state.table.scene.objects.find(o => o.id === c.key.slice(7))?.image)
      .map(c => (c.value as import("./model").Surface | null)?.image).filter((image): image is string => !!image?.startsWith("data:image/")));
    const replacements = new Map<string, string>();
    for (const image of images) {
      if (this.inactive) break;
      const blob = await (await fetch(image)).blob();
      if (blob.size > roomImageLimit) throw new ArtworkRejected("This image exceeds the 20 MB room artwork limit. Your unsent table can be exported.");
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), n => n.toString(16).padStart(2, "0")).join("");
      let url = this.uploadedArtwork.get(digest);
      if (!url) {
        if (this.inactive) break;
        const response = await fetch(`/api/rooms/${this.state.id}/assets`, { method: "POST", headers: { "Content-Type": blob.type }, body: blob, signal: AbortSignal.timeout(60000) });
        const result = await response.json();
        if (this.checkRemoved(result)) throw new RoomRequestError(result.error, result.code);
        if (!response.ok) {
          if (response.status < 500 && response.status !== 429) throw new ArtworkRejected((result.error || "The artwork was rejected.") + " Your unsent table can be exported.");
          throw new Error(result.error || "Artwork upload interrupted.");
        }
        if (roomImage(result.image)?.room !== this.state.id) throw new Error("Invalid artwork response.");
        url = result.image as string; this.uploadedArtwork.set(digest, url);
      }
      replacements.set(image, url);
    }
    return replacements;
  }
  private updateStatus() {
    this.update(this.state, this.removed ? "removed" : !this.connected ? "offline" : this.state.protocol !== ROOM_PROTOCOL ? "update-required" : this.pending || this.inFlight || this.rollFlight || this.management || this.profile ? "saving" : "connected");
  }
  private async uploadMedia(changes: Change[]) {
    const refs = new Set(changes.filter(c => c.key.startsWith("object:")).flatMap(c => {
      const object = c.value as import("./model").Surface | null;
      return [object?.video, object?.audio].filter((ref): ref is string => !!ref?.startsWith("blob:"));
    })), replacements = new Map<string, string>();
    for (const ref of refs) {
      if (this.inactive) break;
      const blob = this.engine.roomMediaBlob(ref);
      if (!blob) throw new ArtworkRejected("This media file is unavailable. Export the unsent table or try another file.");
      if (blob.size > roomMediaLimit) throw new ArtworkRejected("This media exceeds the 64 MB room file limit. Your unsent table can be exported.");
      const aliases: Record<string, string> = { "audio/x-wav": "audio/wav", "audio/wave": "audio/wav", "audio/mp3": "audio/mpeg", "audio/x-flac": "audio/flac", "audio/x-m4a": "audio/mp4" };
      const type = aliases[blob.type] ?? blob.type;
      if (!roomMediaTypes.includes(type)) throw new ArtworkRejected("Use MP4, WebM, MP3, WAV, Ogg, FLAC or AAC media. Your unsent table can be exported.");
      const digest = "media:" + Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), n => n.toString(16).padStart(2, "0")).join("");
      let url = this.uploadedArtwork.get(digest);
      if (!url) {
        if (this.inactive) break;
        const response = await fetch(`/api/rooms/${this.state.id}/media`, { method: "POST", headers: { "Content-Type": type }, body: blob, signal: AbortSignal.timeout(60000) });
        const result = await response.json();
        if (this.checkRemoved(result)) throw new RoomRequestError(result.error, result.code);
        if (!response.ok) {
          if (response.status < 500 && response.status !== 429) throw new ArtworkRejected((result.error || "The media was rejected.") + " Your unsent table can be exported.");
          throw new Error(result.error || "Media upload interrupted.");
        }
        if (roomMedia(result.media)?.room !== this.state.id) throw new Error("Invalid media response.");
        url = result.media as string; this.uploadedArtwork.set(digest, url);
      }
      replacements.set(ref, url);
    }
    return replacements;
  }
  private receiveDice(value: unknown) {
    if (this.inactive || this.state.protocol !== ROOM_PROTOCOL) return;
    const v = value as Record<string, any>, dice = parseRoomDice(v?.dice);
    if (!dice || !validRollReceipts(v.diceAccepted, dice.sequence) || !Number.isSafeInteger(v.serverTime) || v.serverTime < 0) throw new Error("Invalid shared dice update");
    this.diceClock = Math.max(this.diceClock, v.serverTime - performance.now());
    if (this.rollFlight && v.diceAccepted.some((r: { id: string }) => r.id === this.rollFlight!.id)) { this.rollFlight = null; this.engine.setRoomDiceSending(false); }
    if (dice.sequence >= this.state.dice.sequence) this.state = { ...this.state, dice, diceAccepted: v.diceAccepted, serverTime: v.serverTime };
    this.engine.setRoomDice(this.state.dice, this.diceClock, (setup, area) => this.queueRoll(setup, area));
    this.updateStatus();
  }
  private queueRoll(setup: DiceSetup, area: RollArea) {
    if (this.inactive || !this.connected || this.rollFlight || this.rollPosting) return;
    this.rollFlight = { id: crypto.randomUUID(), setup: structuredClone(setup), area };
    this.engine.setRoomDiceSending(true); this.updateStatus(); void this.submitRoll();
  }
  private async submitRoll() {
    if (!this.rollFlight || this.rollPosting || !this.connected || this.inactive) return;
    const request = this.rollFlight; this.rollPosting = true;
    try {
      const response = await fetch(`/api/rooms/${this.state.id}/rolls`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (this.inactive) return;
      if (this.checkRemoved(result)) return;
      if (response.ok) this.receiveDice(result);
      else if (this.rollFlight?.id === request.id) { this.rollFlight = null; this.engine.setRoomDiceSending(false); this.engine.roomNotice(result.error || "The dice roll could not be saved."); }
    } catch {
      if (!this.inactive && this.rollFlight?.id === request.id) { this.offline(); this.error("The roll connection was interrupted. Reconnect to check the saved result before rolling again. Your request will be retried without rolling twice."); }
    } finally { this.rollPosting = false; if (!this.inactive) this.updateStatus(); }
  }
  async reconnect() {
    if (this.inactive) return;
    try { this.receiveState(await roomRequest(`/api/rooms/${this.state.id}/state`)); }
    catch (error) { if (error instanceof RoomRequestError) this.checkRemoved(error); throw error; }
  }
  async manage(kind: ManagementRequest["kind"], member?: string, invite = this.state.invite) {
    if (this.inactive || !this.connected || this.state.protocol !== ROOM_PROTOCOL || this.state.me.role !== "gm" || !invite) throw new Error("Reconnect as GM before changing room access.");
    if (this.managing) throw new Error("Wait for the current room control to finish saving.");
    if (this.management && (this.management.kind !== kind || this.management.member !== member)) throw new Error("Reconnect to check the previous room control before starting another.");
    this.management ??= { id: crypto.randomUUID(), kind, member, invite };
    await this.postManagement();
  }
  async updateProfile(name: string, color: string, version: number) {
    if (this.inactive || !this.connected || this.state.protocol !== ROOM_PROTOCOL) throw new Error("Reconnect before editing your identity.");
    if (this.profiling) throw new Error("Wait for your identity to finish saving.");
    if (this.profile && (this.profile.name !== name || this.profile.color !== color)) throw new Error("Reconnect to check your previous identity update before changing it again.");
    this.profile ??= { id: crypto.randomUUID(), name, color, version };
    await this.postProfile();
  }
  private async postProfile() {
    if (!this.profile || this.profiling || this.inactive) return;
    const request = this.profile; this.profiling = true; this.updateStatus();
    try {
      const response = await fetch(`/api/rooms/${this.state.id}/profile`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (this.inactive || this.checkRemoved(result)) return;
      if (!response.ok) {
        if (this.profile?.id === request.id) this.profile = null;
        if (result.state) this.receiveState(result.state);
        throw new RoomRequestError(result.error || "Your identity update was rejected.");
      }
      // SSE may already have acknowledged this profile and delivered newer
      // transient views. A late HTTP copy must not rewind that presence.
      if (!this.state.accepted.some(receipt => receipt.id === request.id)) this.receiveState(result);
    } catch (error) {
      if (this.state.accepted.some(receipt => receipt.id === request.id)) return;
      if (!this.inactive && !(error instanceof RoomRequestError) && this.profile?.id === request.id) {
        this.offline(); throw new Error("The identity connection was interrupted. Rejoin to check it; retrying will not save it twice.");
      }
      throw error;
    } finally { this.profiling = false; if (!this.inactive) this.updateStatus(); }
  }
  private async retryManagement() {
    try { await this.postManagement(); } catch (error) { if (!this.inactive) this.error(error instanceof Error ? error.message : "Room controls could not be saved."); }
  }
  private async postManagement() {
    if (!this.management || this.managing || this.inactive) return;
    const request = this.management; this.managing = true; this.updateStatus();
    try {
      const response = await fetch(`/api/rooms/${this.state.id}/manage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (this.inactive || this.checkRemoved(result)) return;
      if (!response.ok) {
        if (this.management?.id === request.id) this.management = null;
        if (result.state) this.receiveState(result.state);
        throw new RoomRequestError(result.error || "The room control was rejected.");
      }
      this.receiveState(result);
    } catch (error) {
      if (this.state.accepted.some(receipt => receipt.id === request.id)) return; // SSE can acknowledge a lost HTTP reply.
      if (!this.inactive && !(error instanceof RoomRequestError) && this.management?.id === request.id) {
        this.offline(); throw new Error("The room control connection was interrupted. Rejoin to check it; retrying will not apply it twice.");
      }
      throw error;
    } finally { this.managing = false; if (!this.inactive) this.updateStatus(); }
  }
  private async reverse(redo: boolean) {
    if (this.state.protocol !== ROOM_PROTOCOL) return;
    if (!this.connected || this.inactive || this.inFlight || this.engine.gesture || this.engine.editingId) { this.error("Finish your current edit before using Undo or Redo."); return; }
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
      if (this.inactive) return;
      if (this.checkRemoved(result)) return;
      if (response.ok) this.receiveState(result);
      else { this.error(result.error || "This edit could not be reversed."); if (result.state) this.receiveState(result.state); }
      this.reversing = null;
    } catch { if (!this.inactive) { this.offline(); this.error("The connection was interrupted. Reconnect to check whether Undo or Redo was saved."); } }
    finally { this.inFlight = false; if (!this.inactive) this.updateStatus(); }
  }
  private async sendPresence() {
    if (!this.connected || this.inactive || this.presenceInFlight) return;
    const value = this.engine.getRoomPresence(), signature = JSON.stringify(value);
    if (signature === this.lastPresence && (!value.laser || Date.now() - this.presenceSentAt < 600)) return;
    this.presenceInFlight = true;
    try {
      const response = await fetch(`/api/rooms/${this.state.id}/presence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: signature, signal: AbortSignal.timeout(5000) });
      if (!response.ok) { this.checkRemoved(await response.json()); return; }
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
    if (this.inactive) return;
    const changes = (ids ?? []).map(id => ({ key: `object:${id}`, value: this.state.table.scene.objects.find(o => o.id === id)! }));
    const response = await fetch(`/api/rooms/${this.state.id}/leases`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, client: this.browser, ...(ids ? { ids, expected: expectations(this.state.table, changes, this.state.versions) } : {}) }), signal: AbortSignal.timeout(5000) });
    const result = await response.json();
    if (this.checkRemoved(result)) throw new RoomRequestError(result.error, result.code);
    if (!response.ok) throw new Error(result.error || "This object could not be grabbed.");
    if (!this.inactive) { this.state = { ...this.state, leases: result.leases }; this.engine.setRoomDrags(this.browser, result.leases); }
  }
  private claimDrag(ids: string[]) {
    if (!ids.length || this.inactive) return;
    // A new piece has no peer-visible version to claim yet. Preserve it when
    // it is positioned immediately, before its first debounced save.
    const known = new Set(hierarchy(this.engine.scene, ids).filter(id => this.state.table.scene.objects.some(o => o.id === id)));
    ids = [...known].filter(id => !known.has(this.state.table.scene.objects.find(o => o.id === id)?.parentId ?? ""));
    if (!ids.length) return;
    if (this.leased && this.state.leases.some(l => l.client === this.browser && l.expires > Date.now() && ids.every(id => l.objects.includes(id)))) return;
    const gesture = this.engine.gesture, scope = hierarchy(this.state.table.scene, ids);
    this.leasePending++;
    this.leaseWork = this.leaseWork.then(async () => {
      if (this.inactive) return;
      try { await this.leaseRequest("claim", ids); if (!this.inactive) this.leased = true; }
      catch (error) {
        if (this.inactive) return;
        if (this.engine.gesture === gesture) this.engine.abortRoomDrag();
        const remaining = tableChanges(this.state.table, this.engine.getRoomTable()).filter(c => !scope.includes(c.key.slice(7)));
        this.engine.mergeRoom(applyChanges(this.state.table, remaining, true) ?? this.state.table);
        this.engine.roomNotice(error instanceof Error ? error.message : "This object could not be grabbed.");
      }
    }).finally(() => { this.leasePending--; if (!this.inactive) { if (this.pending) this.schedule(); void this.releaseIdleDrag(); } });
  }
  private async releaseIdleDrag() {
    if (this.inactive || !this.leased || this.leasePending || this.inFlight || this.engine.gesture || tableChanges(this.state.table, this.engine.getRoomTable()).length) return;
    // Serialize a release with the next claim, including a quick second grab.
    this.leased = false;
    this.leaseWork = this.leaseWork.then(() => this.leaseRequest("release")).catch(() => {});
  }
  requestSave() { this.schedule(); }
  async exportRejected() {
    if (!this.rejectedDraft) return;
    const stored = this.engine.storedRoomTable(this.rejectedDraft), recovery = this.removed && this.rejectedDraft.scene.objects.some(o => roomImage(o.image) || roomMedia(o.video) || roomMedia(o.audio));
    const file = recovery ? await recoveryFile(stored) : await tableFile(stored);
    const url = URL.createObjectURL(new Blob([file], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = recovery ? "Table Goblin unsent room edit.recovery.json" : "Table Goblin unsent room edit.goblin.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  async settle() {
    if (this.profile) throw new Error("Reconnect to check whether your identity update was saved before leaving.");
    if (this.management) throw new Error("Reconnect to check whether the room control was saved before leaving.");
    if (this.removed) return;
    if (this.rollFlight) throw new Error("Wait for the dice roll to be saved, or reconnect to check its result before leaving.");
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.inFlight && !this.flight && !tableChanges(this.state.table, this.engine.getRoomTable()).length) { this.pending = false; return; }
    if (this.inFlight) throw new Error("Wait for the current room change to finish saving.");
    await this.flush();
    if (this.pending || !this.connected) throw new Error("The room is offline. Rejoin or export your current table before leaving.");
  }
  close() {
    this.closed = true; this.source.close(); clearInterval(this.presenceTimer); clearInterval(this.leaseTimer);
    if (!this.removed) void fetch(`/api/rooms/${this.state.id}/leases`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "release", client: this.browser }), keepalive: true }).catch(() => {});
    window.removeEventListener("offline", this.offline); window.removeEventListener("online", this.online);
    window.removeEventListener("beforeunload", this.beforeUnload);
    if (this.timer) clearTimeout(this.timer);
  }
}
export async function roomRequest(url: string, value?: unknown): Promise<RoomState> {
  const response = await fetch(url, value === undefined ? { signal: AbortSignal.timeout(8000) } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value), signal: AbortSignal.timeout(15000) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new RoomRequestError(result.error || "The online service is unavailable. Start the online server to create or join a room.", result.code);
  const state = readRoomState(result);
  if (!state) throw new Error("The room server sent an invalid response. Restart the online server and refresh this page. Your saved table has been kept intact.");
  return state;
}
