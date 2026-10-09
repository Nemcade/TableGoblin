import { useEffect, useRef, useState } from "react";
import { normalizeHex } from "./colors";
export function ColorControl({
  label,
  value,
  onChange,
  onReset,
  resetLabel = "Reset color",
  automatic = false,
}: {
  label: string;
  value: string;
  onChange: (color: string, preview?: boolean) => void;
  onReset?: () => void;
  resetLabel?: string;
  automatic?: boolean;
}) {
  const [draft, setDraft] = useState(value),
    focused = useRef(false),
    cancelled = useRef(false);
  const picker = useRef<HTMLInputElement>(null), initial = useRef(value);
  const callbacks = useRef({ onChange });
  callbacks.current = { onChange };
  const picking = useRef(false);
  useEffect(() => {
    const input = picker.current!;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: string | null = null;
    const preview = () => {
      timer = undefined;
      if (pending === null) return;
      const color = pending; pending = null;
      setDraft(color);
      callbacks.current.onChange(color, true);
    };
    const finish = (unmount = false) => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined; pending = null;
      if (!picking.current) return;
      picking.current = false;
      if (!unmount) setDraft(input.value);
      callbacks.current.onChange(input.value, false);
    };
    const inputColor = () => {
      picking.current = true;
      pending = input.value;
      // Coalesce native ramp events without writing a controlled value back
      // into the open picker or saving the entire table for each input event.
      if (timer === undefined) timer = setTimeout(preview, 32);
    };
    const changeColor = () => { picking.current = true; finish(); };
    const blur = () => finish();
    input.addEventListener("input", inputColor);
    input.addEventListener("change", changeColor);
    input.addEventListener("blur", blur);
    return () => {
      input.removeEventListener("input", inputColor);
      input.removeEventListener("change", changeColor);
      input.removeEventListener("blur", blur);
      finish(true);
    };
  }, []);
  useEffect(() => {
    if (!picking.current) {
      if (picker.current) picker.current.value = value;
      if (!focused.current) setDraft(value);
    }
  }, [value]);
  const commit = () => {
    focused.current = false;
    const hex = normalizeHex(draft);
    if (!cancelled.current && hex && hex !== value.toLowerCase()) onChange(hex);
    else setDraft(value);
  };
  return (
    <div className="color-control">
      <span>{label}</span>
      <input
        type="color"
        ref={picker}
        aria-label={label}
        defaultValue={initial.current}
      />
      <input
        className="color-hex"
        type="text"
        spellCheck={false}
        aria-label={`${label} hex`}
        maxLength={7}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => {
          focused.current = true;
          cancelled.current = false;
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
      />
      {onReset && (
        <button
          type="button"
          aria-label={resetLabel}
          title={resetLabel}
          disabled={automatic}
          onClick={onReset}
        >
          ↺
        </button>
      )}
    </div>
  );
}
