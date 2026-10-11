import { useEffect, useRef, useState } from "react";
import type { TableEngine } from "./engine";
import type { AudioSourceState } from "./audio";
import { NumericValue } from "./NumericValue";
import { DevicePicker } from "./DevicePicker";
import { RoomFileControls } from "./RoomFileControls";

function message(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError")
      return "Permission was declined or the picker was cancelled. You can try again.";
    if (error.name === "NotFoundError")
      return "No matching device is available. Connect a device or start your virtual camera, then refresh the list.";
    if (error.name === "NotReadableError")
      return "The device could not start. Check whether another app is using it.";
    if (error.name === "OverconstrainedError")
      return "That device is no longer available. Refresh the list and choose another.";
  }
  return error instanceof Error
    ? error.message
    : "Could not connect this source.";
}
function useDialog(onClose: () => void) {
  const panel = useRef<HTMLElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("button")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
      }
      if (e.key !== "Tab") return;
      const items = [
        ...(panel.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),select:not(:disabled),input:not(:disabled),[tabindex="0"]',
        ) ?? []),
      ];
      const first = items[0],
        last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return panel;
}
function useDevices(kind: MediaDeviceKind) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const refresh = async () => {
    try {
      setDevices(
        ((await navigator.mediaDevices?.enumerateDevices()) ?? []).filter(
          (d) => d.kind === kind,
        ),
      );
    } catch {
      /* The capture action will explain a permission error. */
    }
  };
  useEffect(() => {
    void refresh();
    navigator.mediaDevices?.addEventListener("devicechange", refresh);
    return () =>
      navigator.mediaDevices?.removeEventListener("devicechange", refresh);
  }, [kind]);
  return { devices, refresh };
}

export function CameraPanel({
  engine,
  onClose,
  targetId,
}: {
  engine: TableEngine;
  onClose: () => void;
  targetId?: string;
}) {
  const panel = useDialog(onClose),
    { devices, refresh } = useDevices("videoinput");
  const [device, setDevice] = useState(() => {
    const target = engine.scene.objects.find(o => o.id === targetId);
    return target ? engine.media.get(target.sourceId ?? target.id)?.stream.getVideoTracks()[0]?.getSettings().deviceId ?? "" : "";
  }),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(false),
    [error, setError] = useState("");
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  const start = async (id: string) => {
    setBusy(true);
    setError("");
    let next: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Camera capture is unavailable. Open the app on localhost in Chrome or Edge.",
        );
      next = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          ...(id ? { deviceId: { exact: id } } : {}),
        },
        audio: false,
      });
      if (!alive.current) {
        next.getTracks().forEach((t) => t.stop());
        return;
      }
      video.current!.srcObject = next;
      await video.current!.play();
      if (!alive.current) {
        next.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = next;
      const connected = next;
      next.getVideoTracks()[0].addEventListener(
        "ended",
        () => {
          if (alive.current && stream.current === connected) {
            stream.current = null;
            setPreview(false);
            setError(
              "Camera disconnected. Choose a source and enable preview again.",
            );
          }
        },
        { once: true },
      );
      const actual = next.getVideoTracks()[0].getSettings().deviceId;
      if (actual) setDevice(actual);
      setPreview(true);
      void refresh();
    } catch (err) {
      next?.getTracks().forEach((t) => t.stop());
      if (alive.current) {
        setError(message(err));
        if (video.current) {
          video.current.srcObject = stream.current;
          if (stream.current) void video.current.play().catch(() => {});
        }
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const place = async () => {
    if (!stream.current) return;
    setBusy(true);
    setError("");
    const capture = stream.current;
    stream.current = null; // Ownership transfers to the table, including cleanup on failure.
    try {
      await engine.addCamera(
        capture,
        devices.find((d) => d.deviceId === device)?.label ||
          capture.getVideoTracks()[0].label,
        targetId,
      );
      if (alive.current) onClose();
    } catch (err) {
      if (alive.current) {
        setError(message(err));
        setPreview(false);
        setBusy(false);
      }
    }
  };
  return (
    <div
      className="capture-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={panel}
        className="capture-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="camera-title"
      >
        <div className="capture-heading">
          <div>
            <h2 id="camera-title">Camera / virtual camera</h2>
          </div>
          <button
            className="capture-close"
            aria-label="Close camera panel"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p>{targetId ? "Choose a video device, preview it, then connect it to this surface and its copies." : "Choose a video device, preview it, then place it on the table."}</p>
        <div className="device-row">
          <label>
            Video source
            <DevicePicker
              label="Video source"
              value={device}
              disabled={busy}
              onChange={(value) => {
                setDevice(value);
                if (preview) void start(value);
              }}
              options={[{ value: "", label: "Default camera" }, ...devices.filter(d => d.deviceId).map((d, i) => ({ value: d.deviceId, label: d.label || `Camera ${i + 1}` }))]}
            />
          </label>
          <button
            disabled={busy}
            onClick={() => void refresh()}
            aria-label="Refresh cameras"
          >
            ↻
          </button>
        </div>
        <div className={`camera-preview ${preview ? "has-preview" : ""}`}>
          <video ref={video} muted playsInline />
          <span>{busy ? "Connecting…" : "Your preview appears here"}</span>
        </div>
        <p className="capture-note">
          Start OBS Virtual Camera in OBS, then refresh this list. Device names
          appear after camera permission is granted.
        </p>
        {error && (
          <p role="alert" className="capture-error">
            {error}
          </p>
        )}
        <div className="capture-actions">
          <button disabled={busy} onClick={() => void start(device)}>
            {preview ? "Restart preview" : "Enable camera preview"}
          </button>
          <button
            className="primary"
            disabled={!preview || busy}
            onClick={() => void place()}
          >
            {targetId ? "Connect camera" : "Place camera"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function AudioPanel({
  engine,
  onClose,
}: {
  engine: TableEngine;
  onClose: () => void;
}) {
  const panel = useDialog(onClose),
    { devices, refresh } = useDevices("audioinput");
  const [device, setDevice] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [sources, setSources] = useState<AudioSourceState[]>(() =>
      engine.audio.list(),
    );
  const alive = useRef(true);
  const audioFiles = useRef<HTMLInputElement>(null);
  const [fileSources, setFileSources] = useState(() => engine.scene.objects.filter(o => o.audio).map(o => ({ ...o })));
  useEffect(() => {
    const timer = setInterval(() => { setSources(engine.audio.list()); setFileSources(engine.scene.objects.filter(o => o.audio).map(o => ({ ...o }))); }, 100);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [engine]);
  const connect = async (display: boolean) => {
    setBusy(true);
    setError("");
    try {
      if (display) await engine.addDisplayAudio();
      else await engine.addInputAudio(device);
      if (alive.current) {
        setSources(engine.audio.list());
        void refresh();
      }
    } catch (err) {
      if (alive.current) setError(message(err));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const change = (
    id: string,
    patch: Parameters<typeof engine.audio.set>[1],
  ) => {
    engine.audio.set(id, patch);
    setSources(engine.audio.list());
  };
  return (
    <div
      className="capture-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={panel}
        className="capture-panel audio-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="audio-title"
      >
        <div className="capture-heading">
          <div>
            <h2 id="audio-title">Audio sources</h2>
          </div>
          <button
            className="capture-close"
            aria-label="Close audio panel"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {engine.roomActive && <p className="widget-note">Playback and loop are shared. The GM, owner or shared editors control them; mute and volume are personal.</p>}
        {engine.roomSoundNeeded && <button className="room-sound-enable" onClick={() => engine.enableRoomSound()}>Enable room sound</button>}
        <button className="audio-display" onClick={() => audioFiles.current?.click()}>＋ Audio file <span>Music, ambience, sound effects, or an audio-only MP4</span></button>
        <input ref={audioFiles} type="file" aria-label="Import audio files" accept="audio/*,.mp4,.m4a,.mp3,.wav,.ogg,.oga,.opus,.aac,.flac,.webm" multiple hidden onChange={e => { void engine.addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        {fileSources.length > 0 && <div className="audio-sources" role="region" aria-label="Audio files">
          {fileSources.map(file => {
            const name = file.filename ?? file.name, issue = engine.getMediaIssue(file), editable = engine.objectEditable(file.id, true);
            return <article className="audio-source" key={file.id}>
              <div className="audio-source-heading">
                <button className="audio-file-name" aria-label={`Locate ${name}`} onClick={() => { engine.locate(file.id); onClose(); }}><strong>{name}</strong><small>{issue ?? "Audio file · locate on table"}</small></button>
                <button disabled={!!issue || engine.roomActive && !engine.canControlPlayback(file)} aria-label={`${file.paused ? "Play" : "Pause"} ${name}`} onClick={() => engine.togglePlayback(file.id)}>{file.paused ? "Play" : "Pause"}</button>
                <button disabled={file.locked || !editable} aria-label={`Remove ${name}`} title={file.locked ? "Unlock the object to remove" : !editable ? "Object editing permission is required" : "Remove audio file"} onClick={() => engine.delete(new Set([file.id]))}>Remove</button>
              </div>
              <div className="audio-source-controls audio-file-controls">
                <button disabled={!!issue || engine.roomActive && !engine.canControlPlayback(file)} onClick={() => engine.restartAudio(file.id)}>Restart</button>
                <button disabled={engine.roomActive && !engine.canControlPlayback(file)} aria-pressed={file.loop ?? false} onClick={() => engine.setFileAudio(file.id, { loop: !file.loop })}>Loop {file.loop ? "on" : "off"}</button>
                <label className="audio-volume">Volume<input aria-label={`${name} file volume`} type="range" min="0" max="100" value={(file.volume ?? .65) * 100} onChange={e => engine.setFileAudio(file.id, { volume: Number(e.target.value) / 100 })} /><span>{Math.round((file.volume ?? .65) * 100)}%</span></label>
              </div>
              {engine.roomActive && <RoomFileControls engine={engine} object={file} />}
            </article>;
          })}
        </div>}
        <button
          className="audio-display"
          disabled={busy}
          onClick={() => void connect(true)}
        >
          ＋ Tab / computer audio{" "}
          <span>
            Choose a source and enable Share audio in the browser picker
          </span>
        </button>
        <div className="device-row">
          <label>
            Audio input
            <DevicePicker
              label="Audio input"
              value={device}
              disabled={busy}
              onChange={setDevice}
              options={[{ value: "", label: "Default audio input" }, ...devices.filter(d => d.deviceId).map((d, i) => ({ value: d.deviceId, label: d.label || `Audio input ${i + 1}` }))]}
            />
          </label>
          <button
            disabled={busy}
            onClick={() => void refresh()}
            aria-label="Refresh audio inputs"
          >
            ↻
          </button>
          <button disabled={busy} onClick={() => void connect(false)}>
            Connect input
          </button>
        </div>
        <p className="capture-note">
          Microphones and virtual audio devices appear as inputs. Tab and
          computer audio availability depends on your browser and system.
        </p>
        {error && (
          <p className="capture-error" role="alert">
            {error}
          </p>
        )}
        <div className="audio-sources">
          {!sources.length && !fileSources.length ? (
            <div className="audio-empty">
              No audio sources connected.
              <small>Add a source to begin.</small>
            </div>
          ) : (
            sources.map((s) => (
              <article key={s.id} className="audio-source">
                <div className="audio-source-heading">
                  <div>
                    <strong>{s.name}</strong>
                    <small>
                      {s.kind === "display" ? "Tab / computer" : "Audio input"}
                    </small>
                  </div>
                  <button
                    aria-label={`Stop ${s.name}`}
                    onClick={() => {
                      engine.audio.stop(s.id);
                      setSources(engine.audio.list());
                    }}
                  >
                    Stop
                  </button>
                </div>
                <div
                  className="audio-meter"
                  role="meter"
                  aria-label={`${s.name} level`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(s.level * 100)}
                >
                  <i style={{ width: `${s.level * 100}%` }} />
                </div>
                <div className="audio-source-controls">
                  <label>
                    <input
                      type="checkbox"
                      checked={s.monitor}
                      onChange={(e) =>
                        change(s.id, { monitor: e.target.checked })
                      }
                    />{" "}
                    Listen locally
                  </label>
                  <button
                    aria-pressed={s.muted}
                    aria-label={`${s.muted ? "Unmute" : "Mute"} ${s.name}`}
                    onClick={() => change(s.id, { muted: !s.muted })}
                  >
                    {s.muted ? "Unmute" : "Mute"}
                  </button>
                  <label className="audio-volume">
                    Volume
                    <NumericValue
                      label={`${s.name} volume`}
                      value={s.volume * 100}
                      min={0}
                      max={100}
                      suffix="%"
                      onChange={(volume) =>
                        change(s.id, { volume: volume / 100 })
                      }
                    />
                    <input
                      type="range"
                      step="0.1"
                      aria-label={`${s.name} volume`}
                      min="0"
                      max="100"
                      value={s.volume * 100}
                      onChange={(e) =>
                        change(s.id, { volume: Number(e.target.value) / 100 })
                      }
                    />
                  </label>
                </div>
              </article>
            ))
          )}
        </div>
        <p className="capture-note">
          Local listening starts off to avoid feedback or playing a tab twice.
          Sources stay connected when you close this panel. Imported files start paused.
        </p>
        {(sources.length > 0 || fileSources.length > 0) && (
          <div className="capture-actions">
            <button
              onClick={() => {
                engine.stopAllAudio();
                setSources([]);
              }}
            >
              {engine.roomActive ? "Mute room files for me" : "Stop all audio"}
            </button>
            <button className="primary" onClick={onClose}>
              Done
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
