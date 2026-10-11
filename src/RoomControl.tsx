import { useEffect, useRef, useState } from "react";
import type { TableEngine } from "./engine";
import { ColorControl } from "./ColorControl";
import { RoomClient, roomRequest, type RoomStatus } from "./room-client";
import type { RoomState } from "./room-state";

export function RoomControl({ engine, ready, onStatus }: { engine: TableEngine | null; ready: boolean; onStatus: (value: RoomStatus | null) => void }) {
  const [open, setOpen] = useState(false), [room, setRoom] = useState<RoomState | null>(null), [status, setStatus] = useState<RoomStatus>("offline");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [title, setTitle] = useState("Shared table"), [link, setLink] = useState("");
  const [confirmation, setConfirmation] = useState<{ kind: "invitation" | "remove"; invite: string; member?: string; name?: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [nameError, setNameError] = useState(""), [linkError, setLinkError] = useState("");
  const [entryAction, setEntryAction] = useState<"create" | "join" | null>(null);
  const [identityDraft, setIdentityDraft] = useState<{ name: string; color: string; version: number } | null>(null);
  const [profile, setProfile] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem("table-goblin-identity") || "null"); if (typeof v?.name === "string" && /^#[a-f0-9]{6}$/i.test(v.color)) return { name: v.name, color: v.color }; } catch {}
    return { name: "", color: "#e3a069" };
  });
  const anchor = useRef<HTMLDivElement>(null), client = useRef<RoomClient | null>(null), restored = useRef("");
  const nameInput = useRef<HTMLInputElement>(null), linkInput = useRef<HTMLInputElement>(null);
  const connect = (state: RoomState) => {
    setConfirmation(null); setIdentityDraft(null); setNotice("");
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
  useEffect(() => { if (!open) { setConfirmation(null); setIdentityDraft(null); } }, [open]);
  useEffect(() => {
    if (!room) return;
    const identity = { name: room.me.name, color: room.me.color };
    setProfile(identity);
    try { localStorage.setItem("table-goblin-identity", JSON.stringify(identity)); } catch {}
  }, [room?.me.name, room?.me.color]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!anchor.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close); window.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", close); window.removeEventListener("keydown", key); };
  }, [open]);
  const act = async (work: () => Promise<void>) => { setBusy(true); setError(""); setNotice(""); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "The room could not be opened."); } finally { setBusy(false); } };
  const enter = (action: "create" | "join") => {
    if (busy || !ready) return;
    setNameError(""); setLinkError(""); setError("");
    if (!profile.name.trim()) {
      setNameError(`Enter a name or nickname to ${action === "join" ? "join" : "create"} the room.`);
      nameInput.current?.focus(); return;
    }
    if (action === "join" && !link.trim()) {
      setLinkError("Paste an invitation link to join."); linkInput.current?.focus(); return;
    }
    setEntryAction(action);
    void act(async () => {
      const identity = { ...profile, name: profile.name.trim() };
      if (action === "create") connect(await roomRequest("/api/rooms", { ...identity, title }));
      else {
        const url = new URL(link.trim(), location.origin);
        if (url.origin !== location.origin) throw new Error("Open the invitation on its own server, then join there.");
        const params = new URLSearchParams(url.hash.slice(1)), id = params.get("room"), invite = params.get("invite");
        if (!id || !/^[a-z0-9]{16}$/.test(id) || !invite) throw new Error("Paste a complete room invitation link.");
        connect(await roomRequest(`/api/rooms/${id}/join`, { ...identity, invite }));
      }
    }).finally(() => setEntryAction(null));
  };
  const entryKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); enter(link.trim() ? "join" : "create"); }
  };
  const inviteLink = room?.invite ? `${location.origin}/#room=${room.id}&invite=${room.invite}` : "";
  const canManage = !busy && (status === "connected" || status === "saving");
  return <div ref={anchor} className="menu-anchor room-anchor">
    <button className={`icon-button room-button ${room ? "active" : ""}`} aria-label="Online room" aria-expanded={open} onClick={() => setOpen(!open)} title={room ? room.title : "Create or join an online room"}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></svg><span>{status === "removed" && room ? "Access ended" : room ? `${room.participants.filter(p => p.online).length} players` : "Online"}</span>
    </button>
    {open && <section className="dropdown room-panel" aria-label="Online room controls">
      <div className="room-heading"><strong>{room ? room.title : link.trim() ? "Join room" : "Online room"}</strong><button aria-label="Close room controls" onClick={() => setOpen(false)}>×</button></div>
      {error && <p className="room-error" role="alert">{error}</p>}
      {notice && <p className="widget-note" role="status">{notice}</p>}
      {client.current?.rejectedDraft && <button className="widget-primary" onClick={() => void act(async () => { await client.current!.exportRejected(); })}>Export unsent edit</button>}
      {status === "removed" && client.current?.rejectedDraft && <p className="widget-note">Room images and media can no longer be downloaded. If your edit uses them, export preserves the edits and file references as recovery data.</p>}
      {!room ? <>
        <label>Your name · required<input ref={nameInput} aria-label="Your player name" aria-invalid={!!nameError} aria-describedby="room-name-help" required placeholder="Name or nickname" maxLength={32} value={profile.name} onKeyDown={entryKey} onChange={e => { setProfile({ ...profile, name: e.target.value }); if (e.target.value.trim()) setNameError(""); }} />
          <span id="room-name-help" className={`room-field-help ${nameError ? "invalid" : ""}`} role={nameError ? "alert" : undefined}>{nameError || "This is how other players will see you."}</span>
        </label>
        <ColorControl label="Presence color" value={profile.color} onChange={color => setProfile({ ...profile, color })} />
        {!link.trim() && <>
          <label>Room name<input aria-label="Room name" maxLength={60} value={title} onKeyDown={entryKey} onChange={e => setTitle(e.target.value)} /></label>
          <button className="widget-primary" disabled={busy || !ready} onClick={() => enter("create")}>{entryAction === "create" ? "Creating…" : "Create room"}</button>
        </>}
        <label>Invitation link<input ref={linkInput} aria-label="Room invitation link" aria-invalid={!!linkError} aria-describedby={linkError ? "room-link-help" : undefined} placeholder="Paste a room invitation" value={link} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); enter("join"); } }} onChange={e => { setLink(e.target.value); setLinkError(""); }} />
          {linkError && <span id="room-link-help" className="room-field-help invalid" role="alert">{linkError}</span>}
        </label>
        <button className="widget-primary" disabled={busy || !ready} onClick={() => enter("join")}>{entryAction === "join" ? "Joining…" : "Join room"}</button>
        <p className="widget-note">{link.trim() ? "Choose a name, then join. Your local table stays saved separately." : "Create a room or paste an invitation to join. Your local table stays saved separately."}</p>
      </> : <>
        <div className="room-role"><i style={{ background: room.me.color }} /><span>{room.me.name} · {room.me.role === "gm" ? "GM" : "Player"}</span><small>{status === "connected" ? "Connected" : status === "saving" ? "Saving…" : status === "update-required" ? "Server update needed" : status === "removed" ? "Access ended" : "Reconnecting…"}</small>{status !== "removed" && <button className="room-person-action" aria-label="Edit identity" title="Edit your name and pointer color" disabled={!canManage} onClick={() => { setError(""); setNotice(""); setIdentityDraft({ name: room.me.name, color: room.me.color, version: room.me.profileVersion ?? 0 }); }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m16 3 5 5L8 21H3v-5L16 3ZM13 6l5 5"/></svg></button>}</div>
        {identityDraft && status !== "removed" && <form className="room-identity" aria-label="Edit your identity" onSubmit={e => {
          e.preventDefault(); const chosen = identityDraft;
          void act(async () => {
            try { await client.current!.updateProfile(chosen.name, chosen.color, chosen.version); setIdentityDraft(null); setNotice("Identity updated."); }
            catch (error) { setIdentityDraft(draft => draft && { ...draft, version: client.current!.state.me.profileVersion ?? 0 }); throw error; }
          });
        }}><fieldset disabled={!canManage}>
          <label>Your name<input aria-label="Your room name" maxLength={32} value={identityDraft.name} onChange={e => setIdentityDraft({ ...identityDraft, name: e.target.value })} /></label>
          <ColorControl label="Pointer color" value={identityDraft.color} onChange={color => setIdentityDraft(draft => draft && { ...draft, color })} />
          <div className="room-actions"><button type="submit" className="widget-primary" disabled={!identityDraft.name.trim()}>Save identity</button><button type="button" onClick={() => setIdentityDraft(null)}>Cancel</button></div>
        </fieldset></form>}
        {status !== "removed" && <div className="room-people">{room.participants.map(p => {
          const view = room.presence.find(entry => entry.id === p.id)?.view;
          return <div key={p.id} data-participant={p.id}><i style={{ background: p.color, opacity: p.online ? 1 : .35 }} /><span>{p.name}</span><small>{p.role === "gm" ? "GM · " : ""}{p.online ? "online" : "offline"}</small>
            {p.id !== room.me.id && p.online && <button className="room-person-action" aria-label={`Go to ${p.name}'s view`} title={view ? `Go to ${p.name}'s view` : "Waiting for their view"} disabled={!canManage || !view} onClick={() => { if (view && engine?.goToRoomView(view)) setOpen(false); }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg></button>}
            {room.me.role === "gm" && p.role === "player" && <button className="room-person-action" aria-label={`Remove ${p.name} from room`} title={`Remove ${p.name} from room`} disabled={!canManage} onClick={() => { setError(""); setNotice(""); setConfirmation({ kind: "remove", member: p.id, name: p.name, invite: room.invite! }); }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg></button>}
          </div>;
        })}</div>}
        {confirmation && <div className="room-confirm" role="group" aria-label="Confirm room access change">
          <strong>{confirmation.kind === "remove" ? `Remove ${confirmation.name}?` : "Replace invitation?"}</strong>
          <p>{confirmation.kind === "remove" ? "Their objects stay and become yours. Their access ends, and the invitation is replaced." : "Old invitation links stop working. Players already in the room stay connected."}</p>
          <div className="room-actions"><button className="widget-primary" disabled={!canManage} onClick={() => void act(async () => {
            const chosen = confirmation;
            try { await client.current!.manage(chosen.kind, chosen.member, chosen.invite); setNotice(chosen.kind === "remove" ? `${chosen.name} removed. Invitation replaced.` : "Invitation replaced."); }
            finally { setConfirmation(null); }
          })}>{confirmation.kind === "remove" ? "Remove player" : "Replace link"}</button><button disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button></div>
        </div>}
        {room.me.role === "gm" ? <>
          <label className="room-permission"><input type="checkbox" aria-label="Allow players to add objects and draw" checked={room.playerEditing} disabled={busy || status === "offline" || status === "update-required"} onChange={e => {
            const enabled = e.target.checked, previous = room;
            setRoom({ ...room, playerEditing: enabled });
            void act(async () => { try { setRoom(await client.current!.permissions(enabled)); } catch (error) { setRoom(previous); throw error; } });
          }}/><span>Allow players to add objects and draw</span></label>
          <label>Player invitation<input aria-label="Player invitation" readOnly value={inviteLink} onFocus={e => e.target.select()} /></label>
          <div className="room-actions"><button className="widget-primary" disabled={busy} onClick={() => void act(async () => { await navigator.clipboard.writeText(inviteLink); setNotice("Invitation copied."); })}>Copy invitation</button><button disabled={!canManage} onClick={() => { setError(""); setNotice(""); setConfirmation({ kind: "invitation", invite: room.invite! }); }}>Replace invitation</button></div>
        </> : status !== "removed" && <p className="widget-note">You can edit your own and shared objects.{room.playerEditing ? " You can also add objects and draw on the canvas." : " Ask the GM to enable adding objects."}</p>}
        {status !== "removed" && <p className="widget-note">Objects, file playback and dice rolls are shared. Listening volume and mute are personal. Undo reverses your own object edits. The GM controls mood, grid and cover.</p>}
        {status === "offline" && <button className="widget-primary" disabled={busy} onClick={() => void act(async () => {
          await client.current!.reconnect();
        })}>Rejoin room</button>}
        {status !== "removed" && <button className="widget-primary" onClick={() => void engine?.exportTable()}>Export room table</button>}
        <button disabled={busy} onClick={() => void act(async () => {
          try { await client.current!.settle(); } catch (error) { if (!window.confirm(`${error instanceof Error ? error.message : "There are unsent changes."}\nExport room table first to keep them. Leave anyway?`)) return; }
          if (client.current!.rejectedDraft && !window.confirm("There is an unsent edit available for export. Leave without exporting it?")) return;
          client.current!.close(); client.current = null; engine!.leaveRoom(); setRoom(null); setError(""); setNotice(""); setConfirmation(null); onStatus(null); history.replaceState(null, "", `${location.pathname}${location.search}`);
        })}>{status === "removed" ? "Return to local table" : "Leave room · return to local table"}</button>
      </>}
    </section>}
  </div>;
}
