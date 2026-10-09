import { useEffect, useRef, useState } from "react";
import type { TableEngine } from "./engine";
import { ColorControl } from "./ColorControl";
import { RoomClient, roomRequest, type RoomStatus } from "./room-client";
import type { RoomState } from "./room-state";

export function RoomControl({ engine, ready, onStatus }: { engine: TableEngine | null; ready: boolean; onStatus: (value: RoomStatus | null) => void }) {
  const [open, setOpen] = useState(false), [room, setRoom] = useState<RoomState | null>(null), [status, setStatus] = useState<RoomStatus>("offline");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [title, setTitle] = useState("Shared table"), [link, setLink] = useState("");
  const [profile, setProfile] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem("table-goblin-identity") || "null"); if (typeof v?.name === "string" && /^#[a-f0-9]{6}$/i.test(v.color)) return { name: v.name, color: v.color }; } catch {}
    return { name: "", color: "#e3a069" };
  });
  const anchor = useRef<HTMLDivElement>(null), client = useRef<RoomClient | null>(null), restored = useRef("");
  const connect = (state: RoomState) => {
    client.current?.close();
    client.current = new RoomClient(engine!, state, (next, status) => { setRoom(next); setStatus(status); onStatus(status); }, message => { setError(message); setOpen(true); });
    setRoom(state); setStatus("offline"); onStatus("offline");
    try { localStorage.setItem("table-goblin-identity", JSON.stringify({ name: state.me.name, color: state.me.color })); } catch {}
    history.replaceState(null, "", `${location.pathname}${location.search}#room=${state.id}`);
  };
  useEffect(() => {
    if (!engine || !ready) return;
    let cancelled = false, serial = 0;
    const restore = () => {
      const params = new URLSearchParams(location.hash.slice(1)), id = params.get("room"), invite = params.get("invite");
      if (!id || !/^[a-z0-9]{16}$/.test(id) || restored.current === location.hash || client.current?.state.id === id) return;
      restored.current = location.hash; const request = ++serial;
      if (invite) { setLink(location.href); setOpen(true); }
      else {
        void roomRequest(`/api/rooms/${id}/state`).then(state => { if (!cancelled && request === serial) connect(state); }).catch(e => { if (!cancelled && request === serial) { setError(e.message); setOpen(true); } });
      }
    };
    restore(); window.addEventListener("hashchange", restore);
    return () => { cancelled = true; window.removeEventListener("hashchange", restore); };
  }, [engine, ready]);
  useEffect(() => () => client.current?.close(), []);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!anchor.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close); window.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", close); window.removeEventListener("keydown", key); };
  }, [open]);
  const act = async (work: () => Promise<void>) => { setBusy(true); setError(""); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "The room could not be opened."); } finally { setBusy(false); } };
  const inviteLink = room?.invite ? `${location.origin}/#room=${room.id}&invite=${room.invite}` : "";
  return <div ref={anchor} className="menu-anchor room-anchor">
    <button className={`icon-button room-button ${room ? "active" : ""}`} aria-label="Online room" aria-expanded={open} onClick={() => setOpen(!open)} title={room ? room.title : "Create or join an online room"}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></svg><span>{room ? `${room.participants.filter(p => p.online).length} players` : "Online"}</span>
    </button>
    {open && <section className="dropdown room-panel" aria-label="Online room controls">
      <div className="room-heading"><strong>{room ? room.title : "Online room"}</strong><button aria-label="Close room controls" onClick={() => setOpen(false)}>×</button></div>
      {error && <p className="room-error" role="alert">{error}</p>}
      {client.current?.rejectedDraft && <button className="widget-primary" onClick={() => void act(async () => { await client.current!.exportRejected(); })}>Export unsent edit</button>}
      {!room ? <>
        <label>Your name<input aria-label="Your player name" maxLength={32} value={profile.name} onChange={e => setProfile({ ...profile, name: e.target.value })} /></label>
        <ColorControl label="Presence color" value={profile.color} onChange={color => setProfile({ ...profile, color })} />
        <label>Room name<input aria-label="Room name" maxLength={60} value={title} onChange={e => setTitle(e.target.value)} /></label>
        <button className="widget-primary" disabled={busy || !ready || !profile.name.trim()} onClick={() => void act(async () => { const state = await roomRequest("/api/rooms", { ...profile, title }); connect(state); })}>Create room</button>
        <label>Invitation link<input aria-label="Room invitation link" placeholder="Paste a room invitation" value={link} onChange={e => setLink(e.target.value)} /></label>
        <button className="widget-primary" disabled={busy || !ready || !profile.name.trim() || !link.trim()} onClick={() => void act(async () => {
          const url = new URL(link, location.origin);
          if (url.origin !== location.origin) { setError("Open the invitation on its own server, then join there."); return; }
          const params = new URLSearchParams(url.hash.slice(1)), id = params.get("room"), invite = params.get("invite");
          if (!id || !/^[a-z0-9]{16}$/.test(id) || !invite) throw new Error("Paste a complete room invitation link.");
          connect(await roomRequest(`/api/rooms/${id}/join`, { ...profile, invite }));
        })}>Join room</button>
        <p className="widget-note">Rooms start empty. Your local table stays saved separately. Start “Open Online Table Goblin” from the project folder to try rooms.</p>
      </> : <>
        <div className="room-role"><i style={{ background: room.me.color }} /><span>{room.me.name} · {room.me.role === "gm" ? "GM" : "Player"}</span><small>{status === "connected" ? "Connected" : status === "saving" ? "Saving…" : status === "update-required" ? "Server update needed" : "Reconnecting…"}</small></div>
        <div className="room-people">{room.participants.map(p => <div key={p.id}><i style={{ background: p.color, opacity: p.online ? 1 : .35 }} /><span>{p.name}</span><small>{p.role === "gm" ? "GM · " : ""}{p.online ? "online" : "offline"}</small></div>)}</div>
        {room.me.role === "gm" ? <>
          <label className="room-permission"><input type="checkbox" aria-label="Allow players to add objects and draw" checked={room.playerEditing} disabled={busy || status === "offline" || status === "update-required"} onChange={e => {
            const enabled = e.target.checked, previous = room;
            setRoom({ ...room, playerEditing: enabled });
            void act(async () => { try { setRoom(await client.current!.permissions(enabled)); } catch (error) { setRoom(previous); throw error; } });
          }}/><span>Allow players to add objects and draw</span></label>
          <label>Player invitation<input aria-label="Player invitation" readOnly value={inviteLink} onFocus={e => e.target.select()} /></label>
          <button className="widget-primary" onClick={() => void act(async () => { await navigator.clipboard.writeText(inviteLink); })}>Copy invitation</button>
        </> : <p className="widget-note">You can edit your own and shared objects.{room.playerEditing ? " You can also add objects and draw on the canvas." : " Ask the GM to enable adding objects."}</p>}
        <p className="widget-note">Shapes, text, images and drawings are shared. Undo reverses your own edits. Pan, zoom, rulers and dice are personal. The GM controls mood, grid and cover.</p>
        {status === "offline" && <button className="widget-primary" disabled={busy} onClick={() => void act(async () => {
          await client.current!.reconnect();
        })}>Rejoin room</button>}
        <button className="widget-primary" onClick={() => void engine?.exportTable()}>Export room table</button>
        <button disabled={busy} onClick={() => void act(async () => {
          try { await client.current!.settle(); } catch (error) { if (!window.confirm(`${error instanceof Error ? error.message : "There are unsent changes."}\nExport room table first to keep them. Leave anyway?`)) return; }
          if (client.current!.rejectedDraft && !window.confirm("There is an unsent edit available for export. Leave without exporting it?")) return;
          client.current!.close(); client.current = null; engine!.leaveRoom(); setRoom(null); onStatus(null); history.replaceState(null, "", `${location.pathname}${location.search}`);
        })}>Leave room · return to local table</button>
      </>}
    </section>}
  </div>;
}
