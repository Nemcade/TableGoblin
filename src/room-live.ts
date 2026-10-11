import type { TableEngine } from "./engine";
import type { RoomState } from "./room-state";
import type { Media } from "./render";
export type LiveSource = { source: string; generation: string; kind: "screen" | "camera" | "audio"; actor: string; browser: string; label: string; name: string };
type Snapshot = { instance: string; sequence: number; sources: LiveSource[] };
type Publication = { stream: MediaStream; generation: string; kind: LiveSource["kind"]; label: string; pending: boolean };
type Peer = { source: LiveSource; remote: string; connection: string; pc: RTCPeerConnection; candidates: RTCIceCandidateInit[];
  work: Promise<void>; media?: Media; timer: ReturnType<typeof setTimeout>; status: string };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9-]{36}$/i.test(v);
function snapshot(value: any): value is Snapshot {
  return value && uuid(value.instance) && Number.isSafeInteger(value.sequence) && value.sequence >= 0 &&
    Array.isArray(value.sources) && value.sources.length <= 8 && value.sources.every((s: any) => s &&
      [s.source, s.generation, s.actor, s.browser].every(uuid) && ["screen", "camera", "audio"].includes(s.kind) &&
      typeof s.label === "string" && s.label.length <= 160 && typeof s.name === "string" && s.name.length <= 32) &&
    new Set(value.sources.map((s: LiveSource) => s.source)).size === value.sources.length;
}
/** One publisher creates offers; receivers only answer. Copies share a connection.
 * Browser identities and connection generations scope every directed signal. */
export class RoomLive {
  sources: LiveSource[] = [];
  private instance = "";
  private sequence = -1;
  private publications = new Map<string, Publication>();
  private peers = new Map<string, Peer>();
  private failed = new Set<string>();
  private retryAt = new Map<string, { attempts: number; at: number }>();
  private stopping = new Set<string>();
  private timer: ReturnType<typeof setInterval>;
  private state: RoomState;
  private connected = false;
  private disposed = false;
  private configured = false;
  private configuring = false;
  private configRetryAt = 0;
  private configRefreshAt = Infinity;
  private iceServers: RTCIceServer[] = [];
  private soundEnabled = false;
  private listening = new Map<string, { muted: boolean; volume: number; blocked: boolean }>();
  constructor(private engine: TableEngine, state: RoomState, private browser: string,
    private revoked: () => void) {
    this.state = state; engine.roomLive = this;
    this.timer = setInterval(() => void this.sync(), 250);
    void this.configure();
  }
  private async configure() {
    if (this.configuring || this.configured && performance.now() < this.configRefreshAt || this.disposed || performance.now() < this.configRetryAt) return;
    this.configuring = true;
    try {
      const v = await this.request();
      if (this.disposed) return;
      const iceServers = Array.isArray(v.iceServers) ? v.iceServers : [];
      // Validate browser support/configuration before accepting a capture. Bad
      // relay settings must not throw from the background subscription loop.
      const probe = new RTCPeerConnection({ iceServers }); probe.close();
      this.iceServers = iceServers;
      this.configRefreshAt = Number.isFinite(v.iceExpiresAt)
        ? performance.now() + Math.max(60_000, (v.iceExpiresAt - Date.now()) / 2) : Infinity;
      for (const peer of this.peers.values()) peer.pc.setConfiguration({ iceServers });
      this.configured = true; this.receive(v);
    } catch (error) {
      this.configRetryAt = performance.now() + 5000;
      if (!this.disposed) this.engine.roomNotice((error as Error).message);
    } finally { this.configuring = false; }
  }
  private async request(value?: Record<string, unknown>) {
    const response = await fetch(`/api/rooms/${this.state.id}/live`, value === undefined ? { signal: AbortSignal.timeout(8000) } : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...value, client: this.browser }), signal: AbortSignal.timeout(8000) });
    const result = await response.json();
    if (result.code === "ROOM_REMOVED") this.revoked();
    if (!response.ok) throw new Error(result.error || "Live connection failed. Try reconnecting the feed.");
    return result;
  }
  update(state: RoomState, connected: boolean) {
    this.state = state; this.connected = connected;
    if (!connected) this.shutdown();
    else void this.sync();
  }
  receive(value: unknown) {
    if (this.disposed || !snapshot(value)) return;
    if (value.instance === this.instance && value.sequence < this.sequence) return;
    const previous = this.sources;
    this.instance = value.instance; this.sequence = value.sequence; this.sources = value.sources;
    for (const s of this.sources) if (!previous.some(p => p.source === s.source && p.generation === s.generation)) { this.failed.delete(s.source); this.retryAt.delete(s.source); }
    for (const id of this.listening.keys()) if (!this.sources.some(s => s.source === id)) this.listening.delete(id);
    for (const [id, peer] of this.peers) if (!this.sources.some(s => s.source === peer.source.source && s.generation === peer.source.generation)) this.closePeer(id);
    // An explicit stop/revocation must also stop the original browser capture.
    for (const [id, local] of this.publications) if (!local.pending && !this.sources.some(s => s.source === id && s.generation === local.generation)) this.stopLocal(id);
    this.engine.refreshPlaybackUI(); void this.sync();
  }
  private key(source: string, remote: string) { return `${source}:${remote}`; }
  private closePeer(key: string) {
    const peer = this.peers.get(key);
    if (!peer) return;
    this.peers.delete(key); clearTimeout(peer.timer); peer.pc.close();
    if (peer.media) {
      peer.media.video.pause(); peer.media.video.srcObject = null; peer.media.stream.getTracks().forEach(t => t.stop());
      if (this.engine.media.get(peer.source.source) === peer.media) this.engine.media.delete(peer.source.source);
    }
    this.engine.refreshPlaybackUI();
  }
  private stopLocal(id: string) {
    this.publications.delete(id);
    const media = this.engine.media.get(id);
    if (media && !media.remote) { this.engine.media.delete(id); media.stream.getTracks().forEach(t => t.stop()); media.video.srcObject = null; }
    this.engine.audio.stop(id);
    for (const [key, peer] of this.peers) if (peer.source.source === id) this.closePeer(key);
    this.engine.refreshPlaybackUI();
  }
  private shutdown() {
    for (const key of this.peers.keys()) this.closePeer(key);
    for (const id of this.publications.keys()) this.stopLocal(id);
    // Captures that were placed but not yet published also belong to this room.
    for (const [id, media] of this.engine.media) if (!media.remote) {
      media.stream.getTracks().forEach(t => t.stop()); media.video.srcObject = null; this.engine.media.delete(id);
    }
    this.engine.audio.clear(); this.sources = []; this.failed.clear(); this.retryAt.clear();
  }
  canConnect(source: string) {
    const active = this.sources.find(s => s.source === source);
    if (!this.connected || active && active.browser !== this.browser) return false;
    const anchor = this.engine.scene.objects.find(o => o.id === source) || this.engine.scene.objects.find(o => o.sourceId === source);
    return !!anchor && (this.engine.roomGM || this.engine.roomAccess[`object:${anchor.id}`]?.owner === this.state.me.id);
  }
  owns(source: string) { return this.sources.some(s => s.source === source && s.browser === this.browser) || this.publications.has(source); }
  status(source: string) {
    const s = this.sources.find(s => s.source === source);
    if (!s) return this.engine.media.has(source) ? "Connecting…" : "Stopped";
    if (this.owns(source)) return "Sharing";
    return this.peers.get(this.key(source, s.browser))?.status || (this.failed.has(source) ? "Connection failed" : "Connecting…");
  }
  async stop(source: string) {
    const s = this.sources.find(s => s.source === source);
    if (!s) { this.stopLocal(source); return; }
    if (this.stopping.has(source)) return;
    this.stopping.add(source);
    try { this.receive(await this.request({ action: "stop", source, generation: s.generation })); }
    catch (error) { this.engine.roomNotice((error as Error).message); }
    finally { this.stopping.delete(source); }
  }
  retry(source: string) {
    const s = this.sources.find(s => s.source === source);
    if (!s || s.browser === this.browser) return;
    this.closePeer(this.key(source, s.browser)); this.failed.delete(source); this.retryAt.delete(source); void this.sync();
  }
  remoteAudio() {
    return this.sources.filter(s => s.kind === "audio" && s.browser !== this.browser).map(s => ({ ...s,
      ...this.preference(s.source), status: this.status(s.source) }));
  }
  get needsSound() { return this.remoteAudio().some(s => s.status === "Live" && !s.muted && (!this.soundEnabled || s.blocked)); }
  private preference(id: string) {
    if (!this.listening.has(id)) this.listening.set(id, { muted: false, volume: .65, blocked: false });
    return this.listening.get(id)!;
  }
  listen(id: string, patch: { muted?: boolean; volume?: number }) {
    const p = this.preference(id); Object.assign(p, patch); p.volume = Math.max(0, Math.min(1, p.volume));
    if (patch.muted === false) this.enableSound();
    const s = this.sources.find(s => s.source === id), media = s && this.peers.get(this.key(id, s.browser))?.media;
    if (media) this.playAudio(id, media.video);
    this.engine.refreshPlaybackUI();
  }
  silence() { for (const s of this.remoteAudio()) this.listen(s.source, { muted: true }); }
  enableSound() {
    this.soundEnabled = true;
    for (const peer of this.peers.values()) if (peer.source.kind === "audio" && peer.media) {
      this.preference(peer.source.source).blocked = false; this.playAudio(peer.source.source, peer.media.video);
    }
    this.engine.refreshPlaybackUI();
  }
  private playAudio(id: string, video: HTMLVideoElement) {
    const p = this.preference(id); video.volume = p.volume; video.muted = !this.soundEnabled || p.muted || p.blocked;
    void video.play().catch(() => { if (this.disposed || !video.srcObject) return;
      p.blocked = true; video.muted = true; this.engine.refreshPlaybackUI(); });
  }
  private async sync() {
    if (this.disposed || !this.connected) return;
    if (performance.now() >= this.configRefreshAt) void this.configure();
    if (!this.configured) { void this.configure(); return; }
    const local = new Map<string, { stream: MediaStream; kind: LiveSource["kind"]; label: string }>();
    for (const [source, media] of this.engine.media) if (!media.remote && media.stream.getVideoTracks().some(t => t.readyState === "live")) {
      const surface = this.state.table.scene.objects.find(o => (o.sourceId ?? o.id) === source);
      if (surface?.kind === "screen" || surface?.kind === "camera") local.set(source, { stream: media.stream, kind: surface.kind, label: surface.name });
    }
    for (const audio of this.engine.audio.list()) {
      const stream = this.engine.audio.stream(audio.id);
      if (stream?.getAudioTracks().some(t => t.readyState === "live")) local.set(audio.id, { stream, kind: "audio", label: audio.name });
    }
    for (const s of this.sources) if (s.browser === this.browser && !local.has(s.source) && !this.publications.has(s.source)) void this.stop(s.source);
    for (const [id, publication] of this.publications) if (!local.has(id) && !publication.pending) {
      this.publications.delete(id);
      void this.stop(id);
    }
    for (const [source, item] of local) {
      const old = this.publications.get(source);
      if (old?.stream === item.stream) continue;
      const publication = { ...item, label: item.label.slice(0, 160), generation: crypto.randomUUID(), pending: true };
      this.publications.set(source, publication);
      try {
        const result = await this.request({ action: "publish", source, kind: item.kind, label: publication.label, generation: publication.generation });
        if (this.disposed || !this.connected || this.publications.get(source) !== publication) {
          void this.request({ action: "stop", source, generation: publication.generation }).catch(() => {}); continue;
        }
        publication.pending = false; this.receive(result);
      } catch (error) { if (this.publications.get(source) === publication) { this.stopLocal(source); this.engine.roomNotice((error as Error).message); } }
    }
    if (this.disposed || !this.connected) return;
    for (const source of this.sources) {
      if (source.browser === this.browser || this.peers.has(this.key(source.source, source.browser)) || this.failed.has(source.source)) continue;
      if (source.kind !== "audio" && !this.engine.scene.objects.some(o => (o.sourceId ?? o.id) === source.source)) continue;
      const retry = this.retryAt.get(source.source);
      if (retry && performance.now() < retry.at) continue;
      const peer = this.createPeer(source, source.browser, crypto.randomUUID());
      if (!peer) continue;
      void this.request({ action: "subscribe", source: source.source, generation: source.generation, connection: peer.connection }).catch(error => {
        if (this.peers.get(this.key(source.source, source.browser)) === peer) this.failPeer(peer, (error as Error).message);
      });
    }
  }
  private failPeer(peer: Peer, _reason?: string) {
    if (this.peers.get(this.key(peer.source.source, peer.remote)) !== peer) return;
    peer.status = "Connection failed"; clearTimeout(peer.timer);
    if (peer.remote === peer.source.browser) {
      const previous = this.retryAt.get(peer.source.source)?.attempts ?? 0;
      if (previous < 3) {
        this.retryAt.set(peer.source.source, { attempts: previous + 1, at: performance.now() + 2000 * (previous + 1) });
        this.closePeer(this.key(peer.source.source, peer.remote));
      } else this.failed.add(peer.source.source);
    }
    this.engine.refreshPlaybackUI();
  }
  private createPeer(source: LiveSource, remote: string, connection: string) {
    const key = this.key(source.source, remote); this.closePeer(key);
    let pc: RTCPeerConnection;
    try { pc = new RTCPeerConnection({ iceServers: this.iceServers }); }
    catch { this.failed.add(source.source); this.engine.roomNotice("Could not open a live connection. Check the relay settings or try Retry connection."); return null; }
    const peer: Peer = { source, remote, connection, pc, candidates: [], work: Promise.resolve(), status: "Connecting…",
      timer: setTimeout(() => this.failPeer(peer), 15000) };
    this.peers.set(key, peer);
    pc.onicecandidate = event => { if (event.candidate && this.peers.get(key) === peer) void this.signal(peer, { type: "ice", candidate: event.candidate.toJSON() }).catch(() => {}); };
    pc.onconnectionstatechange = () => {
      if (this.peers.get(key) !== peer) return;
      if (pc.connectionState === "connected") { peer.status = "Live"; clearTimeout(peer.timer); this.retryAt.delete(source.source); }
      else if (pc.connectionState === "failed") this.failPeer(peer);
      else if (pc.connectionState === "disconnected") { peer.status = "Reconnecting…"; clearTimeout(peer.timer); peer.timer = setTimeout(() => this.failPeer(peer), 5000); }
      this.engine.refreshPlaybackUI();
    };
    pc.ontrack = event => {
      if (this.peers.get(key) !== peer || source.browser !== remote) return;
      if (!peer.media) {
        const video = document.createElement("video"); video.playsInline = true; video.muted = true;
        const stream = new MediaStream(); video.srcObject = stream; peer.media = { stream, video, remote: true };
        if (source.kind !== "audio") this.engine.media.set(source.source, peer.media);
      }
      if (!peer.media.stream.getTracks().includes(event.track)) peer.media.stream.addTrack(event.track);
      if (source.kind === "audio") this.playAudio(source.source, peer.media.video);
      else void peer.media.video.play().catch(() => {});
      this.engine.refreshPlaybackUI();
    };
    return peer;
  }
  private signal(peer: Peer, message: Record<string, unknown>) {
    return this.request({ action: "signal", source: peer.source.source, generation: peer.source.generation, peer: peer.remote, connection: peer.connection, message });
  }
  handle(v: any) {
    if (this.disposed || !this.connected || !v || !uuid(v.source) || !uuid(v.generation)) return;
    if (v.action === "ended") { if (this.publications.get(v.source)?.generation === v.generation) this.stopLocal(v.source); return; }
    const source = this.sources.find(s => s.source === v.source && s.generation === v.generation);
    if (!source || !uuid(v.peer) || !uuid(v.connection)) return;
    const key = this.key(v.source, v.peer);
    if (v.action === "unsubscribe") { if (this.peers.get(key)?.connection === v.connection) this.closePeer(key); return; }
    if (v.action === "subscribe") {
      const publication = this.publications.get(v.source);
      if (!publication || publication.generation !== source.generation) return;
      const peer = this.createPeer(source, v.peer, v.connection);
      if (!peer) return;
      const tracks = source.kind === "audio" ? publication.stream.getAudioTracks() : publication.stream.getVideoTracks();
      for (const track of tracks) peer.pc.addTrack(track, publication.stream);
      peer.work = (async () => {
        const offer = await peer.pc.createOffer(); await peer.pc.setLocalDescription(offer);
        if (this.peers.get(key) === peer) await this.signal(peer, { type: "offer", sdp: offer.sdp });
      })().catch(() => this.failPeer(peer));
      return;
    }
    const peer = this.peers.get(key);
    if (!peer || peer.connection !== v.connection || v.action !== "signal" || !v.message) return;
    peer.work = peer.work.then(async () => {
      if (this.peers.get(key) !== peer) return;
      const message = v.message;
      if (message.type === "ice") {
        if (!peer.pc.remoteDescription) { if (peer.candidates.length < 64) peer.candidates.push(message.candidate); }
        else await peer.pc.addIceCandidate(message.candidate);
      } else {
        await peer.pc.setRemoteDescription({ type: message.type, sdp: message.sdp });
        for (const c of peer.candidates.splice(0)) await peer.pc.addIceCandidate(c);
        if (message.type === "offer") {
          const answer = await peer.pc.createAnswer(); await peer.pc.setLocalDescription(answer);
          if (this.peers.get(key) === peer) await this.signal(peer, { type: "answer", sdp: answer.sdp });
        }
      }
    }).catch(() => this.failPeer(peer));
  }
  close() { this.disposed = true; clearInterval(this.timer); this.shutdown(); if (this.engine.roomLive === this) this.engine.roomLive = null; }
}
