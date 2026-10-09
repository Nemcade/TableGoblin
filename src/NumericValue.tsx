import { useEffect, useRef, useState } from "react";

/** A compact readout that opens an exact value editor alongside its slider. */
export function NumericValue({
  value,
  onChange,
  label,
  min,
  max,
  suffix = "",
  digits = 1,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  min: number;
  max: number;
  suffix?: string;
  digits?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  const commit = () => {
    if (!cancelled.current && draft.trim() !== "") {
      const n = Number(draft);
      if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
    }
    setEditing(false);
  };
  return (
    <span className="numeric-value">
      {editing ? (
        <>
          <input
            ref={input}
            type="number"
            step="any"
            min={min}
            max={max}
            aria-label={`${label} value`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                cancelled.current = true;
                setEditing(false);
              }
            }}
          />
          {suffix}
        </>
      ) : (
        <button
          type="button"
          aria-label={`Edit ${label.toLowerCase()}`}
          title="Click to enter a value"
          onClick={(e) => {
            e.preventDefault();
            cancelled.current = false;
            setDraft(String(Number(value.toFixed(8))));
            setEditing(true);
          }}
        >
          {Number(value.toFixed(digits))}
          {suffix}
        </button>
      )}
    </span>
  );
}
