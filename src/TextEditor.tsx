import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TableEngine } from "./engine";
import { worldTransform, type Surface } from "./model";
import { applyTextMark, baseMarks, defaultText, layoutText, markKeys, replaceText, textColor, textFont, textFonts, textMode, textRuns, type Mark, type TextMarks, type TextSettings } from "./text";
import { editableRange, readEditable, selectEditable, writeEditable, type TextRange } from "./text-dom";
import { FontPicker, TextExtras, TextModeControl } from "./TextControls";
import { NumericValue } from "./NumericValue";
import { readableColor } from "./colors";

export function TextEditor({ object, engine, onClose }: { object: Surface; engine: TableEngine; onClose: () => void }) {
  const [text, setText] = useState<TextSettings>(() => structuredClone(object.text ?? defaultText));
  const [more, setMore] = useState(false), [revision, setRevision] = useState(0), [active, setActive] = useState<TextMarks>(baseMarks(text));
  const input = useRef<HTMLDivElement>(null), bar = useRef<HTMLDivElement>(null);
  const range = useRef<TextRange>({ start: text.content.length, end: text.content.length });
  const current = useRef(text), pending = useRef<TextMarks | null>(null), composing = useRef(false), finished = useRef(false);
  const history = useRef<TextSettings[]>([]), future = useRef<TextSettings[]>([]);
  const colorBefore = useRef<TextSettings | null>(null);
  const t = worldTransform(engine.scene, object), camera = engine.camera;
  const center = { x: t.x * camera.zoom + camera.x, y: t.y * camera.zoom + camera.y };
  const box = { left: center.x - t.width * camera.zoom / 2, top: center.y - t.height * camera.zoom / 2 };
  const color = textColor({ ...object, text }, engine.scene, engine.mood);
  const marksAt = (position: number) => textRuns(current.current).find(run => run.start <= position && run.end > position)?.style ?? baseMarks(current.current);
  const remember = () => {
    const next = input.current && editableRange(input.current);
    if (!next) return;
    range.current = next;
    setActive(pending.current ?? marksAt(next.start === next.end ? Math.max(0, next.start - 1) : next.start));
  };
  const update = (next: TextSettings, record = true) => {
    if (record && JSON.stringify(next) !== JSON.stringify(current.current)) { history.current.push(structuredClone(current.current)); if (history.current.length > 100) history.current.shift(); future.current = []; }
    current.current = next; setText(next); setRevision(r => r + 1);
    const width = next.mode === "paragraph" && textMode(object.text!) === "label" ? Math.max(300, object.width) : object.width;
    engine.saveText(object.id, next, width);
  };
  const patch = (value: Partial<TextSettings>) => update({ ...current.current, ...value });
  const changeColor = (color: string | null, preview = false) => {
    if (preview && !colorBefore.current) colorBefore.current = structuredClone(current.current);
    if (!preview) {
      const before = colorBefore.current ?? current.current;
      if (before.color !== color) {
        history.current.push(structuredClone(before));
        if (history.current.length > 100) history.current.shift();
        future.current = [];
      }
      colorBefore.current = null;
    }
    const next = { ...current.current, color };
    current.current = next; setText(next);
    engine.setTextColor(object.id, color, preview);
  };
  const finish = (focus = false) => {
    if (finished.current) return;
    finished.current = true;
    // The scene already contains the current text, including a composing input.
    if (input.current && composing.current) engine.saveText(object.id, readEditable(input.current, current.current), object.width);
    onClose(); if (focus) engine.canvas.focus();
  };
  const insert = (value: string) => {
    remember(); const selected = range.current;
    const next = replaceText(current.current, selected.start, selected.end, value.replace(/\r\n?/g, "\n"), pending.current ?? marksAt(Math.max(0, selected.start - 1)));
    const inserted = next.content.length - current.current.content.length + selected.end - selected.start;
    range.current = { start: selected.start + inserted, end: selected.start + inserted }; update(next);
  };
  const format = (mark: Mark) => {
    remember(); const selected = range.current;
    const runs = textRuns(current.current).filter(run => run.end > selected.start && run.start < selected.end);
    const value = selected.start !== selected.end ? !runs.every(run => run.style[mark]) : !(pending.current ?? active)[mark];
    if (selected.start !== selected.end) { pending.current = null; update(applyTextMark(current.current, selected.start, selected.end, mark, value)); }
    else { pending.current = { ...(pending.current ?? marksAt(Math.max(0, selected.start - 1))), [mark]: value }; setActive(pending.current); }
    input.current?.focus({ preventScroll: true });
  };
  const undo = (redo = false) => {
    const from = redo ? future.current : history.current, to = redo ? history.current : future.current, next = from.pop();
    if (next) { to.push(structuredClone(current.current)); range.current = { start: Math.min(range.current.start, next.content.length), end: Math.min(range.current.end, next.content.length) }; update(next, false); }
  };
  useLayoutEffect(() => {
    const el = input.current!; if (composing.current) return;
    const focused = document.activeElement === el;
    writeEditable(el, text);
    if (focused) selectEditable(el, range.current, false);
  }, [text, revision]);
  useEffect(() => {
    const el = input.current!;
    selectEditable(el, range.current);
    const selection = () => remember();
    const outside = (e: PointerEvent) => { if (!el.contains(e.target as Node) && !bar.current?.contains(e.target as Node)) finish(); };
    const beforeInput = (e: InputEvent) => {
      if (e.inputType === "insertParagraph" || e.inputType === "insertLineBreak") {
        e.preventDefault(); if (textMode(current.current) === "label" && e.inputType === "insertParagraph") finish(true); else insert("\n");
      } else if (!e.isComposing && e.inputType === "insertText" && e.data !== null) { e.preventDefault(); insert(e.data); }
      else if (!e.isComposing && e.inputType.startsWith("delete")) {
        e.preventDefault(); remember();
        const selected = range.current, content = current.current.content;
        if (selected.start === selected.end) {
          const backward = e.inputType.includes("Backward"), word = e.inputType.includes("Word"), line = e.inputType.includes("Line");
          if (backward) {
            const prefix = content.slice(0, selected.start);
            const length = word ? (prefix.match(/\S+\s*$/u)?.[0].length ?? 1) : line ? prefix.length - prefix.lastIndexOf("\n") - 1 : ([...prefix].at(-1)?.length ?? 0);
            range.current = { start: Math.max(0, selected.start - length), end: selected.end };
          } else {
            const suffix = content.slice(selected.end);
            const length = word ? (suffix.match(/^\s*\S+/u)?.[0].length ?? 1) : line ? (suffix.indexOf("\n") < 0 ? suffix.length : suffix.indexOf("\n")) : ([...suffix][0]?.length ?? 0);
            range.current = { start: selected.start, end: Math.min(content.length, selected.end + length) };
          }
        }
        const target = range.current;
        const next = replaceText(current.current, target.start, target.end, "", pending.current ?? marksAt(Math.max(0, target.start - 1)));
        range.current = { start: target.start, end: target.start }; update(next);
      }
      else if (e.inputType === "historyUndo" || e.inputType === "historyRedo") { e.preventDefault(); undo(e.inputType === "historyRedo"); }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" || (e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); finish(true); }
    };
    el.addEventListener("beforeinput", beforeInput);
    document.addEventListener("selectionchange", selection); document.addEventListener("pointerdown", outside, true); window.addEventListener("keydown", key);
    return () => { el.removeEventListener("beforeinput", beforeInput); document.removeEventListener("selectionchange", selection); document.removeEventListener("pointerdown", outside, true); window.removeEventListener("keydown", key); };
  }, [engine, object.id, onClose]);
  useLayoutEffect(() => {
    const el = bar.current!;
    const place = () => {
      const rect = input.current!.getBoundingClientRect();
      el.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - el.offsetWidth - 8))}px`;
      const above = rect.top - el.offsetHeight - 12;
      el.style.top = `${Math.max(8, Math.min(above >= 72 ? above : rect.bottom + 12, innerHeight - el.offsetHeight - 8))}px`;
    };
    place(); const observer = new ResizeObserver(place); observer.observe(el); window.addEventListener("resize", place);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); };
  }, [center.x, center.y, t.width, t.height, camera.zoom, more]);
  const ctx = engine.canvas.getContext("2d")!;
  const lines = layoutText(text, Math.max(1, object.width - 16), (value, marks) => { ctx.font = textFont(text, marks); return ctx.measureText(value).width; });
  const indent = Math.max(0, ...lines.map(line => line.indent));
  return <>
    <div className="inline-text-frame" style={{ left: center.x, top: center.y, width: object.width, minHeight: object.height, transform: `translate(-50%, -50%) rotate(${t.rotation}rad) scale(${camera.zoom})` }}>
      {text.list !== "none" && <div className="inline-text-markers" aria-hidden="true" style={{ font: textFont(text), color }}>{lines.map((line, i) => line.marker && <span key={i} style={{ top: 8 + i * text.size * text.lineHeight, lineHeight: text.lineHeight }}>{line.marker}</span>)}</div>}
      <div ref={input} className="inline-text-input" role="textbox" aria-label="Text content" aria-multiline={textMode(text) === "paragraph"} contentEditable suppressContentEditableWarning spellCheck
        data-placeholder="Type here" style={{ fontFamily: textFonts[text.font].family, fontSize: text.size, lineHeight: text.lineHeight, textAlign: text.align,
          color, minHeight: object.height, paddingLeft: 8 + indent, whiteSpace: textMode(text) === "label" ? "pre" : "pre-wrap", overflowWrap: textMode(text) === "label" ? "normal" : "anywhere",
          textShadow: text.glow ? `0 0 2px ${readableColor(color, "#ffffff")}` : "none" }}
        onInput={() => { remember(); update(readEditable(input.current!, current.current)); }}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; remember(); update(readEditable(input.current!, current.current)); }}
        onPaste={e => { e.preventDefault(); insert(e.clipboardData.getData("text/plain")); }}
        onCut={e => {
          remember(); const selected = range.current;
          if (selected.start === selected.end) return;
          e.preventDefault(); e.clipboardData.setData("text/plain", current.current.content.slice(selected.start, selected.end)); insert("");
        }}
        onDrop={e => { e.preventDefault(); const value = e.dataTransfer.getData("text/plain"); if (value) insert(value); }}
        onPointerDown={() => { pending.current = null; }}
        onKeyDown={e => {
          if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) pending.current = null;
          if ((e.ctrlKey || e.metaKey) && ["b", "i", "u"].includes(e.key.toLowerCase())) { e.preventDefault(); format(({ b: "bold", i: "italic", u: "underline" } as const)[e.key.toLowerCase() as "b" | "i" | "u"]); }
          if ((e.ctrlKey || e.metaKey) && ["z", "y"].includes(e.key.toLowerCase())) { e.preventDefault(); undo(e.shiftKey || e.key.toLowerCase() === "y"); }
          if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); if (textMode(current.current) === "label" && !e.shiftKey && !e.ctrlKey && !e.metaKey) finish(true); else if (!e.ctrlKey && !e.metaKey) insert("\n"); }
        }} />
    </div>
    <div ref={bar} className="inline-text-tools" role="toolbar" aria-label="Text tools" style={{ left: Math.max(8, box.left), top: Math.max(8, box.top - 50) }}
      onPointerDown={e => { if (!(e.target instanceof Element) || !e.target.closest("input")) e.preventDefault(); }}>
      <div className="inline-text-bar">
        <TextModeControl text={text} onChange={patch} />
        <FontPicker font={text.font} onChange={font => patch({ font })} />
        <NumericValue value={text.size} label="Font size" min={8} max={200} digits={0} onChange={size => patch({ size })} />
        {markKeys.slice(0, 3).map(mark => <button type="button" key={mark} aria-label={mark[0].toUpperCase() + mark.slice(1)} title={mark[0].toUpperCase() + mark.slice(1)} aria-pressed={active[mark]} onClick={() => format(mark)}>{mark === "bold" ? <b>B</b> : mark === "italic" ? <i>I</i> : <u>U</u>}</button>)}
        <button type="button" aria-label="More text settings" aria-expanded={more} title="More text settings" onClick={() => setMore(!more)}>···</button>
        <button type="button" aria-label="Finish text editing" title="Finish · changes save automatically" onClick={() => finish(true)}>✓</button>
      </div>
      {more && <div className="inline-text-more"><button type="button" aria-label="Strikethrough" aria-pressed={active.strike} onClick={() => format("strike")}><s>Strikethrough</s></button><TextExtras text={text} color={color} onChange={patch} onColorChange={changeColor} /></div>}
    </div>
  </>;
}
