import { readableColor } from "./colors.ts";
import { themePalette, type Mood } from "./mood.ts";
import { isShape, type Scene, type Surface } from "./model.ts";

export const textFonts = {
  roboto: { name: "Roboto", family: '"Roboto", "Segoe UI", sans-serif' },
  crimson: { name: "Crimson Pro", family: '"Crimson Pro", Georgia, serif' },
  cormorant: { name: "Cormorant Garamond", family: '"Cormorant Garamond", Georgia, serif' },
  imfell: { name: "IM Fell English", family: '"IM Fell English", Georgia, serif' },
  meddon: { name: "Meddon", family: '"Meddon", cursive' },
  nightshade: { name: "Jim Nightshade", family: '"Jim Nightshade", cursive' },
  elite: { name: "Special Elite", family: '"Special Elite", Consolas, monospace' },
  quicksand: { name: "Quicksand", family: '"Quicksand", sans-serif' },
  bebas: { name: "Bebas Neue", family: '"Bebas Neue", sans-serif' },
  nunito: { name: "Nunito", family: '"Nunito", sans-serif' },
  // Keep identifiers from older saves and their original appearance.
  sans: { name: "Segoe UI", family: '"Segoe UI", Arial, sans-serif' },
  serif: { name: "Georgia", family: 'Georgia, "Times New Roman", serif' },
  classic: { name: "Palatino", family: '"Palatino Linotype", "Book Antiqua", Palatino, serif' },
  mono: { name: "Consolas", family: 'Consolas, "Courier New", monospace' },
  rounded: { name: "Trebuchet", family: '"Trebuchet MS", Arial, sans-serif' },
  handwritten: { name: "Segoe Print", family: '"Segoe Print", "Comic Sans MS", cursive' },
} as const;
export const markKeys = ["bold", "italic", "underline", "strike"] as const;
export type Mark = typeof markKeys[number];
export type TextMarks = Record<Mark, boolean>;
export type TextSpan = { start: number; end: number; style: Partial<TextMarks> };
export type TextSettings = TextMarks & {
  content: string; font: keyof typeof textFonts; size: number;
  align: "left" | "center" | "right"; list: "none" | "bullet" | "number";
  lineHeight: number; color: string | null;
  mode?: "label" | "paragraph"; glow?: boolean; spans?: TextSpan[];
};
export const defaultText: TextSettings = { content: "", font: "crimson", size: 28,
  bold: false, italic: false, underline: false, strike: false, align: "left", list: "none", lineHeight: 1.35, color: null, mode: "label", glow: false, spans: [] };
export const textMode = (t: TextSettings) => t.mode ?? "paragraph";
export const baseMarks = (t: TextSettings): TextMarks => ({ bold: t.bold, italic: t.italic, underline: t.underline, strike: t.strike });
export const sameMarks = (a: TextMarks, b: TextMarks) => markKeys.every(k => a[k] === b[k]);
export function validText(v: unknown): v is TextSettings {
  if (!v || typeof v !== "object") return false;
  const t = v as TextSettings;
  if (!(typeof t.content === "string" && t.content.length <= 20000 && Object.hasOwn(textFonts, t.font) &&
    Number.isFinite(t.size) && t.size >= 8 && t.size <= 200 && Number.isFinite(t.lineHeight) && t.lineHeight >= 1 && t.lineHeight <= 2.5 &&
    markKeys.every(k => typeof t[k] === "boolean") && ["left", "center", "right"].includes(t.align) && ["none", "bullet", "number"].includes(t.list) &&
    (t.color === null || typeof t.color === "string" && /^#[0-9a-f]{6}$/i.test(t.color)) &&
    (t.mode === undefined || ["label", "paragraph"].includes(t.mode)) && (t.glow === undefined || typeof t.glow === "boolean"))) return false;
  if (t.spans === undefined) return true;
  if (!Array.isArray(t.spans) || t.spans.length > 20000) return false;
  let previous = 0;
  return t.spans.every(s => {
    if (!s || !Number.isInteger(s.start) || !Number.isInteger(s.end) || s.start < previous || s.end <= s.start || s.end > t.content.length ||
      !s.style || typeof s.style !== "object" || Array.isArray(s.style) || Object.entries(s.style).some(([key, value]) => !markKeys.includes(key as Mark) || typeof value !== "boolean")) return false;
    previous = s.end; return true;
  });
}
export function textFont(t: TextSettings, marks: TextMarks = baseMarks(t)) {
  return `${marks.italic ? "italic " : ""}${marks.bold ? "700" : "400"} ${t.size}px ${textFonts[t.font].family}`;
}
export type TextRun = { start: number; end: number; content: string; style: TextMarks };
export function textRuns(t: TextSettings): TextRun[] {
  const runs: TextRun[] = [], base = baseMarks(t); let start = 0;
  for (const span of t.spans ?? []) {
    if (span.start > start) runs.push({ start, end: span.start, content: t.content.slice(start, span.start), style: base });
    runs.push({ start: span.start, end: span.end, content: t.content.slice(span.start, span.end), style: { ...base, ...span.style } }); start = span.end;
  }
  if (start < t.content.length) runs.push({ start, end: t.content.length, content: t.content.slice(start), style: base });
  return runs;
}
export function spansFromRuns(runs: Pick<TextRun, "start" | "end" | "style">[], base: TextMarks): TextSpan[] {
  const spans: TextSpan[] = [];
  for (const run of runs) {
    if (run.end <= run.start || sameMarks(run.style, base)) continue;
    const previous = spans.at(-1);
    if (previous?.end === run.start && sameMarks(previous.style as TextMarks, run.style)) previous.end = run.end;
    else spans.push({ start: run.start, end: run.end, style: { ...run.style } });
  }
  return spans;
}
export function applyTextMark(t: TextSettings, start: number, end: number, mark: Mark, value: boolean): TextSettings {
  start = Math.max(0, Math.min(t.content.length, start)); end = Math.max(start, Math.min(t.content.length, end));
  if (start === end) return t;
  const runs: TextRun[] = [];
  for (const run of textRuns(t)) {
    const cuts = [...new Set([run.start, run.end, Math.max(run.start, Math.min(run.end, start)), Math.max(run.start, Math.min(run.end, end))])].sort((a, b) => a - b);
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i], b = cuts[i + 1];
      runs.push({ start: a, end: b, content: t.content.slice(a, b), style: a >= start && b <= end ? { ...run.style, [mark]: value } : run.style });
    }
  }
  return { ...t, spans: spansFromRuns(runs, baseMarks(t)) };
}
export function replaceText(t: TextSettings, start: number, end: number, inserted: string, style: TextMarks): TextSettings {
  inserted = inserted.slice(0, Math.max(0, 20000 - t.content.length + end - start));
  const delta = inserted.length - (end - start), runs: Pick<TextRun, "start" | "end" | "style">[] = [];
  for (const run of textRuns(t)) if (run.start < start) runs.push({ start: run.start, end: Math.min(run.end, start), style: run.style });
  if (inserted.length) runs.push({ start, end: start + inserted.length, style });
  for (const run of textRuns(t)) if (run.end > end) runs.push({ start: Math.max(run.start, end) + delta, end: run.end + delta, style: run.style });
  return { ...t, content: t.content.slice(0, start) + inserted + t.content.slice(end), spans: spansFromRuns(runs, baseMarks(t)) };
}

export type TextLine = { content: string; indent: number; marker: string; runs: { content: string; style: TextMarks; width: number }[] };
export function layoutText(t: TextSettings, width: number, measure: (s: string, style: TextMarks) => number): TextLine[] {
  const lines: TextLine[] = [], base = baseMarks(t), allRuns = textRuns(t);
  let paragraphStart = 0, runIndex = 0;
  t.content.split("\n").forEach((paragraph, i) => {
    const marker = t.list === "bullet" ? "•" : t.list === "number" ? `${i + 1}.` : "";
    const indent = marker ? Math.min(width / 2, measure(marker + " ", base) + t.size * .3) : 0;
    const available = Math.max(1, width - indent);
    type Character = { content: string; style: TextMarks };
    let characters: Character[] = [], first = true;
    const group = (chars: Character[]) => {
      const runs: TextLine["runs"] = [];
      for (const char of chars) {
        const previous = runs.at(-1);
        if (previous && sameMarks(previous.style, char.style)) previous.content += char.content;
        else runs.push({ content: char.content, style: char.style, width: 0 });
      }
      for (const run of runs) run.width = measure(run.content, run.style);
      return runs;
    };
    const measured = (chars: Character[]) => group(chars).reduce((sum, run) => sum + run.width, 0);
    const push = () => {
      while (characters.at(-1)?.content.match(/\s/u)) characters.pop();
      const runs = group(characters);
      lines.push({ content: runs.map(r => r.content).join(""), indent, marker: first ? marker : "", runs }); first = false; characters = [];
    };
    let offset = paragraphStart;
    while (allRuns[runIndex] && allRuns[runIndex].end <= offset) runIndex++;
    for (const word of paragraph.match(/\S+\s*|\s+/gu) ?? []) {
      const chars: Character[] = [];
      for (const content of word) {
        while (allRuns[runIndex] && allRuns[runIndex].end <= offset) runIndex++;
        chars.push({ content, style: allRuns[runIndex]?.style ?? base }); offset += content.length;
      }
      if (textMode(t) === "label") { characters.push(...chars); continue; }
      const visible = [...chars]; while (visible.at(-1)?.content.match(/\s/u)) visible.pop();
      if (characters.length && measured([...characters, ...visible]) > available) push();
      if (measured(visible) <= available) characters.push(...chars);
      else for (const char of chars) {
        if (characters.length && measured([...characters, char]) > available) push();
        characters.push(char);
      }
    }
    push(); paragraphStart += paragraph.length + 1;
  });
  return lines;
}
export function textBox(t: TextSettings, width: number, ctx: CanvasRenderingContext2D) {
  ctx.save();
  const measure = (s: string, style: TextMarks) => { ctx.font = textFont(t, style); return ctx.measureText(s).width; };
  const lines = layoutText(t, Math.max(1, width - 16), measure);
  const naturalWidth = Math.max(0, ...lines.map(l => l.indent + l.runs.reduce((sum, r) => sum + r.width, 0))) + 16;
  ctx.restore();
  return { width: textMode(t) === "label" ? Math.max(t.content ? 32 : 160, naturalWidth) : Math.max(60, width), height: Math.max(32, lines.length * t.size * t.lineHeight + 16) };
}
export function textHeight(t: TextSettings, width: number, ctx: CanvasRenderingContext2D) { return textBox(t, width, ctx).height; }
export function textColor(obj: Surface, scene: Scene, mood: Mood): string {
  if (obj.text?.color) return obj.text.color;
  const ink = themePalette(mood).ink;
  let parent = scene.objects.find(o => o.id === obj.parentId);
  while (parent) {
    if (isShape(parent) && !parent.image) return readableColor(parent.color, ink);
    parent = scene.objects.find(o => o.id === parent!.parentId);
  }
  return ink;
}
export function paintText(ctx: CanvasRenderingContext2D, obj: Surface, scene: Scene, mood: Mood) {
  const t = obj.text ?? defaultText, color = textColor(obj, scene, mood);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = color; ctx.strokeStyle = color;
  ctx.shadowColor = t.glow ? readableColor(color, "#ffffff") : "transparent"; ctx.shadowBlur = t.glow ? 2 : 0;
  const width = Math.max(1, obj.width - 16), step = t.size * t.lineHeight;
  const lines = layoutText(t, width, (s, marks) => { ctx.font = textFont(t, marks); return ctx.measureText(s).width; });
  lines.forEach((line, i) => {
    const measured = line.runs.reduce((sum, run) => sum + run.width, 0), start = -obj.width / 2 + 8;
    let x = start + line.indent + (t.align === "center" ? (width - line.indent - measured) / 2 : t.align === "right" ? width - line.indent - measured : 0);
    ctx.font = textFont(t);
    const metrics = ctx.measureText("Mg"), ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent, descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent;
    const y = -obj.height / 2 + 8 + (step - ascent - descent) / 2 + ascent + i * step;
    if (line.marker) ctx.fillText(line.marker, start, y);
    for (const run of line.runs) {
      ctx.font = textFont(t, run.style); ctx.fillText(run.content, x, y); ctx.lineWidth = Math.max(1, t.size / 18);
      for (const offset of [run.style.underline ? t.size * .14 : null, run.style.strike ? -t.size * .3 : null]) if (offset !== null) {
        ctx.beginPath(); ctx.moveTo(x, y + offset); ctx.lineTo(x + run.width, y + offset); ctx.stroke();
      }
      x += run.width;
    }
  });
  ctx.shadowBlur = 0;
}
