import { useState } from "react";
import { ColorControl } from "./ColorControl";
import { NumericValue } from "./NumericValue";
import { textFonts, textMode, type TextSettings } from "./text";

export function FontPicker({ font, onChange }: { font: TextSettings["font"]; onChange: (font: TextSettings["font"]) => void }) {
  const [open, setOpen] = useState(false);
  return <div className="text-font-picker"><button type="button" aria-label="Choose text font" aria-expanded={open} onClick={() => setOpen(!open)}>{textFonts[font].name}<span>⌄</span></button>
    {open && <div className="text-font-list" role="group" aria-label="Text fonts">{Object.entries(textFonts).map(([id, item]) =>
      <button type="button" key={id} style={{ fontFamily: item.family }} aria-pressed={id === font} onClick={() => { onChange(id as TextSettings["font"]); setOpen(false); }}>{item.name}</button>)}</div>}
  </div>;
}
export function TextModeControl({ text, onChange }: { text: TextSettings; onChange: (patch: Partial<TextSettings>) => void }) {
  return <div className="text-mode-control" role="group" aria-label="Text mode">{(["label", "paragraph"] as const).map(mode =>
    <button type="button" key={mode} aria-label={mode === "label" ? "Label text" : "Paragraph text"} aria-pressed={textMode(text) === mode}
      title={mode === "label" ? "Label · grows with text, handles scale type" : "Paragraph · wraps to width, grows downward"} onClick={() => onChange({ mode })}>{mode === "label" ? "Aa" : "¶"}</button>)}</div>;
}
export function TextExtras({ text, color, onChange, onColorChange }: { text: TextSettings; color: string; onChange: (patch: Partial<TextSettings>) => void; onColorChange: (color: string | null, preview?: boolean) => void }) {
  return <div className="text-extras">
    <div className="text-extra-row" role="group" aria-label="Text alignment">{(["left", "center", "right"] as const).map(align =>
      <button type="button" key={align} aria-label={`Align ${align}`} aria-pressed={text.align === align} onClick={() => onChange({ align })}>{align[0].toUpperCase() + align.slice(1)}</button>)}</div>
    <div className="text-extra-row" role="group" aria-label="List style">{([ ["none", "Plain"], ["bullet", "Bullets"], ["number", "Numbered"] ] as const).map(([list, name]) =>
      <button type="button" key={list} aria-pressed={text.list === list} onClick={() => onChange({ list })}>{name}</button>)}</div>
    <label className="text-line-spacing">Line spacing <NumericValue value={text.lineHeight} label="Line spacing" min={1} max={2.5} digits={2} onChange={lineHeight => onChange({ lineHeight })} /></label>
    <ColorControl label="Text color" value={color} automatic={text.color === null} onChange={onColorChange} onReset={() => onColorChange(null)} resetLabel="Use automatic text color" />
    <button type="button" className="text-glow" aria-pressed={text.glow ?? false} onClick={() => onChange({ glow: !text.glow })}>Text glow <small>{text.glow ? "On" : "Off"}</small></button>
  </div>;
}
