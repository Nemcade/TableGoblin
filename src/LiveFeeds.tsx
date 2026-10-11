import { useEffect, useRef } from "react";
import type { TableEngine } from "./engine";
import type { Surface } from "./model";
import { surfaceName } from "./live-label";
export { surfaceName } from "./live-label";

export function LiveFeeds({ engine, onClose, onConnect, onAddCamera }: {
  engine: TableEngine;
  onClose: () => void;
  onConnect: (surface: Surface) => void;
  onAddCamera: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const audio = engine.audio.list();
  const feeds = new Map<string, Surface[]>();
  for (const obj of engine.scene.objects) {
    if (obj.kind !== "screen" && obj.kind !== "camera") continue;
    const key = obj.sourceId ?? obj.id;
    feeds.set(key, [...(feeds.get(key) ?? []), obj]);
  }
  const active = [...feeds.keys()].filter(key => engine.media.has(key));
  const ownActive = active.filter(key => !engine.roomLive || engine.roomLive.owns(key));
  const canAdd = !engine.roomActive || engine.roomConnected && engine.roomEditable && (engine.roomGM || engine.roomCreating);
  const selectedKey = [...feeds].find(([, objects]) => objects.some(obj => engine.selection.has(obj.id)))?.[0];
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const selected = panel.current?.querySelector<HTMLElement>(".selected-feed");
    selected?.scrollIntoView({ block: "nearest" });
    (selected?.querySelector<HTMLButtonElement>(".live-feed-actions button") ?? panel.current?.querySelector<HTMLButtonElement>("button"))?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!(event.target as Element).closest(".live-feeds-anchor")) onClose();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [onClose]);
  return <div id="live-feeds-panel" ref={panel} className="dropdown live-feeds-menu" role="dialog" aria-label="Live feeds">
    <div className="live-feeds-heading">
      <h2>Live feeds <small>{active.length} connected</small></h2>
      <button aria-label="Close live feeds" onClick={onClose}>×</button>
    </div>
    <div className="live-feeds-list">
      {!feeds.size && <p className="live-feeds-empty">Add a screen or camera to begin.</p>}
      {[...feeds].map(([key, objects]) => {
        const surface = objects[0], connected = engine.media.has(key);
        const live = engine.roomLive, source = live?.sources.find(s => s.source === key);
        const canConnect = !engine.roomActive || !!live?.canConnect(key);
        const status = live?.status(key) ?? (connected ? "Live" : "Stopped");
        const editable = engine.objectEditable(surface.id, true);
        const sound = audio.find(s => s.displaySourceId === key);
        return <article key={key} className={`live-feed ${key === selectedKey ? "selected-feed" : ""}`} aria-label={surfaceName(surface.name)}>
          <div className="live-feed-heading">
            <button className="live-feed-locate" aria-label={`Show ${surfaceName(surface.name)} on table`}
              title="Find and select this surface" onClick={() => { engine.locate(surface.id); onClose(); }}>
              <strong>{surfaceName(surface.name)}</strong>
              <small>{surface.kind === "camera" ? "Camera" : "Screen"} · {objects.length} {objects.length === 1 ? "surface" : "surfaces"}{objects.length === 1 && surface.locked ? " · locked" : ""}</small>
            </button>
            <span className={`feed-status ${status === "Live" || status === "Sharing" ? "connected" : ""}`}><i />{status}</span>
          </div>
          <div className="live-feed-actions">
            {canConnect && <button onClick={() => onConnect(surface)}>{connected ? "Change source" : "Reconnect"}</button>}
            {source && !live?.owns(key) && <button onClick={() => live?.retry(key)}>Retry connection</button>}
            {(source && (live?.owns(key) || engine.roomGM) || connected && !live) && <button className="feed-stop" onClick={() => engine.stopScreen(surface.id)}>{surface.kind === "camera" ? "Stop camera" : "Stop sharing"}</button>}
            {source && <small>Shared by {source.name}</small>}
          </div>
          {sound && <div className="live-feed-actions live-feed-sound">
            <small>Screen sound · {sound.muted ? "muted" : "on"}</small>
            <button aria-label={`${sound.muted ? "Unmute" : "Mute"} screen sound for ${surfaceName(surface.name)}`} aria-pressed={sound.muted}
              onClick={() => engine.audio.set(sound.id, { muted: !sound.muted })}>{sound.muted ? "Unmute sound" : "Mute sound"}</button>
            <button onClick={() => engine.audio.stop(sound.id)} title="Keep the picture running; change source to share sound again">Stop sound</button>
          </div>}
          {objects.length === 1 ? <div className="live-surface-actions">
            <button disabled={surface.locked || !editable} title={surface.locked ? "Unlock to crop" : undefined} onClick={() => { onClose(); engine.edit(surface.id); }}>Crop</button>
            <button disabled={!canAdd} onClick={() => engine.duplicate(new Set([surface.id]))}>Duplicate</button>
            <button disabled={!editable} onClick={() => engine.setLocked(!surface.locked, new Set([surface.id]))}>{surface.locked ? "Unlock" : "Lock"}</button>
            <button disabled={surface.locked || !editable} title={surface.locked ? "Unlock to remove" : undefined} onClick={() => engine.delete(new Set([surface.id]))}>Remove</button>
          </div> : <details className="live-surfaces">
            <summary>Surface settings · {objects.length}</summary>
            {objects.map((obj, i) => <div className="live-surface" key={obj.id}>
              <button className="live-surface-name" onClick={() => { engine.locate(obj.id); onClose(); }}>Surface {i + 1}{obj.locked ? " · locked" : ""}{obj.parentId ? " · attached" : ""}</button>
              <div className="live-surface-actions">
                <button disabled={obj.locked || !engine.objectEditable(obj.id, true)} title={obj.locked ? "Unlock to crop" : undefined} onClick={() => { onClose(); engine.edit(obj.id); }}>Crop</button>
                <button disabled={!canAdd} onClick={() => engine.duplicate(new Set([obj.id]))}>Duplicate</button>
                <button disabled={!engine.objectEditable(obj.id, true)} onClick={() => engine.setLocked(!obj.locked, new Set([obj.id]))}>{obj.locked ? "Unlock" : "Lock"}</button>
                <button disabled={obj.locked || !engine.objectEditable(obj.id, true)} title={obj.locked ? "Unlock to remove" : undefined} onClick={() => engine.delete(new Set([obj.id]))}>Remove</button>
              </div>
            </div>)}
          </details>}
        </article>;
      })}
    </div>
    <p className="live-capture-note">For picture and sound together, enable Share audio in the browser picker. One capture shares both.</p>
    <div className="live-feeds-footer">
      <button disabled={!canAdd} onClick={() => { onClose(); void engine.addScreen(); }}>＋ Screen</button>
      <button disabled={!canAdd} onClick={onAddCamera}>＋ Camera</button>
      {ownActive.length > 1 && <button className="feed-stop" onClick={() => {
        for (const key of ownActive) engine.stopScreen(feeds.get(key)![0].id);
      }}>{engine.roomActive ? "Stop my feeds" : "Stop all feeds"}</button>}
    </div>
  </div>;
}
