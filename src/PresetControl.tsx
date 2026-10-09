import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { readPresets, writePresets, type Preset } from "./presets";
const canonical = (value: unknown): string => JSON.stringify(value, (_key, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]])) : v);

export function PresetControl<T>({ kind, value, parse, onApply, basic, disabled = false }: {
  kind: "Theme" | "Dice" | "Grid";
  value: T;
  parse: (value: unknown) => T | null;
  onApply: (value: T) => void;
  basic: Preset<T>;
  disabled?: boolean;
}) {
  const key = kind.toLowerCase(), activeKey = `table-goblin.presets.${key}.active.v1`;
  const [presets, setPresets] = useState<Preset<T>[]>(() => {
    try { return readPresets(localStorage, key, parse); } catch { return []; }
  });
  const all = [basic, ...presets];
  const [selected, setSelected] = useState(() => {
    try { const id = localStorage.getItem(activeKey); if (all.some((p) => p.id === id)) return id!; } catch {}
    return all.find((p) => canonical(p.value) === canonical(parse(value)))?.id ?? basic.id;
  });
  const baseline = useRef(all.find((p) => p.id === selected)?.value ?? basic.value);
  const [name, setName] = useState(all.find((p) => p.id === selected)?.name ?? "");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ kind: "switch" | "save"; target: Preset<T>; current: T } | null>(null);
  const [copyName, setCopyName] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const matching = presets.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
  const basicName = name.trim().toLowerCase() === basic.name.toLowerCase();
  const dirty = canonical(parse(value)) !== canonical(baseline.current);
  const uniqueName = (base: string) => {
    const prefix = base.slice(0, 31); let next = `${prefix} copy`, i = 2;
    while (all.some((p) => p.name.toLowerCase() === next.toLowerCase())) next = `${prefix} copy ${i++}`;
    return next;
  };
  useEffect(() => {
    if (!pending) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); setPending(null); }
      if (e.key === "Tab") {
        const elements = [...(dialog.current?.querySelectorAll<HTMLElement>("input,button:not(:disabled)") ?? [])];
        const first = elements[0], last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", keyboard, true);
    return () => { document.removeEventListener("keydown", keyboard, true); previous?.focus(); };
  }, [pending]);
  const remember = (id: string) => { setSelected(id); try { localStorage.setItem(activeKey, id); } catch {} };
  const store = (next: Preset<T>[]) => {
    setPresets(next);
    try { setError(writePresets(localStorage, key, next) ? "" : "Browser storage unavailable. Presets last until this page closes."); }
    catch { setError("Browser storage unavailable. Presets last until this page closes."); }
  };
  const load = (preset: Preset<T>) => {
    baseline.current = structuredClone(preset.value); remember(preset.id); setName(preset.name); onApply(structuredClone(preset.value));
  };
  const save = (preset: Preset<T>) => {
    store(presets.some((p) => p.id === preset.id) ? presets.map((p) => p.id === preset.id ? preset : p) : [...presets, preset]);
    baseline.current = structuredClone(preset.value); remember(preset.id); setName(preset.name);
  };
  const request = (target: Preset<T>, mode: "switch" | "save") => {
    const current = parse(value); if (!current) return;
    if (mode === "switch" && !dirty) { load(target); return; }
    setCopyName(uniqueName(mode === "save" ? target.name : all.find((p) => p.id === selected)?.name ?? "Current setup"));
    setPending({ kind: mode, target, current: structuredClone(current) });
  };
  return <details className="preset-control">
    <summary>{kind} presets</summary>
    <div className="preset-load">
      <select aria-label={`${kind} preset`} value={dirty ? "" : selected} disabled={disabled} onChange={(e) => {
        const preset = all.find((p) => p.id === e.target.value); if (preset) request(preset, "switch");
      }}>
        <option value="" disabled hidden>Unsaved preset changes</option>
        {all.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button type="button" aria-label={`Delete ${key} preset`} title="Delete selected preset" disabled={disabled || selected === basic.id} onClick={() => {
        store(presets.filter((p) => p.id !== selected)); remember(basic.id); baseline.current = basic.value; setName("");
      }}>×</button>
    </div>
    <form className="preset-save" onSubmit={(e) => {
      e.preventDefault();
      if (disabled || !name.trim() || (!matching && presets.length >= 30)) return;
      const current = parse(value); if (!current) return;
      if (matching) request(matching, "save");
      else save({ id: crypto.randomUUID(), name: basicName ? uniqueName(basic.name) : name.trim(), value: structuredClone(current) });
    }}>
      <input type="text" aria-label={`${kind} preset name`} placeholder="Name this setup" maxLength={40} value={name} disabled={disabled} onChange={(e) => setName(e.target.value)} />
      <button type="submit" disabled={disabled || !name.trim() || (!matching && presets.length >= 30)}>{matching ? "Update" : basicName ? "Save copy" : "Save"}</button>
    </form>
    <small className="preset-note">{dirty ? "Current settings differ from the preset." : "Saved in this browser."}{presets.length >= 30 ? " Limit: 30 presets." : ""}</small>
    {error && <p className="preset-note" role="status">{error}</p>}
    {pending && createPortal(<div className="preset-dialog-backdrop">
      <div ref={dialog} className="preset-dialog" role="alertdialog" aria-modal="true" aria-label={`${kind} preset decision`} aria-describedby={`preset-${key}-decision`}>
        <h2>{pending.kind === "switch" ? "Keep your current setup?" : "This preset already exists"}</h2>
        <p id={`preset-${key}-decision`}>{pending.kind === "switch" ? `Loading “${pending.target.name}” will replace your current settings. Overwrite loads it; Duplicate saves your current setup first.` : `Overwrite updates “${pending.target.name}”. Duplicate saves a new preset instead.`}</p>
        <label>Copy name<input aria-label={`${kind} copy preset name`} maxLength={40} value={copyName} onChange={(e) => setCopyName(e.target.value)} /></label>
        <div className="preset-decision-actions">
          <button onClick={() => setPending(null)}>Cancel</button>
          <button disabled={presets.length >= 30 || !copyName.trim() || all.some((p) => p.name.toLowerCase() === copyName.trim().toLowerCase())} onClick={() => {
            const copy = { id: crypto.randomUUID(), name: copyName.trim(), value: pending.current };
            if (pending.kind === "switch") { store([...presets, copy]); load(pending.target); }
            else save(copy);
            setPending(null);
          }}>Duplicate</button>
          <button className="preset-overwrite" onClick={() => {
            if (pending.kind === "switch") load(pending.target);
            else save({ ...pending.target, value: pending.current });
            setPending(null);
          }}>Overwrite</button>
        </div>
      </div>
    </div>, document.querySelector(".app")!) }
  </details>;
}
