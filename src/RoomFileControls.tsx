import { useState } from "react";
import type { TableEngine } from "./engine";
import type { Surface } from "./model";
const stamp = (seconds: number) => { const s = Math.max(0, Math.floor(seconds || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
export function RoomFileControls({ engine, object }: { engine: TableEngine; object: Surface }) {
  const [draft, setDraft] = useState<number | null>(null);
  const playback = engine.roomFilePosition(object), duration = engine.fileDuration(object), name = object.filename ?? object.name;
  const ready = Number.isFinite(duration) && duration > 0 && duration <= 604800, canControl = engine.canControlPlayback(object) && ready;
  const apply = () => { if (draft !== null && canControl) engine.seekRoomFile(object, draft); setDraft(null); };
  return <div className="room-file-controls">
    <div className="room-file-timeline"><span>{stamp(draft ?? playback?.position ?? 0)}</span>
      <input aria-label={`Seek ${name} for room`} type="range" min="0" max={ready ? duration : 1} step=".05" disabled={!canControl}
        value={draft ?? playback?.position ?? 0} onChange={e => setDraft(Number(e.target.value))} onPointerUp={apply} onBlur={apply}
        onKeyUp={e => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(e.key)) apply(); }} />
      <span>{stamp(ready ? duration : 0)}</span></div>
    <div className="room-file-listening">
      <button aria-label={`${engine.roomFileMuted(object) ? "Unmute" : "Mute"} ${name} for me`} aria-pressed={engine.roomFileMuted(object)} onClick={() => engine.setRoomFileMuted(object, !engine.roomFileMuted(object))}>{engine.roomFileMuted(object) ? "Unmute for me" : "Mute for me"}</button>
      {object.video && <><button disabled={!canControl} onClick={() => engine.restartAudio(object.id)}>Restart for room</button>
        <button disabled={!canControl} aria-pressed={object.loop ?? true} onClick={() => engine.setFileAudio(object.id, { loop: !object.loop })}>Loop {object.loop ? "on" : "off"}</button>
        <label>Volume<input aria-label={`${name} file volume`} type="range" min="0" max="100" value={(object.volume ?? 1) * 100} onChange={e => engine.setFileAudio(object.id, { volume: Number(e.target.value) / 100 })} /></label></>}
    </div>
  </div>;
}
