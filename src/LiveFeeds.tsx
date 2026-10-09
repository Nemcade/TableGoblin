import { useEffect, useRef } from "react";
import type { TableEngine } from "./engine";
import type { Surface } from "./model";

export function surfaceName(name: string) {
  if (/^web-contents-media-stream:/i.test(name)) return "Shared tab";
  if (/^window:\d+:\d+$/i.test(name)) return "Shared window";
  if (/^screen:\d+:\d+$/i.test(name) || (/^[A-Za-z0-9+/]{60,}={0,2}$/.test(name) && /[+/=]/.test(name))) return "Shared screen";
  return name;
}

export function LiveFeeds({ engine, onClose, onConnect, onAddCamera }: {
  engine: TableEngine;
  onClose: () => void;
  onConnect: (surface: Surface) => void;
  onAddCamera: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const feeds = new Map<string, Surface[]>();
  for (const obj of engine.scene.objects) {
    if (obj.kind !== "screen" && obj.kind !== "camera") continue;
    const key = obj.sourceId ?? obj.id;
    feeds.set(key, [...(feeds.get(key) ?? []), obj]);
  }
  const active = [...feeds.keys()].filter(key => engine.media.has(key));
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
        return <article key={key} className={`live-feed ${key === selectedKey ? "selected-feed" : ""}`} aria-label={surfaceName(surface.name)}>
          <div className="live-feed-heading">
            <button className="live-feed-locate" aria-label={`Show ${surfaceName(surface.name)} on table`}
              title="Find and select this surface" onClick={() => { engine.locate(surface.id); onClose(); }}>
              <strong>{surfaceName(surface.name)}</strong>
              <small>{surface.kind === "camera" ? "Camera" : "Screen"} · {objects.length} {objects.length === 1 ? "surface" : "surfaces"}{objects.length === 1 && surface.locked ? " · locked" : ""}</small>
            </button>
            <span className={`feed-status ${connected ? "connected" : ""}`}><i />{connected ? "Live" : "Stopped"}</span>
          </div>
          <div className="live-feed-actions">
            <button onClick={() => onConnect(surface)}>{connected ? "Change source" : "Reconnect"}</button>
            {connected && <button className="feed-stop" onClick={() => engine.stopScreen(surface.id)}>{surface.kind === "camera" ? "Stop camera" : "Stop sharing"}</button>}
          </div>
          {objects.length === 1 ? <div className="live-surface-actions">
            <button disabled={surface.locked} title={surface.locked ? "Unlock to crop" : undefined} onClick={() => { onClose(); engine.edit(surface.id); }}>Crop</button>
            <button onClick={() => engine.duplicate(new Set([surface.id]))}>Duplicate</button>
            <button onClick={() => engine.setLocked(!surface.locked, new Set([surface.id]))}>{surface.locked ? "Unlock" : "Lock"}</button>
            <button disabled={surface.locked} title={surface.locked ? "Unlock to remove" : undefined} onClick={() => engine.delete(new Set([surface.id]))}>Remove</button>
          </div> : <details className="live-surfaces">
            <summary>Surface settings · {objects.length}</summary>
            {objects.map((obj, i) => <div className="live-surface" key={obj.id}>
              <button className="live-surface-name" onClick={() => { engine.locate(obj.id); onClose(); }}>Surface {i + 1}{obj.locked ? " · locked" : ""}{obj.parentId ? " · attached" : ""}</button>
              <div className="live-surface-actions">
                <button disabled={obj.locked} title={obj.locked ? "Unlock to crop" : undefined} onClick={() => { onClose(); engine.edit(obj.id); }}>Crop</button>
                <button onClick={() => engine.duplicate(new Set([obj.id]))}>Duplicate</button>
                <button onClick={() => engine.setLocked(!obj.locked, new Set([obj.id]))}>{obj.locked ? "Unlock" : "Lock"}</button>
                <button disabled={obj.locked} title={obj.locked ? "Unlock to remove" : undefined} onClick={() => engine.delete(new Set([obj.id]))}>Remove</button>
              </div>
            </div>)}
          </details>}
        </article>;
      })}
    </div>
    <div className="live-feeds-footer">
      <button onClick={() => { onClose(); void engine.addScreen(); }}>＋ Screen</button>
      <button onClick={onAddCamera}>＋ Camera</button>
      {active.length > 1 && <button className="feed-stop" onClick={() => {
        for (const key of active) engine.stopScreen(feeds.get(key)![0].id);
      }}>Stop all feeds</button>}
    </div>
  </div>;
}
