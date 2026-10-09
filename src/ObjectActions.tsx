import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TableEngine } from "./engine";
import { isShape, type Point, type Surface } from "./model";
import { ColorControl } from "./ColorControl";
import { surfaceName } from "./LiveFeeds";
import { FontPicker, TextExtras, TextModeControl } from "./TextControls";
import { textColor, textMode, type TextSettings } from "./text";
import { NumericValue } from "./NumericValue";
import { DevicePicker } from "./DevicePicker";

function ObjectSharing({ engine, selection }: { engine: TableEngine; selection: Surface[] }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const initial = engine.roomAccess[`object:${selection[0].id}`] ?? { owner: engine.roomIdentity, shared: false, editors: [] };
  const [policy, setPolicy] = useState(initial);
  const owner = engine.roomParticipants.find(p => p.id === initial.owner);
  return <div className="object-sharing">
    <button aria-expanded={open} disabled={!engine.roomConnected} onClick={() => { setPolicy(initial); setError(""); setOpen(!open); }}>Sharing <small>{initial.shared ? "Everyone" : owner?.name ?? "Owner"} {open ? "⌃" : "⌄"}</small></button>
    {open && <div className="object-sharing-settings">
      <label>Owner</label><DevicePicker label="Object owner" value={policy.owner} disabled={busy} options={engine.roomParticipants.map(p => ({ value: p.id, label: `${p.name}${p.role === "gm" ? " · GM" : ""}` }))} onChange={owner => setPolicy({ ...policy, owner })} />
      <label className="sharing-check"><input type="checkbox" aria-label="Everyone can edit" checked={policy.shared} disabled={busy} onChange={e => setPolicy({ ...policy, shared: e.target.checked })} />Everyone can edit</label>
      {!policy.shared && engine.roomParticipants.filter(p => p.role !== "gm" && p.id !== policy.owner).map(p => <label className="sharing-check" key={p.id}>
        <input type="checkbox" aria-label={`Allow ${p.name} to edit`} checked={policy.editors.includes(p.id)} disabled={busy} onChange={e => setPolicy({ ...policy, editors: e.target.checked ? [...policy.editors, p.id] : policy.editors.filter(id => id !== p.id) })} />{p.name}
      </label>)}
      <p className="widget-note">Applies to the selection and everything inside it. The GM can always edit; locks still protect placement.</p>
      {error && <p role="alert" className="room-error">{error}</p>}
      <button className="widget-primary" disabled={busy} onClick={() => { setBusy(true); setError(""); void engine.shareObjects(selection.map(o => o.id), policy).then(() => setOpen(false)).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>Apply sharing</button>
    </div>}
  </div>;
}

function TextObjectSettings({ engine, object }: { engine: TableEngine; object: Surface }) {
  const [more, setMore] = useState(false), text = object.text!;
  const patch = (value: Partial<TextSettings>) => engine.saveText(object.id, { ...text, ...value }, value.mode === "paragraph" && textMode(text) === "label" ? Math.max(300, object.width) : object.width);
  return <div className="text-object-settings">
    <div className="text-object-row"><TextModeControl text={text} onChange={patch} /><NumericValue value={text.size} label="Font size" min={8} max={200} digits={0} onChange={size => patch({ size })} /></div>
    <FontPicker font={text.font} onChange={font => patch({ font })} />
    <button type="button" aria-expanded={more} onClick={() => setMore(!more)}>More text settings <span>{more ? "⌃" : "⌄"}</span></button>
    {more && <TextExtras text={text} color={textColor(object, engine.scene, engine.mood)} onChange={patch} onColorChange={(color, preview) => engine.setTextColor(object.id, color, preview)} />}
  </div>;
}

export function ObjectActions({ engine, selection, point, colors, onClose }: {
  engine: TableEngine; selection: Surface[]; point: Point; colors: string[]; onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null), single = selection.length === 1 ? selection[0] : null;
  const shapes = selection.filter(isShape);
  const allLocked = selection.every(obj => obj.locked), someLocked = selection.some(obj => obj.locked);
  const editable = selection.every(o => engine.objectEditable(o.id));
  const manageLocks = !engine.roomActive || engine.roomGM && engine.roomConnected;
  useLayoutEffect(() => {
    const place = () => {
      const el = panel.current; if (!el) return;
      el.style.left = `${Math.max(12, Math.min(point.x, innerWidth - el.offsetWidth - 12))}px`;
      el.style.top = `${Math.max(12, Math.min(point.y, innerHeight - el.offsetHeight - 12))}px`;
    };
    place(); window.addEventListener("resize", place);
    const observer = new ResizeObserver(place); if (panel.current) observer.observe(panel.current);
    return () => { window.removeEventListener("resize", place); observer.disconnect(); };
  }, [point.x, point.y, selection.length, allLocked]);
  useEffect(() => { panel.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, []);
  useEffect(() => {
    const outside = (e: PointerEvent) => { if (!panel.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); engine.canvas.focus(); } };
    document.addEventListener("pointerdown", outside); window.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", key); };
  }, [engine, onClose]);
  return <div ref={panel} className="dropdown object-actions" role="dialog" aria-label="Object actions"
    style={{ left: Math.max(12, Math.min(point.x, innerWidth - 284)), top: Math.max(12, Math.min(point.y, innerHeight - (shapes.length ? 310 : 190))) }}>
    <div className="object-actions-heading"><span>{single ? surfaceName(single.name) : `${selection.length} selected objects`}</span>{allLocked && <small>Locked</small>}
      <button aria-label="Close object actions" onClick={onClose}>×</button></div>
    <button disabled={!manageLocks} title={!manageLocks ? "The GM controls object locks" : undefined} onClick={() => { engine.setLocked(!allLocked); onClose(); }}>
      {allLocked ? (single ? "Unlock object" : "Unlock selection") : (single ? "Lock object" : "Lock selection")}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2" /><path d={allLocked ? "M9 10V6a4 4 0 0 1 8 0" : "M8 10V6a4 4 0 0 1 8 0v4"} /></svg>
    </button>
    {someLocked && !allLocked && <button disabled={!manageLocks} onClick={() => { engine.setLocked(false); onClose(); }}>Unlock selection</button>}
    {engine.roomActive && engine.roomGM && <ObjectSharing engine={engine} selection={selection} />}
    {engine.roomActive && !engine.roomGM && <p className="widget-note">{editable ? "You can edit this selection." : "The GM can assign or share these objects with you."}</p>}
    {single?.kind === "text" && <button disabled={single.locked || !editable} onClick={() => { onClose(); engine.edit(single.id); }}>Edit text <small>Double-click</small></button>}
    {editable && single?.kind === "text" && !single.locked && <TextObjectSettings engine={engine} object={single} />}
    {single && (single.image || single.video) && <button disabled={single.locked || !editable} title={single.locked ? "Unlock to edit" : undefined} onClick={() => { onClose(); engine.edit(single.id); }}>{isShape(single) ? "Edit art" : "Crop"}</button>}
    {single && (single.video || single.audio || single.animated) && <button onClick={() => engine.togglePlayback(single.id)}>{single.paused ? (single.audio ? "Play audio" : "Play media") : (single.audio ? "Pause audio" : "Pause media")}</button>}
    {single?.audio && <>
      <button onClick={() => engine.restartAudio(single.id)}>Restart audio</button>
      <label className="audio-file-volume">Volume <input aria-label="Audio file volume" type="range" min="0" max="100" value={(single.volume ?? .65) * 100} onChange={e => engine.setFileAudio(single.id, { volume: Number(e.target.value) / 100 })} /><small>{Math.round((single.volume ?? .65) * 100)}%</small></label>
      <button aria-pressed={single.loop ?? false} onClick={() => engine.setFileAudio(single.id, { loop: !single.loop })}>Loop audio <small>{single.loop ? "On" : "Off"}</small></button>
    </>}
    {editable && shapes.length > 0 && <div className="object-colors">
      <ColorControl label="Shape color" value={shapes[0].color} onChange={(value, preview) => engine.setSurfaceColor(value, preview)} />
      <div className="surface-swatches">{colors.map(color => <button key={color} style={{ background: color }} aria-label={`Surface color ${color}`} onClick={() => engine.setSurfaceColor(color)} />)}</div>
    </div>}
    <button aria-label="Duplicate selection" disabled={!editable || engine.roomActive && !engine.roomGM && !engine.roomCreating} onClick={() => { engine.duplicate(); onClose(); }}>Duplicate <small>Ctrl+D</small></button>
    <button aria-label="Delete selected object" disabled={allLocked || !editable} title={allLocked ? "Unlock to delete" : undefined} onClick={() => { engine.delete(); onClose(); }}>Delete <small>Delete</small></button>
  </div>;
}
