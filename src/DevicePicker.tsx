import { useEffect, useId, useRef, useState } from "react";

/** An in-page picker avoids native device-menu compositing glitches. */
export function DevicePicker({ label, value, options, disabled, onChange }: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId(), root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const selected = Math.max(0, options.findIndex(o => o.value === value));
  useEffect(() => {
    setActive(current => Math.min(current, options.length - 1));
  }, [options.length]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (open) root.current?.querySelector(`#${CSS.escape(id)}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);
  const choose = (index: number) => {
    setOpen(false);
    root.current?.querySelector<HTMLButtonElement>('[role="combobox"]')?.focus();
    onChange(options[Math.min(index, options.length - 1)].value);
  };
  return <div ref={root} className="device-picker" onBlur={e => {
    if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
  }}>
    <button type="button" role="combobox" aria-label={label} aria-haspopup="listbox"
      aria-expanded={open} aria-controls={id} aria-activedescendant={open ? `${id}-${active}` : undefined}
      disabled={disabled} className="device-trigger"
      onClick={() => { setActive(selected); setOpen(!open); }}
      onKeyDown={e => {
        if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
        else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          setOpen(true);
          setActive(e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 :
            Math.max(0, Math.min(options.length - 1, (open ? active : selected) + (e.key === "ArrowDown" ? 1 : -1))));
        } else if ((e.key === "Enter" || e.key === " ") && open) {
          e.preventDefault(); choose(active);
        } else if (e.key === "Tab") setOpen(false);
      }}>
      <span>{options[selected]?.label}</span><span aria-hidden="true">⌄</span>
    </button>
    {open && <div id={id} role="listbox" aria-label={label} className="device-options">
      {options.map((o, i) => <div id={`${id}-${i}`} key={o.value} role="option"
        aria-selected={o.value === value} className={i === active ? "active" : ""}
        onPointerDown={e => e.preventDefault()} onPointerMove={() => setActive(i)} onClick={() => choose(i)}>
        <span>{o.label}</span>{o.value === value && <span aria-hidden="true">✓</span>}
      </div>)}
    </div>}
  </div>;
}
