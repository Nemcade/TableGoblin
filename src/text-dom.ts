import { baseMarks, markKeys, spansFromRuns, textRuns, type TextMarks, type TextSettings, type TextRun } from "./text";

export type TextRange = { start: number; end: number };
export function editableRange(el: HTMLElement): TextRange | null {
  const selection = getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
  const before = range.cloneRange(); before.selectNodeContents(el); before.setEnd(range.startContainer, range.startOffset);
  return { start: before.toString().length, end: before.toString().length + range.toString().length };
}
export function selectEditable(el: HTMLElement, range: TextRange, focus = true) {
  if (focus) el.focus({ preventScroll: true });
  const point = (offset: number): [Node, number] => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node: Node | null;
    while ((node = walker.nextNode())) { const length = node.textContent?.length ?? 0; if (offset <= length) return [node, offset]; offset -= length; }
    return [el, el.childNodes.length];
  };
  const a = point(range.start), b = point(range.end), domRange = document.createRange();
  domRange.setStart(...a); domRange.setEnd(...b); getSelection()?.removeAllRanges(); getSelection()?.addRange(domRange);
}
export function writeEditable(el: HTMLElement, t: TextSettings) {
  const children = textRuns(t).map(run => {
    const span = document.createElement("span"); span.textContent = run.content;
    markKeys.forEach(key => span.dataset[key] = String(run.style[key]));
    span.style.fontWeight = run.style.bold ? "700" : "400"; span.style.fontStyle = run.style.italic ? "italic" : "normal";
    span.style.textDecoration = [run.style.underline ? "underline" : "", run.style.strike ? "line-through" : ""].filter(Boolean).join(" ") || "none";
    return span;
  });
  el.replaceChildren(...children);
  // Chromium needs a trailing caret line after a final newline. It is not text data.
  if (t.content.endsWith("\n")) { const tail = document.createElement("br"); tail.dataset.textTail = "true"; el.append(tail); }
}
/** Read text and four allowed marks; pasted HTML never enters the editor. */
export function readEditable(el: HTMLElement, t: TextSettings): TextSettings {
  let content = ""; const runs: Pick<TextRun, "start" | "end" | "style">[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node: Node | null;
  while ((node = walker.nextNode())) {
    const value = (node.textContent ?? "").slice(0, Math.max(0, 20000 - content.length));
    const style: TextMarks = baseMarks(t);
    const parents: HTMLElement[] = []; let parent = node.parentElement;
    while (parent && parent !== el) { parents.unshift(parent); parent = parent.parentElement; }
    for (const ancestor of parents) for (const key of markKeys) if (ancestor.dataset[key] !== undefined) style[key] = ancestor.dataset[key] === "true";
    runs.push({ start: content.length, end: content.length + value.length, style }); content += value;
  }
  return { ...t, content, spans: spansFromRuns(runs, baseMarks(t)) };
}
