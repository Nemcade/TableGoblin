import { NumericValue } from "./NumericValue";
import { useEffect, useRef, useState } from "react";
import {
  fullCrop,
  imagePlacement,
  isShape,
  shapeOf,
  type Crop,
  type ImageView,
  type Surface,
} from "./model";
import { drawContent, handles, surfacePath } from "./render";
import { type TableEngine } from "./engine";

type Drag = {
  kind: "pan" | "move" | "resize" | "new";
  start: { x: number; y: number };
  crop: Crop;
  view: ImageView;
  handle: number;
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export function MediaEditor({
  object,
  engine,
  onClose,
}: {
  object: Surface;
  engine: TableEngine;
  onClose: () => void;
}) {
  const token = isShape(object) && !!object.image;
  const [crop, setCrop] = useState<Crop>({ ...(object.crop ?? fullCrop) });
  const [view, setView] = useState<ImageView>({
    ...(object.imageView ?? { x: 0, y: 0, zoom: 1 }),
  });
  const canvas = useRef<HTMLCanvasElement>(null),
    panel = useRef<HTMLElement>(null),
    drag = useRef<Drag | null>(null);
  const draft = useRef({ crop, view });
  draft.current = { crop, view };
  const bounds = useRef({ x: 0, y: 0, width: 1, height: 1 });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", key);
    const wheel = (e: WheelEvent) => {
      if (!token) return;
      e.preventDefault();
      const v = draft.current.view;
      const zoom = clamp(v.zoom * Math.exp(-e.deltaY * 0.002), 1, 6);
      setView(
        imagePlacement(
          object.width,
          object.height,
          object.sourceWidth ?? object.width,
          object.sourceHeight ?? object.height,
          { ...v, zoom },
        ).view,
      );
    };
    canvas.current!.addEventListener("wheel", wheel, { passive: false });
    let frame = 0;
    const render = () => {
      const c = canvas.current!;
      const ctx = c.getContext("2d")!;
      const dpr = Math.min(devicePixelRatio, 2),
        w = c.clientWidth,
        h = c.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#19231d";
      ctx.fillRect(0, 0, w, h);
      const source = engine.getSource(object),
        sw = object.sourceWidth ?? object.width,
        sh = object.sourceHeight ?? object.height;
      const ratio = token ? object.width / object.height : sw / sh;
      const width = Math.min(w - 72, (h - 48) * ratio),
        height = width / ratio;
      const rect = { x: (w - width) / 2, y: (h - height) / 2, width, height };
      bounds.current = rect;
      ctx.save();
      ctx.translate(rect.x + width / 2, rect.y + height / 2);
      if (token) {
        const path = surfacePath(shapeOf(object), width, height);
        ctx.fillStyle = object.color;
        ctx.fill(path);
        if (source) {
          ctx.save();
          ctx.clip(path);
          drawContent(
            ctx,
            { ...object, imageView: draft.current.view },
            source,
            width,
            height,
          );
          ctx.strokeStyle = object.color;
          ctx.lineWidth = Math.min(width, height) * 0.08;
          ctx.stroke(path);
          ctx.restore();
        }
      } else {
        if (source)
          drawContent(
            ctx,
            { ...object, crop: fullCrop },
            source,
            width,
            height,
          );
        else {
          ctx.fillStyle = "#85947a";
          ctx.textAlign = "center";
          ctx.font = "13px Segoe UI";
          ctx.fillText(engine.getMediaIssue(object) ?? "Source is no longer playing", 0, 0);
        }
      }
      ctx.restore();
      if (!token) {
        const r = draft.current.crop,
          x = rect.x + r.x * width,
          y = rect.y + r.y * height,
          cw = r.width * width,
          ch = r.height * height;
        ctx.fillStyle = "rgba(9,16,11,.68)";
        ctx.fillRect(rect.x, rect.y, width, r.y * height);
        ctx.fillRect(rect.x, y + ch, width, (1 - r.y - r.height) * height);
        ctx.fillRect(rect.x, y, r.x * width, ch);
        ctx.fillRect(x + cw, y, (1 - r.x - r.width) * width, ch);
        ctx.strokeStyle = "#d4e5bc";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, cw, ch);
        ctx.setLineDash([3, 5]);
        ctx.globalAlpha = 0.35;
        for (let i = 1; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(x + (cw * i) / 3, y);
          ctx.lineTo(x + (cw * i) / 3, y + ch);
          ctx.moveTo(x, y + (ch * i) / 3);
          ctx.lineTo(x + cw, y + (ch * i) / 3);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        handles.forEach((p) => {
          ctx.fillStyle = "#d4e5bc";
          ctx.fillRect(
            x + (p.x + 0.5) * cw - 4,
            y + (p.y + 0.5) * ch - 4,
            8,
            8,
          );
        });
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", key);
      canvas.current?.removeEventListener("wheel", wheel);
      previous?.focus();
    };
  }, [engine, object, onClose, token]);
  const point = (e: { clientX: number; clientY: number }) => {
    const rect = canvas.current!.getBoundingClientRect(),
      b = bounds.current;
    return {
      x: (e.clientX - rect.left - b.x) / b.width,
      y: (e.clientY - rect.top - b.y) / b.height,
    };
  };
  const changeView = (next: ImageView) => {
    const sourceRatio =
      (object.sourceWidth ?? object.width) /
      (object.sourceHeight ?? object.height);
    setView(
      imagePlacement(object.width, object.height, sourceRatio, 1, next).view,
    );
  };
  const pointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const p = point(e);
    if (p.x < 0 || p.y < 0 || p.x > 1 || p.y > 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    let kind: Drag["kind"] = "pan",
      handle = -1;
    if (!token) {
      const b = bounds.current;
      handle = handles.findIndex(
        (h) =>
          Math.hypot(
            (p.x - crop.x - (h.x + 0.5) * crop.width) * b.width,
            (p.y - crop.y - (h.y + 0.5) * crop.height) * b.height,
          ) < 12,
      );
      kind =
        e.shiftKey || (handle < 0 && crop.width > 0.999 && crop.height > 0.999)
          ? "new"
          : handle >= 0
            ? "resize"
            : p.x >= crop.x &&
                p.x <= crop.x + crop.width &&
                p.y >= crop.y &&
                p.y <= crop.y + crop.height
              ? "move"
              : "new";
    }
    drag.current = {
      kind,
      start: p,
      crop: { ...crop },
      view: { ...view },
      handle,
    };
  };
  const pointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = drag.current;
    if (!g) return;
    const p = point(e),
      dx = p.x - g.start.x,
      dy = p.y - g.start.y;
    if (g.kind === "pan") {
      changeView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy });
      return;
    }
    if (g.kind === "move") {
      setCrop({
        ...g.crop,
        x: clamp(g.crop.x + dx, 0, 1 - g.crop.width),
        y: clamp(g.crop.y + dy, 0, 1 - g.crop.height),
      });
      return;
    }
    let left = g.crop.x,
      top = g.crop.y,
      right = left + g.crop.width,
      bottom = top + g.crop.height;
    if (g.kind === "new") {
      left = Math.min(g.start.x, clamp(p.x, 0, 1));
      right = Math.max(g.start.x, clamp(p.x, 0, 1));
      top = Math.min(g.start.y, clamp(p.y, 0, 1));
      bottom = Math.max(g.start.y, clamp(p.y, 0, 1));
      if (right - left < 0.02 || bottom - top < 0.02) return;
    } else {
      const h = handles[g.handle];
      if (h.x < 0) left = clamp(g.crop.x + dx, 0, right - 0.02);
      if (h.x > 0) right = clamp(g.crop.x + g.crop.width + dx, left + 0.02, 1);
      if (h.y < 0) top = clamp(g.crop.y + dy, 0, bottom - 0.02);
      if (h.y > 0) bottom = clamp(g.crop.y + g.crop.height + dy, top + 0.02, 1);
    }
    setCrop({ x: left, y: top, width: right - left, height: bottom - top });
  };
  const margin = (side: string, value: number) => {
    const n = clamp(value / 100, 0, 0.98);
    const r = { ...crop };
    if (side === "Left") {
      const right = r.x + r.width;
      r.x = Math.min(n, right - 0.02);
      r.width = right - r.x;
    }
    if (side === "Right") r.width = Math.max(0.02, 1 - r.x - n);
    if (side === "Top") {
      const bottom = r.y + r.height;
      r.y = Math.min(n, bottom - 0.02);
      r.height = bottom - r.y;
    }
    if (side === "Bottom") r.height = Math.max(0.02, 1 - r.y - n);
    setCrop(r);
  };
  return (
    <div className="help-backdrop media-backdrop" onClick={onClose}>
      <section
        className="media-panel"
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="media-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          const controls = Array.from(
            e.currentTarget.querySelectorAll<HTMLElement>("button,input"),
          );
          if (e.shiftKey && document.activeElement === controls[0]) {
            e.preventDefault();
            controls.at(-1)?.focus();
          } else if (
            !e.shiftKey &&
            document.activeElement === controls.at(-1)
          ) {
            e.preventDefault();
            controls[0]?.focus();
          }
        }}
      >
        <div className="media-editor-head">
          <div>
            <span className="eyebrow">
              {token ? "A LITTLE CHARACTER" : "JUST THE PART YOU NEED"}
            </span>
            <h2 id="media-title">{token ? "Token artwork" : "Crop source"}</h2>
            <p>
              {token
                ? "Drag the art inside its shape. Scroll or use the slider to zoom."
                : "Drag the edges or box. Shift + drag to choose a new crop."}
            </p>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close media editor"
          >
            ×
          </button>
        </div>
        <canvas
          className="media-preview"
          ref={canvas}
          aria-label={token ? "Token artwork preview" : "Source crop preview"}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        />
        <div className="media-settings">
          {token ? (
            <label className="art-zoom">
              Art zoom{" "}
              <input
                type="range"
                min="1"
                max="6"
                step=".01"
                value={view.zoom}
                onChange={(e) =>
                  changeView({ ...view, zoom: Number(e.target.value) })
                }
              />
              <NumericValue
                label="Art zoom"
                value={view.zoom * 100}
                min={100}
                max={600}
                suffix="%"
                onChange={(n) => changeView({ ...view, zoom: n / 100 })}
              />
            </label>
          ) : (
            <div className="crop-margins">
              {[
                ["Left", crop.x],
                ["Top", crop.y],
                ["Right", 1 - crop.x - crop.width],
                ["Bottom", 1 - crop.y - crop.height],
              ].map(([side, value]) => (
                <label key={String(side)}>
                  {side}
                  <span>
                    <input
                      aria-label={`${side} crop percent`}
                      type="number"
                      min="0"
                      max="98"
                      step=".5"
                      value={Math.round(Number(value) * 1000) / 10}
                      onChange={(e) =>
                        margin(String(side), Number(e.target.value))
                      }
                    />
                    %
                  </span>
                </label>
              ))}
            </div>
          )}
          <button
            className="editor-reset"
            onClick={() => {
              setCrop({ ...fullCrop });
              setView({ x: 0, y: 0, zoom: 1 });
            }}
          >
            {token ? "Center art" : "Full source"}
          </button>
        </div>
        <div className="media-editor-foot">
          <span>
            {token
              ? "The art stays inside the token during normal play."
              : "Cropping keeps your annotations registered to the source."}
          </span>
          {token && (
            <button
              className="editor-reset"
              onClick={() => {
                engine.removeArt(object.id);
                onClose();
              }}
            >
              Remove art
            </button>
          )}
          <button className="editor-reset" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            onClick={() => {
              if (token) engine.saveImageView(object.id, view);
              else engine.saveCrop(object.id, crop);
              onClose();
            }}
          >
            Apply {token ? "framing" : "crop"}
          </button>
        </div>
      </section>
    </div>
  );
}
