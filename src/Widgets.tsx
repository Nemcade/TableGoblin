import { useEffect, useRef, useState } from "react";
import type { TableEngine, ViewState } from "./engine";
import { diceTypes, diceNotation, defaultDiceGroup, type DieSides } from "./dice";
import { measurementLabel, defaultGrid } from "./table-widgets";
import { NumericValue } from "./NumericValue";
import { ColorControl } from "./ColorControl";
import { dicePalette } from "./dice-style";
import { PresetControl } from "./PresetControl";
import { parseDiceSetup, parseGrid, gridSetup } from "./presets";
import type { RollRecord } from "./dice";
import type { Mood } from "./mood";
function RollValues({ record, mood, separator = " + " }: { record: RollRecord; mood: Mood; separator?: string }) {
  if (record.dice.every((d) => !d.groupId || (d.groupId === "main" && d.groupName === "Main")))
    return <>{record.dice.map((d) => d.value).join(separator)}</>;
  const ids = [...new Set(record.dice.map((d) => d.groupId))];
  return <span className="group-results">{ids.map((id) => {
    const dice = record.dice.filter((d) => d.groupId === id), first = dice[0];
    const color = dicePalette(mood, first.color, first.fontColor);
    return <span className="group-result" key={id} title={`${first.groupName}: ${dice.map((d) => `d${d.sides} = ${d.value}`).join(", ")}`}>
      <i style={{ background: color.color }} /><span>{first.groupName}<b>{dice.map((d) => d.value).join(" + ")}</b></span>
    </span>;
  })}</span>;
}
export type WidgetName = "dice" | "grid" | "obscure";
export function WidgetIcon({
  name,
  size = 20,
}: {
  name: WidgetName | "widgets";
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "dice" ? (
        <>
          <path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm0 10 9-5M12 12 3 7m9 5v10" />
          <circle cx="7.5" cy="13" r=".7" fill="currentColor" />
          <circle cx="16.5" cy="14" r=".7" fill="currentColor" />
          <circle cx="16.5" cy="17" r=".7" fill="currentColor" />
        </>
      ) : name === "grid" ? (
        <>
          <path d="M3 3h18v18H3zM9 3v18m6-18v18M3 9h18M3 15h18" />
        </>
      ) : name === "obscure" ? (
        <>
          <path d="M5 18c-5-2-3-9 2-9C7 2 18 2 18 9c7 0 6 11-1 11H7" />
          <path d="M7 14c1-4 8-4 10 0-2 4-9 4-10 0Z" />
          <circle cx="12" cy="14" r="1.4" />
        </>
      ) : (
        <>
          <rect x="3" y="3" width="7" height="7" rx="2" />
          <rect x="14" y="3" width="7" height="7" rx="2" />
          <rect x="3" y="14" width="7" height="7" rx="2" />
          <path d="M17.5 14v7M14 17.5h7" />
        </>
      )}
    </svg>
  );
}
export function WidgetMenu({
  view,
  onToggle,
}: {
  view: ViewState;
  onToggle: (name: WidgetName, enabled: boolean) => void;
}) {
  return (
    <div className="dropdown widgets-menu">
      <span className="menu-heading">WIDGETS</span>
      {(
        [
          ["dice", "3D dice", "Roll dice and view history", view.dice.enabled],
          [
            "grid",
            "Grid & measure",
            "Grid spacing and ruler",
            view.grid.enabled,
          ],
          [
            "obscure",
            "Obscure",
            "Reveal and cover areas",
            view.obscure.enabled,
          ],
        ] as [WidgetName, string, string, boolean][]
      ).map(([name, label, detail, enabled]) => (
        <label key={name} className="widget-option">
          <WidgetIcon name={name} />
          <span>
            {label}
            <small>{detail}</small>
          </span>
          <input
            type="checkbox"
            aria-label={`${label} widget`}
            checked={enabled}
            onChange={(e) => onToggle(name, e.target.checked)}
          />
          <i />
        </label>
      ))}
    </div>
  );
}
function DieIcon({ sides }: { sides: DieSides }) {
  const path =
    sides === 4
      ? "M16 3 30 27H2L16 3Z"
      : sides === 6
        ? "M5 5h22v22H5z"
        : sides === 8
          ? "M16 2 29 16 16 30 3 16Z"
          : sides === 10 || sides === 100
            ? "M16 2 29 12 25 25 16 30 7 25 3 12Z"
            : sides === 12
              ? "M16 2 29 12 24 28 8 28 3 12Z"
              : "M16 2 29 9 29 25 16 32 3 25 3 9Z";
  return (
    <svg viewBox="0 0 32 34" width="31" height="33" aria-hidden="true">
      <path
        d={path}
        fill="currentColor"
        fillOpacity=".06"
        stroke="currentColor"
        strokeWidth="1"
      />
      <text
        x="16"
        y="18"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="currentColor"
        fontSize={sides === 100 ? "9" : "11"}
        fontFamily="Palatino Linotype,Book Antiqua,Georgia,serif"
      >
        {sides}
      </text>
    </svg>
  );
}
function UnitInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value)),
    focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);
  return (
    <input
      aria-label="Units per square"
      type="number"
      min="0.001"
      max="1000000"
      step="any"
      value={draft}
      onFocus={() => (focused.current = true)}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = Number(e.target.value);
        if (Number.isFinite(n) && n > 0) onChange(n);
      }}
      onBlur={() => {
        focused.current = false;
        setDraft(String(value));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
export function WidgetDock({
  engine,
  view,
  active,
  onActive,
}: {
  engine: TableEngine;
  view: ViewState;
  active: WidgetName | null;
  onActive: (name: WidgetName | null) => void;
}) {
  const enabled: WidgetName[] = [];
  if (view.dice.enabled) enabled.push("dice");
  if (view.grid.enabled) enabled.push("grid");
  if (view.obscure.enabled) enabled.push("obscure");
  if (!enabled.length) return null;
  const current = active && enabled.includes(active) ? active : null;
  const group = view.dice.groups.find((g) => g.id === view.dice.activeGroup)!;
  const groupPool = group.pool;
  const palette = dicePalette(view.mood, group.color ?? view.dice.color, group.fontColor ?? view.dice.fontColor);
  return (
    <aside
      className={`widget-dock ${current ? "expanded" : "collapsed"}`}
      aria-label="Optional table widgets"
    >
      <div className="widget-tabs">
        {enabled.map((name) => (
          <button
            key={name}
            aria-label={`Open ${name === "grid" ? "Grid & measure" : name === "dice" ? "Dice" : "Obscure"} widget`}
            aria-pressed={current === name}
            onClick={() => onActive(current === name ? null : name)}
          >
            <WidgetIcon name={name} size={17} />
            <span>
              {name === "grid" ? "Grid" : name === "dice" ? "Dice" : "Obscure"}
            </span>
          </button>
        ))}
      </div>
      {current && (
        <section
          className="widget-panel"
          aria-label={`${current === "grid" ? "Grid & measure" : current === "dice" ? "Dice" : "Obscure"} controls`}
        >
          <div className="widget-heading">
            <h2>
              {current === "dice"
                ? "Dice"
                : current === "grid"
                  ? "Grid & measure"
                  : "Obscure"}
            </h2>
            {current === "dice" && (
              <button
                className="dice-sound-toggle"
                aria-label="Dice sounds"
                aria-pressed={view.dice.sound}
                title={
                  view.dice.sound ? "Mute dice sounds" : "Enable dice sounds"
                }
                onClick={() => engine.dice.setSound(!view.dice.sound)}
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M4 9h4l5-4v14l-5-4H4z" />
                  {view.dice.sound ? (
                    <path d="M16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
                  ) : (
                    <path d="m17 9 5 6m0-6-5 6" />
                  )}
                </svg>
              </button>
            )}
            <button
              className="widget-collapse"
              aria-label="Collapse widget"
              onClick={() => onActive(null)}
            >
              −
            </button>
          </div>
          {current === "dice" && (
            <>
              <PresetControl kind="Dice" value={engine.dice.setup()} parse={parseDiceSetup} onApply={(setup) => engine.dice.applySetup(setup)} disabled={view.dice.rolling} basic={{ id: "basic-dice", name: "Basic dice", value: { color: null, fontColor: null, groups: [defaultDiceGroup()] } }} />
              {view.dice.groups.length > 1 && <div className="dice-groups" aria-label="Dice color groups">
                {view.dice.groups.map((g) => <button key={g.id} aria-label={`Use dice group ${g.name || "Group"}`} aria-pressed={group.id === g.id} onClick={() => engine.dice.selectGroup(g.id)}>
                  <i style={{ background: dicePalette(view.mood, g.color ?? view.dice.color).color }} />
                  <span>{g.name.trim() || "Group"}</span><small>{Object.values(g.pool).reduce((sum, n) => sum + (n ?? 0), 0)}</small>
                </button>)}
              </div>}
              <div className="dice-picker">
                {diceTypes.map((s) => (
                  <div className="die-choice" key={s}>
                    <button
                      aria-label={`Add d${s}`}
                      title={`Add d${s} · right-click to remove`}
                      disabled={view.dice.rolling}
                      onClick={() => engine.dice.choose(s)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        engine.dice.choose(s, true);
                      }}
                    >
                      <DieIcon sides={s} />
                      {!!groupPool[s] && <b>{groupPool[s]}</b>}
                    </button>
                    {!!groupPool[s] && (
                      <button
                        className="remove-die"
                        aria-label={`Remove d${s}`}
                        disabled={view.dice.rolling}
                        onClick={() => engine.dice.choose(s, true)}
                      >
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 10 10"
                          aria-hidden="true"
                        >
                          <path
                            d="M2 5h6"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="dice-pool">
                <span>{diceNotation(view.dice.pool) || "Pick your dice"}</span>
                <button
                  disabled={view.dice.rolling || !diceNotation(view.dice.pool)}
                  aria-label="Clear dice selection"
                  onClick={() => engine.dice.clearPool()}
                >
                  Clear
                </button>
              </div>
              <button
                className="widget-primary roll-button"
                disabled={view.dice.rolling || !diceNotation(view.dice.pool)}
                onClick={() => engine.rollDice()}
              >
                {view.dice.rolling ? "Rolling…" : "Roll dice"}
                <span aria-hidden="true">↗</span>
              </button>
              <div className="dice-result" aria-live="polite">
                {view.dice.rolling ? (
                  <span>Rolling…</span>
                ) : view.dice.result ? (
                  <>
                    <strong>{view.dice.result.total}</strong>
                    <span>
                      <RollValues record={view.dice.result} mood={view.mood} />
                      <small>{view.dice.result.notation}</small>
                    </span>
                  </>
                ) : (
                  <span>Click a die twice to roll two.</span>
                )}
              </div>
              <details className="dice-appearance">
                <summary>Dice colors</summary>
                <label className="dice-group-name">Group name<input aria-label="Dice group name" maxLength={24} value={group.name} onChange={(e) => engine.dice.renameGroup(e.target.value)} /></label>
                <ColorControl
                  label="Dice color"
                  value={palette.color}
                  onChange={(color, preview) => engine.dice.setAppearance({ color }, preview)}
                  onReset={() => engine.dice.setAppearance({ color: null })}
                  resetLabel={group.id === "main" ? "Use theme dice color" : "Use default dice color"}
                  automatic={group.id === "main" ? view.dice.color === null : group.color === null}
                />
                <ColorControl
                  label="Numeral color"
                  value={palette.fontColor}
                  onChange={(fontColor, preview) =>
                    engine.dice.setAppearance({ fontColor }, preview)
                  }
                  onReset={() => engine.dice.setAppearance({ fontColor: null })}
                  resetLabel={group.id === "main" ? "Use automatic numeral color" : "Use default numeral color"}
                  automatic={group.id === "main" ? view.dice.fontColor === null : group.fontColor === null}
                />
                <div className="dice-preview-row">
                  <span>Preview</span>
                  <span
                    className="dice-color-preview"
                    role="img"
                    aria-label="Dice color preview"
                    style={{
                      background: palette.color,
                      color: palette.fontColor,
                      borderColor: palette.edge,
                    }}
                  >
                    20
                  </span>
                </div>
                <div className="dice-group-actions">
                  <button disabled={view.dice.rolling || view.dice.groups.length >= 6} onClick={() => engine.dice.addGroup()}>+ Add color group</button>
                  {group.id !== "main" && <button disabled={view.dice.rolling} onClick={() => engine.dice.removeGroup()}>Remove group</button>}
                </div>
                <p className="preset-note">Choose a group, then add its dice. Roll throws all groups together.</p>
              </details>
              {!!view.dice.history.length && (
                <>
                  <div className="widget-section-heading">
                    RECENT ROLLS
                    <button
                      disabled={!view.dice.visible || view.dice.rolling}
                      onClick={() => engine.dice.clearTable()}
                    >
                      Clear table dice
                    </button>
                  </div>
                  <ol className="roll-history">
                    {view.dice.history.slice(0, 6).map((r) => (
                      <li key={r.id}>
                        <span>
                          {r.notation}
                          <small>
                            <RollValues record={r} mood={view.mood} separator=" · " />
                          </small>
                        </span>
                        <strong>{r.total}</strong>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </>
          )}
          {current === "grid" && (
            <>
              <PresetControl kind="Grid" value={gridSetup(view.grid)} parse={parseGrid} onApply={(setup) => engine.setGrid(setup)} basic={{ id: "basic-grid", name: "Standard grid", value: gridSetup(defaultGrid) }} />
              <p className="widget-intro">The grid does not snap objects.</p>
              <label className="widget-slider">
                Square size
                <NumericValue
                  label="Grid square size"
                  value={view.grid.size}
                  min={12}
                  max={240}
                  onChange={(size) => engine.setGrid({ size })}
                />
                <input
                  type="range"
                  min="12"
                  max="240"
                  step="0.1"
                  value={view.grid.size}
                  aria-label="Grid square size"
                  onChange={(e) =>
                    engine.setGrid({ size: Number(e.target.value) })
                  }
                />
              </label>
              <div className="grid-units">
                <span>1 square =</span>
                <UnitInput
                  value={view.grid.units}
                  onChange={(units) => engine.setGrid({ units })}
                />
                <input
                  type="text"
                  aria-label="Scale unit name"
                  maxLength={24}
                  value={view.grid.unit}
                  onChange={(e) => engine.setGrid({ unit: e.target.value })}
                />
              </div>
              <label className="widget-slider">
                Rotation
                <NumericValue
                  label="Grid rotation"
                  value={view.grid.angle}
                  suffix="°"
                  min={-180}
                  max={180}
                  onChange={(angle) => engine.setGrid({ angle })}
                />
                <input
                  type="range"
                  min="-180"
                  max="180"
                  step="0.1"
                  value={view.grid.angle}
                  aria-label="Grid rotation"
                  onChange={(e) =>
                    engine.setGrid({ angle: Number(e.target.value) })
                  }
                />
              </label>
              <label className="widget-slider">
                Grid opacity
                <NumericValue
                  label="Grid opacity"
                  value={view.grid.opacity * 100}
                  suffix="%"
                  min={0}
                  max={60}
                  onChange={(opacity) =>
                    engine.setGrid({ opacity: opacity / 100 })
                  }
                />
                <input
                  type="range"
                  min="0"
                  max="60"
                  step="0.1"
                  value={view.grid.opacity * 100}
                  aria-label="Grid opacity"
                  onChange={(e) =>
                    engine.setGrid({ opacity: Number(e.target.value) / 100 })
                  }
                />
              </label>
              <button
                className="widget-primary"
                aria-pressed={view.tool === "measure"}
                onClick={() =>
                  engine.setTool(view.tool === "measure" ? "select" : "measure")
                }
              >
                {view.tool === "measure" ? "Ruler is active" : "Use ruler"}
                <span aria-hidden="true">↗</span>
              </button>
              <div className="measure-result" aria-live="polite">
                <strong>
                  {view.measurement
                    ? measurementLabel(view.measurement, view.grid)
                    : "—"}
                </strong>
                <button
                  disabled={!view.measurement}
                  onClick={() => engine.clearMeasurement()}
                >
                  Clear
                </button>
              </div>
              <p className="widget-note">
                Drag freely to measure. Set opacity to zero for just the ruler.{" "}
                <kbd>M</kbd> switches to the ruler.
              </p>
            </>
          )}
          {current === "obscure" && (
            <>
              <p className="widget-intro">
                Draw a closed loop to reveal or conceal.
              </p>
              <div className="obscure-modes">
                {(["reveal", "cover"] as const).map((mode) => (
                  <button
                    key={mode}
                    aria-pressed={
                      view.obscure.mode === mode && view.tool === "obscure"
                    }
                    onClick={() => {
                      engine.setObscure({ mode });
                      engine.setTool("obscure");
                    }}
                  >
                    {mode === "reveal" ? "Reveal" : "Cover"}
                    <span aria-hidden="true">
                      {mode === "reveal" ? "−" : "+"}
                    </span>
                  </button>
                ))}
              </div>
              <label className="gm-toggle">
                <span>
                  GM view<small>See through the covered areas</small>
                </span>
                <input
                  type="checkbox"
                  aria-label="GM transparency"
                  checked={view.obscure.gm}
                  onChange={(e) => engine.setObscure({ gm: e.target.checked })}
                />
                <i />
              </label>
              {view.obscure.gm && <label className="widget-slider">
                GM cover opacity
                <NumericValue label="GM cover opacity" value={(view.obscure.gmOpacity ?? .28) * 100} suffix="%" min={0} max={100}
                  onChange={opacity => engine.setObscure({ gmOpacity: opacity / 100 })} />
                <input type="range" min="0" max="100" step="1" aria-label="GM cover opacity"
                  value={(view.obscure.gmOpacity ?? .28) * 100}
                  onChange={e => engine.setObscure({ gmOpacity: Number(e.target.value) / 100 })} />
              </label>}
              <div className="obscure-history">
                <button
                  disabled={!view.obscureUndo}
                  onClick={() => engine.undoObscure()}
                  aria-label="Undo obscure"
                >
                  ↶ Undo
                </button>
                <button
                  disabled={!view.obscureRedo}
                  onClick={() => engine.undoObscure(true)}
                  aria-label="Redo obscure"
                >
                  Redo ↷
                </button>
              </div>
              <div className="obscure-reset">
                <button onClick={() => engine.resetObscure(true)}>
                  Cover everything
                </button>
                <button onClick={() => engine.resetObscure(false)}>
                  Reveal everything
                </button>
              </div>
              <p className="widget-note">
                The cover has no edge and never blocks objects. Hold{" "}
                <kbd>Shift</kbd> to reverse the lasso. <kbd>O</kbd> activates
                it; <kbd>Esc</kbd> returns to moving.
              </p>
            </>
          )}
        </section>
      )}
    </aside>
  );
}
