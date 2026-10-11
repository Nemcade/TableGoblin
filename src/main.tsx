import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { TableEngine, type Tool, type ViewState } from "./engine";
import { shapeVertices, type ShapeKind, type Point } from "./model";
import { MediaEditor } from "./MediaEditor";
import { TextEditor } from "./TextEditor";
import { CameraPanel, AudioPanel } from "./CapturePanel";
import { LiveFeeds } from "./LiveFeeds";
import { ObjectActions } from "./ObjectActions";
import { MoodPanel } from "./MoodPanel";
import { defaultMood, moodVariables } from "./mood";
import { defaultGrid, defaultObscure } from "./table-widgets";
import { WidgetIcon, WidgetMenu, WidgetDock, type WidgetName } from "./Widgets";
import { NumericValue } from "./NumericValue";
import { defaultDiceGroup } from "./dice";
import { RoomControl } from "./RoomControl";
import type { RoomStatus } from "./room-client";
import "./style.css";
type IconName =
  | "select"
  | "pen"
  | "highlighter"
  | "eraser"
  | "laser"
  | "plus"
  | "undo"
  | "redo"
  | "paper"
  | "card"
  | "screen"
  | "image"
  | "close"
  | "help"
  | "fit"
  | "minus"
  | "trash"
  | "dots"
  | "arrow"
  | "check"
  | "shapes"
  | "transform"
  | "copy"
  | "crop"
  | "play"
  | "pause"
  | "camera"
  | "audio"
  | "text"
  | "mood";
function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    text: <path d="M4 5h16M12 5v15M8 20h8M4 5v3m16-3v3" />,
    camera: (
      <>
        <rect x="3" y="6" width="13" height="13" rx="3" />
        <path d="m16 10 5-3v11l-5-3M7 6l1-3h4l1 3" />
      </>
    ),
    audio: (
      <>
        <path d="m10 5-5 4H2v6h3l5 4V5ZM14 8a6 6 0 0 1 0 8M17 4a11 11 0 0 1 0 16" />
      </>
    ),
    mood: (
      <>
        <circle cx="12" cy="12" r="5" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
      </>
    ),
    select: <path d="m5 3 14 9-7 1-3 7-4-17Z" />,
    pen: (
      <>
        <path d="m15 4 5 5-11 11-6 1 1-6L15 4Z" />
        <path d="m12 7 5 5M4 15l5 5" />
      </>
    ),
    highlighter: (
      <>
        <path d="m14 3 7 7-9 9-7-7 9-9ZM5 12l-2 5 4 4 5-2M2 22h12" />
      </>
    ),
    eraser: (
      <>
        <path d="m15 3 7 7-11 11H6l-5-5L15 3Z" />
        <path d="m8 9 8 8M11 21h11" />
      </>
    ),
    laser: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    minus: <path d="M5 12h14" />,
    undo: (
      <>
        <path d="M8 5 3 10l5 5M3 10h10a7 7 0 0 1 7 7v2" />
      </>
    ),
    redo: (
      <>
        <path d="m16 5 5 5-5 5M21 10H11a7 7 0 0 0-7 7v2" />
      </>
    ),
    paper: (
      <>
        <path d="M5 3h10l4 4v14H5V3Z" />
        <path d="M15 3v5h4M8 12h8M8 16h6" />
      </>
    ),
    card: (
      <>
        <rect x="3" y="6" width="18" height="13" rx="2" />
        <path d="M7 10h5M7 14h9" />
      </>
    ),
    screen: (
      <>
        <rect x="2" y="4" width="20" height="14" rx="2" />
        <path d="M8 22h8M12 18v4" />
      </>
    ),
    image: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8" cy="8" r="1.5" />
        <path d="m3 17 6-5 4 3 4-6 4 5" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3v.1" />
      </>
    ),
    fit: (
      <>
        <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />
        <rect x="8" y="8" width="8" height="8" rx="1" />
      </>
    ),
    trash: (
      <>
        <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
      </>
    ),
    dots: (
      <>
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </>
    ),
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    shapes: (
      <>
        <circle cx="7" cy="7" r="4" />
        <path d="m17 3 5 8H12l5-8Z" />
        <rect x="5" y="14" width="9" height="8" rx="1" />
      </>
    ),
    transform: (
      <>
        <rect x="5" y="5" width="14" height="14" />
        <path d="M3 3h4v4H3zm14 0h4v4h-4zM3 17h4v4H3zm14 0h4v4h-4z" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="13" height="13" rx="2" />
        <path d="M15 8V3H3v12h5" />
      </>
    ),
    crop: (
      <>
        <path d="M6 2v16h16M2 6h16v16" />
      </>
    ),
    play: <path d="m8 4 12 8-12 8V4Z" />,
    pause: (
      <>
        <path d="M8 4v16M16 4v16" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
const defaultView: ViewState = {
  storage: "loading",
  loadError: null,
  recoveryAvailable: false,
  mediaErrors: 0,
  tool: "select",
  color: "#b66b45",
  thickness: 3,
  smoothing: 0.55,
  mood: defaultMood,
  audioCount: 0,
  roomSoundNeeded: false,
  dice: {
    groups: [defaultDiceGroup()],
    activeGroup: "main",
    enabled: false,
    sound: true,
    visible: false,
    color: null,
    fontColor: null,
    pool: {},
    rolling: false,
    result: null,
    history: [],
  },
  grid: defaultGrid,
  obscure: defaultObscure,
  obscureUndo: false,
  obscureRedo: false,
  measurement: null,
  zoom: 1,
  selection: [],
  parentName: null,
  canUndo: false,
  canRedo: false,
  objectCount: 0,
  candidate: null,
  dragging: false,
  detaching: false,
  streams: 0,
  transforms: true,
};
const colors = [
  ["Rust", "#b66b45"],
  ["Moss", "#577457"],
  ["Ink", "#374b53"],
  ["Violet", "#8c7397"],
  ["Golden", "#d3ad51"],
  ["Chalk", "#f4ead7"],
];
const shapeChoices: ShapeKind[] = [
  "rectangle",
  "rounded",
  "circle",
  "triangle",
  "hexagon",
  "diamond",
];
const shapeLabels: Record<ShapeKind, string> = {
  rectangle: "Rectangle",
  rounded: "Rounded",
  circle: "Circle",
  triangle: "Triangle",
  hexagon: "Hexagon",
  diamond: "Diamond",
};
const surfaceColors = [
  "#f1ecdd",
  "#acbf9b",
  "#d4ddb8",
  "#b66b45",
  "#dfc587",
  "#90afb9",
  "#ad97b7",
  "#414f52",
];
function ShapeIcon({ shape }: { shape: ShapeKind }) {
  return (
    <svg width="38" height="34" viewBox="0 0 40 36" aria-hidden="true">
      {shape === "circle" ? (
        <ellipse cx="20" cy="18" rx="13" ry="13" fill="currentColor" />
      ) : shape === "rounded" ? (
        <rect x="5" y="8" width="30" height="20" rx="5" fill="currentColor" />
      ) : (
        <polygon
          points={shapeVertices(shape)
            .map(
              (p) =>
                `${20 + p.x * 27},${18 + p.y * (shape === "rectangle" ? 19 : 27)}`,
            )
            .join(" ")}
          fill="currentColor"
        />
      )}
    </svg>
  );
}
function App() {
  const canvas = useRef<HTMLCanvasElement>(null),
    engine = useRef<TableEngine | null>(null),
    files = useRef<HTMLInputElement>(null),
    tableFiles = useRef<HTMLInputElement>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [view, setView] = useState(defaultView),
    [menu, setMenu] = useState<
      "add" | "table" | "shapes" | "color" | "mood" | "widgets" | "feeds" | null
    >(null),
    [contextPoint, setContextPoint] = useState<Point | null>(null),
    [help, setHelp] = useState(false),
    [activeWidget, setActiveWidget] = useState<WidgetName | null>(null),
    [editor, setEditor] = useState<string | null>(null),
    [capturePanel, setCapturePanel] = useState<"camera" | "audio" | null>(null),
    [captureTarget, setCaptureTarget] = useState<string | undefined>(),
    [shapeColor, setShapeColor] = useState("#acbf9b"),
    [toast, setToast] = useState("");
  const [roomStatus, setRoomStatus] = useState<RoomStatus | null>(null);
  useEffect(() => {
    const instance = new TableEngine(
      canvas.current!,
      view => { setView(view); if (engine.current?.roomActive && !engine.current.editingId) setEditor(null); },
      (message) => {
        setToast(message);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(""), 4200);
      },
      (id) => {
        setContextPoint(null);
        setMenu(null);
        setEditor(id);
      },
    );
    engine.current = instance;
    void instance.restoreLocal();
    return () => {
      instance.dispose();
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    if (!menu && !help) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(null);
        setHelp(false);
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menu, help]);
  useEffect(() => {
    if (!help) return;
    const previous = document.activeElement as HTMLElement | null;
    document.querySelector<HTMLElement>(".help-close")?.focus();
    return () => previous?.focus();
  }, [help]);
  const drawing = ["pen", "highlighter", "eraser"].includes(view.tool);
  const tool = (name: Tool) => {
    setContextPoint(null);
    setMenu(null);
    engine.current?.setTool(name);
  };
  const closeEditor = useCallback(() => {
    engine.current?.closeEditor();
    setEditor(null);
  }, []);
  const editObject = editor
    ? engine.current?.scene.objects.find((o) => o.id === editor)
    : undefined;
  return (
    <main
      className={`app tool-${view.tool} ${view.storage === "loading" ? "loading" : ""}`}
      aria-busy={view.storage === "loading"}
      style={moodVariables(view.mood) as React.CSSProperties}
    >
      <canvas
        ref={canvas}
        className="table-canvas"
        onContextMenu={e => {
          e.preventDefault(); setMenu(null);
          const r = e.currentTarget.getBoundingClientRect();
          if (engine.current?.selectForContext({ x: e.clientX - r.left, y: e.clientY - r.top }))
            setContextPoint({ x: e.clientX, y: e.clientY });
        }}
        tabIndex={0}
        aria-label="Infinite tabletop. Drag objects to move, or drag empty space to select several. Right-click for object actions."
      />
      <header className="masthead">
        <div className="brand">
          <img src="/goblin.svg" alt="" />
          <div>
            <h1>
              table goblin
            </h1>
          </div>
        </div>
        <div className="header-actions">
          {roomStatus ? <span className="local-status" aria-label="Room connection status"><i />{roomStatus === "connected" ? "ROOM CONNECTED" : roomStatus === "saving" ? "SAVING ROOM…" : roomStatus === "update-required" ? "RESTART ROOM SERVER" : roomStatus === "removed" ? "ROOM ACCESS ENDED" : "ROOM OFFLINE"}</span> : <span className="local-status" aria-label="Local table save status" title="Your table saves in this browser">
            <i /> {view.storage === "saved" ? "SAVED LOCALLY" : view.storage === "saving" ? "SAVING…" : view.storage === "error" ? "NOT SAVED" : "YOUR LOCAL TABLE"}
          </span>}
          <RoomControl engine={engine.current} ready={view.storage !== "loading" && !!engine.current && !view.loadError} onStatus={setRoomStatus} />
          <div className="menu-anchor live-feeds-anchor">
            <button className={`icon-button live-feeds-button ${menu === "feeds" || view.streams ? "active" : ""}`}
              aria-label="Live feeds" title="Manage screens and cameras" aria-haspopup="dialog" aria-controls="live-feeds-panel" aria-expanded={menu === "feeds"}
              onClick={() => setMenu(menu === "feeds" ? null : "feeds")}>
              <Icon name="screen" size={16} /><span>Live feeds</span>
              {view.streams > 0 && <span className="live-count">{view.streams}</span>}
            </button>
            {menu === "feeds" && engine.current && <LiveFeeds engine={engine.current}
              onClose={() => setMenu(current => current === "feeds" ? null : current)}
              onConnect={surface => {
                setMenu(null);
                if (surface.kind === "screen") void engine.current?.addScreen(surface.id);
                else { setCaptureTarget(surface.id); setCapturePanel("camera"); }
              }}
              onAddCamera={() => { setMenu(null); setCaptureTarget(undefined); setCapturePanel("camera"); }} />}
          </div>
          <div className="menu-anchor">
            <button
              className={`icon-button ${menu === "widgets" ? "active" : ""}`}
              aria-label="Widgets"
              title="Optional widgets"
              onClick={() => setMenu(menu === "widgets" ? null : "widgets")}
            >
              <WidgetIcon name="widgets" />
            </button>
            {menu === "widgets" && (
              <WidgetMenu
                view={view}
                onToggle={(name, enabled) => {
                  if (name === "dice") engine.current?.dice.toggle(enabled);
                  else if (name === "grid")
                    engine.current?.setGrid({ enabled });
                  else engine.current?.setObscure({ enabled });
                  if (enabled) {
                    setActiveWidget(name);
                    if (name === "obscure") engine.current?.setTool("obscure");
                  } else if (activeWidget === name) setActiveWidget(null);
                }}
              />
            )}
          </div>
          {view.roomSoundNeeded && capturePanel !== "audio" && <button className="room-sound-enable" aria-label="Enable room sound" onClick={() => engine.current?.enableRoomSound()}>
            <Icon name="audio" size={18} /><span><strong>Enable room sound</strong><small>Room audio available</small></span>
          </button>}
          <button
            className={`icon-button audio-button ${view.audioCount ? "active" : ""}`}
            onClick={() => {
              setMenu(null);
              setCapturePanel("audio");
            }}
            aria-label="Audio sources"
            title="Audio sources"
          >
            <Icon name="audio" />
            {view.audioCount > 0 && (
              <span className="source-count">{view.audioCount}</span>
            )}
          </button>
          <div className="menu-anchor">
            <button
              className={`icon-button ${menu === "mood" ? "active" : ""}`}
              aria-label="Table mood"
              title="Table mood"
              onClick={() => setMenu(menu === "mood" ? null : "mood")}
            >
              <Icon name="mood" />
            </button>
            {menu === "mood" && (
              <MoodPanel
                mood={view.mood}
                onChange={(patch, preview) => engine.current?.setMood(patch, preview)}
              />
            )}
          </div>
          <button
            className="icon-button"
            onClick={() => setHelp(true)}
            aria-label="How to play"
            title="How to play"
          >
            <Icon name="help" />
          </button>
          <div className="menu-anchor">
            <button
              className={`icon-button ${menu === "table" ? "active" : ""}`}
              onClick={() => setMenu(menu === "table" ? null : "table")}
              aria-label="Table options"
              title="Table options"
            >
              <Icon name="dots" />
            </button>
            {menu === "table" && (
              <div className="dropdown table-menu">
                <span className="menu-heading">YOUR TABLE</span>
                <button
                  aria-label="Clear table"
                  onClick={() => {
                    engine.current?.reset(true);
                    setMenu(null);
                  }}
                >
                  <Icon name="paper" />
                  <span>
                    Clear table
                    <small>Remove objects and drawings · Undo available</small>
                  </span>
                </button>
                <button
                  aria-label="Export table"
                  onClick={() => {
                    void engine.current?.exportTable();
                    setMenu(null);
                  }}
                >
                  <Icon name="undo" />
                  <span>
                    Export table
                    <small>Save a portable file with images and videos</small>
                  </span>
                </button>
                <button aria-label="Import table" onClick={() => { tableFiles.current?.click(); setMenu(null); }}>
                  <Icon name="paper" /><span>Import table<small>Open a .goblin.json table file</small></span>
                </button>
                {view.mediaErrors > 0 && <button aria-label="Find unavailable media" onClick={() => { engine.current?.findUnavailableMedia(); setMenu(null); }}>
                  <Icon name="image" /><span>Find unavailable media<small>{view.mediaErrors} file{view.mediaErrors === 1 ? "" : "s"} · locate and select</small></span>
                </button>}
                {view.recoveryAvailable && <button aria-label="Export saved data for recovery" onClick={() => { void engine.current?.exportSavedTable(); setMenu(null); }}>
                  <Icon name="undo" /><span>Export saved data<small>Keep the original saved record for recovery</small></span>
                </button>}
                <div className="menu-foot">
                  {view.loadError ? "The original saved table is protected. New changes are not being saved." : view.storage === "saved" ? "Saved locally in this browser." : view.storage === "saving" ? "Saving locally…" : view.storage === "error" ? "Local saving unavailable. Export to keep your table." : "Opening your local table…"}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>
      {contextPoint && view.selection.length > 0 && engine.current && (
        <ObjectActions engine={engine.current} selection={view.selection} point={contextPoint}
          colors={surfaceColors} onClose={() => setContextPoint(null)} />
      )}
      {drawing && (
        <div className="draw-bar" role="toolbar" aria-label="Drawing settings">
          <div className="pen-types">
            {(["pen", "highlighter", "eraser"] as const).map((t) => (
              <button
                key={t}
                className={view.tool === t ? "active" : ""}
                onClick={() => tool(t)}
                aria-label={t}
                title={`${t[0].toUpperCase() + t.slice(1)} (${t === "pen" ? "D" : t === "highlighter" ? "H" : "E"})`}
              >
                <Icon name={t} size={18} />
              </button>
            ))}
          </div>
          <span className="divider" />
          <div className="swatches">
            {colors.map(([name, color]) => (
              <button
                key={color}
                className={`swatch ${view.color === color ? "chosen" : ""}`}
                style={{ "--swatch": color } as React.CSSProperties}
                onClick={() => engine.current?.setColor(color)}
                aria-label={`${name} ink`}
                title={`${name} ink`}
                aria-pressed={view.color === color}
              />
            ))}
          </div>
          <span className="divider" />
          <label className="thickness" title="Stroke thickness">
            <span
              style={{
                width: Math.max(4, view.thickness),
                height: Math.max(4, view.thickness),
              }}
            />
            <input
              type="range"
              aria-label="Stroke thickness"
              min="1"
              max="12"
              step="0.1"
              value={view.thickness}
              onChange={(e) =>
                engine.current?.setThickness(Number(e.target.value))
              }
            />
            <NumericValue
              label="Stroke thickness"
              value={view.thickness}
              min={1}
              max={12}
              onChange={(n) => engine.current?.setThickness(n)}
            />
          </label>
          {view.tool !== "eraser" && (
            <label className="pen-smoothing">
              Smooth
              <input
                type="range"
                step="0.1"
                aria-label="Pen smoothing"
                min="0"
                max="100"
                value={view.smoothing * 100}
                onChange={(e) =>
                  engine.current?.setSmoothing(Number(e.target.value) / 100)
                }
              />
              <NumericValue
                label="Pen smoothing"
                value={view.smoothing * 100}
                min={0}
                max={100}
                suffix="%"
                onChange={(n) => engine.current?.setSmoothing(n / 100)}
              />
            </label>
          )}
        </div>
      )}
      {toast && !menu && !editor && !capturePanel && (
        <div className="toast" role="status">
          <Icon name="check" size={16} />
          {toast}
        </div>
      )}
      <div className="bottom-tools">
        <nav className="toolbar" aria-label="Table tools">
          <button
            className={`tool-button ${view.tool === "select" ? "active" : ""}`}
            onClick={() => tool("select")}
            title="Select & move (V)"
            aria-label="Select"
          >
            <Icon name="select" />
            <span>Select</span>
            <kbd>V</kbd>
          </button>
          <button
            className={`tool-button ${drawing ? "active" : ""}`}
            onClick={() => tool("pen")}
            title="Draw on a surface (D)"
            aria-label="Draw"
          >
            <Icon name="pen" />
            <span>Draw</span>
            <kbd>D</kbd>
          </button>
          <button
            className={`tool-button ${view.tool === "laser" ? "active" : ""}`}
            onClick={() => tool("laser")}
            title="Temporary laser pointer (L)"
            aria-label="Laser"
          >
            <Icon name="laser" />
            <span>Laser</span>
            <kbd>L</kbd>
          </button>
          <span className="divider" />
          <button
            className={`tool-button transform-toggle ${view.transforms ? "enabled" : ""}`}
            onClick={() => engine.current?.toggleTransforms()}
            aria-label="Toggle transform controls"
            aria-pressed={view.transforms}
            title="Toggle resize & rotation handles (T)"
          >
            <Icon name="transform" />
            <span>{view.transforms ? "Transform" : "Move only"}</span>
            <kbd>T</kbd>
          </button>
          <span className="divider" />
          <div className="menu-anchor">
            <button
              className={`tool-button add-button ${menu === "add" || menu === "shapes" ? "active" : ""}`}
              onClick={() =>
                setMenu(menu === "add" || menu === "shapes" ? null : "add")
              }
              title="Add a surface"
              aria-label="Add"
            >
              <Icon name="plus" />
              <span>Add</span>
            </button>
            {menu === "shapes" && (
              <div className="dropdown add-menu shapes-menu">
                <button className="shapes-back" onClick={() => setMenu("add")}>
                  ← Back to Add
                </button>
                <span className="menu-heading">SHAPES</span>
                <div className="shape-grid">
                  {shapeChoices.map((shape) => (
                    <button
                      key={shape}
                      aria-label={`Add ${shapeLabels[shape]}`}
                      onClick={() => {
                        engine.current?.addShape(shape, shapeColor);
                        setMenu(null);
                      }}
                      style={{ color: shapeColor }}
                    >
                      <ShapeIcon shape={shape} />
                      <span>{shapeLabels[shape]}</span>
                    </button>
                  ))}
                </div>
                <div className="surface-swatches">
                  {surfaceColors.map((color) => (
                    <button
                      key={color}
                      style={{ background: color }}
                      className={shapeColor === color ? "chosen" : ""}
                      aria-label={`New shape color ${color}`}
                      onClick={() => setShapeColor(color)}
                    />
                  ))}
                </div>
                <div className="menu-foot">
                  Select a shape and paste art to make a token.
                </div>
              </div>
            )}
            {menu === "add" && (
              <div className="dropdown add-menu">
                <span className="menu-heading">ADD</span>
                <button onClick={() => { setMenu(null); engine.current?.addText(); }}>
                  <Icon name="text" /><span>Text<small>Notes, labels and annotations</small></span>
                </button>
                <button
                  onClick={() => {
                    setMenu("shapes");
                  }}
                >
                  <Icon name="shapes" />
                  <span>
                    Shapes<small>Pick a shape, give it a color</small>
                  </span>
                  <Icon name="arrow" size={15} />
                </button>
                <button
                  onClick={() => {
                    files.current?.click();
                    setMenu(null);
                  }}
                >
                  <Icon name="play" />
                  <span>
                    Video / GIF<small>MP4, WebM, GIF · looping</small>
                  </span>
                  <Icon name="arrow" size={15} />
                </button>
                <button
                  onClick={() => {
                    setMenu(null);
                    void engine.current?.addScreen();
                  }}
                >
                  <Icon name="screen" />
                  <span>
                    Live screen<small>Window or screen · optional sound</small>
                  </span>
                  <span className="live-dot" />
                </button>
                <button
                  onClick={() => {
                    setMenu(null);
                    setCaptureTarget(undefined);
                    setCapturePanel("camera");
                  }}
                >
                  <Icon name="camera" />
                  <span>
                    Camera / virtual camera
                    <small>Webcam, OBS, or another video device</small>
                  </span>
                  <span className="live-dot" />
                </button>
                <button
                  onClick={() => {
                    setMenu(null);
                    setCapturePanel("audio");
                  }}
                >
                  <Icon name="audio" />
                  <span>
                    Audio source
                    <small>Tab, computer, microphone, virtual input</small>
                  </span>
                  <Icon name="arrow" size={15} />
                </button>
                <button onClick={() => { files.current?.click(); setMenu(null); }}>
                  <Icon name="audio" /><span>Audio file<small>Drop music, ambience, or sound effects</small></span>
                </button>
                <button
                  onClick={() => {
                    files.current?.click();
                    setMenu(null);
                  }}
                >
                  <Icon name="image" />
                  <span>
                    Image<small>Or just paste / drop one here</small>
                  </span>
                  <Icon name="arrow" size={15} />
                </button>
              </div>
            )}
          </div>
          <span className="divider" />
          <button
            className="history-button"
            disabled={!view.canUndo}
            onClick={() => engine.current?.undo()}
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
          >
            <Icon name="undo" size={19} />
          </button>
          <button
            className="history-button"
            disabled={!view.canRedo}
            onClick={() => engine.current?.redo()}
            aria-label="Redo"
            title="Redo (Ctrl+Shift+Z)"
          >
            <Icon name="redo" size={19} />
          </button>
        </nav>
      </div>
      <div className="navigation-hint">
        <span>
          <kbd>Space</kbd> + drag to pan
        </span>
        <span>
          Scroll to zoom <i>·</i> <kbd>Ctrl V</kbd> to paste
        </span>
      </div>
      <div className="zoom-controls">
        <button
          onClick={() => engine.current?.zoom(1 / 1.2)}
          aria-label="Zoom out"
          title="Zoom out"
        >
          <Icon name="minus" size={16} />
        </button>
        <NumericValue
          label="Table zoom"
          value={view.zoom * 100}
          min={10}
          max={400}
          suffix="%"
          digits={0}
          onChange={(n) => engine.current?.zoom(n / (view.zoom * 100))}
        />
        <button
          onClick={() => engine.current?.zoom(1.2)}
          aria-label="Zoom in"
          title="Zoom in"
        >
          <Icon name="plus" size={16} />
        </button>
        <span className="divider" />
        <button
          onClick={() => engine.current?.fit()}
          aria-label="Fit all surfaces"
          title="Fit all surfaces (Home)"
        >
          <Icon name="fit" size={16} />
        </button>
      </div>
      <input
        ref={files}
        type="file"
        accept="image/*,video/*,audio/*,.mp4,.webm,.gif,.mp3,.wav,.m4a,.ogg,.oga,.opus,.aac,.flac"
        multiple
        hidden
        onChange={(e) => {
          void engine.current?.addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      {menu && <div className="menu-dismiss" onClick={() => setMenu(null)} />}
      {editObject?.kind === "text" && engine.current && <TextEditor key={editObject.id} object={editObject} engine={engine.current} onClose={closeEditor} />}
      {editObject && editObject.kind !== "text" && engine.current && (
        <MediaEditor
          object={editObject}
          engine={engine.current}
          onClose={closeEditor}
        />
      )}
      {help && (
        <div className="help-backdrop" onClick={() => setHelp(false)}>
          <section
            className="help-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key !== "Tab") return;
              const buttons = Array.from(
                e.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
              );
              if (e.shiftKey && document.activeElement === buttons[0]) {
                e.preventDefault();
                buttons.at(-1)?.focus();
              } else if (
                !e.shiftKey &&
                document.activeElement === buttons.at(-1)
              ) {
                e.preventDefault();
                buttons[0]?.focus();
              }
            }}
          >
            <button
              className="help-close icon-button"
              onClick={() => setHelp(false)}
              aria-label="Close help"
            >
              <Icon name="close" />
            </button>
            <h2 id="help-title">Controls</h2>
            <div className="help-grid">
              <article>
                <Icon name="select" />
                <h3>Pick up & place</h3>
                <p>
                  Drag a surface to move it. Place a smaller thing mostly onto
                  another and they travel together. Drag it away to separate.
                </p>
              </article>
              <article>
                <Icon name="pen" />
                <h3>Draw</h3>
                <p>
                  Draw on a shape, an image, or a live screen. Marks stay with
                  the surface you start on. The eraser removes whole strokes.
                </p>
              </article>
              <article>
                <Icon name="screen" />
                <h3>Images & media</h3>
                <p>
                  Paste art into a selected shape to make a token. Drop images,
                  GIFs or videos. Double-click to frame art or crop a source.
                  Live sources are shared with participants in an online room.
                </p>
              </article>
              <article>
                <Icon name="laser" />
                <h3>Laser pointer</h3>
                <p>
                  Hold the laser to point. Its trail fades without leaving a
                  permanent mark.
                </p>
              </article>
            </div>
            <div className="shortcut-grid">
              <span>Pan the table</span>
              <span>
                <kbd>Space</kbd> + drag / middle drag
              </span>
              <span>Resize / rotate</span>
              <span>Drag an edge / the round handle</span>
              <span>Keep proportions / snap rotation</span>
              <kbd>Shift</kbd>
              <span>Stretch an image or screen freely</span>
              <kbd>Alt</kbd>
              <span>Select several</span>
              <span>
                Drag empty space · <kbd>Shift</kbd> to add
              </span>
              <span>Object / bulk actions</span>
              <span>Right-click a selected object</span>
              <span>Lock / unlock a background</span>
              <span>Right-click → Lock / Unlock object</span>
              <span>Undo / redo</span>
              <span>
                <kbd>Ctrl Z</kbd> / <kbd>Ctrl Shift Z</kbd>
              </span>
              <span>Remove a surface</span>
              <kbd>Delete</kbd>
              <span>Show / hide transform handles</span>
              <kbd>T</kbd>
              <span>Copy / paste with attached contents</span>
              <span>
                <kbd>Ctrl C</kbd> / <kbd>Ctrl V</kbd>
              </span>
              <span>Duplicate with attached contents</span>
              <kbd>Ctrl D</kbd>
            </div>
            <p className="help-foot">
              Removing a surface leaves its contents on the table.
              <br />
              Objects, drawings, imported media, and settings save locally.
              Live screen/camera and audio sources need reconnecting after a reload.
            </p>
            <button className="primary-button" onClick={() => setHelp(false)}>
              Close <Icon name="arrow" size={17} />
            </button>
          </section>
        </div>
      )}
      {engine.current && (
        <WidgetDock
          engine={engine.current}
          view={view}
          active={activeWidget}
          onActive={setActiveWidget}
        />
      )}
      <input ref={tableFiles} type="file" accept=".json,.goblin.json" hidden aria-label="Import table file" onChange={(e) => {
        const file = e.target.files?.[0]; if (file) void engine.current?.importTable(file); e.target.value = "";
      }} />
      {view.loadError && <aside className="storage-recovery" role="alert" aria-label="Saved table recovery">
        <strong>Saved table could not be opened</strong>
        <p>{view.loadError}</p>
        <div>
          <button onClick={() => { void engine.current?.exportSavedTable(); }}>Export saved data</button>
          <button onClick={() => { void engine.current?.restoreLocal(); }}>Retry</button>
        </div>
      </aside>}
      {view.storage === "loading" && <div className="loading-cover" role="status">Opening your table…</div>}
      {capturePanel === "camera" && engine.current && (
        <CameraPanel
          engine={engine.current}
          targetId={captureTarget}
          onClose={() => setCapturePanel(null)}
        />
      )}
      {capturePanel === "audio" && engine.current && (
        <AudioPanel
          engine={engine.current}
          onClose={() => setCapturePanel(null)}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
