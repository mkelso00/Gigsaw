"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// A box to draw a signature in with a finger, pen or mouse. The drawing is kept as strokes, so it
// survives the phone turning round, and is handed to the form as a PNG in a hidden field.

type Point = { x: number; y: number };
const INK = "#0f172a";
const EXPORT_SCALE = 2;

function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Point[][], scale: number) {
  ctx.save();
  ctx.scale(scale, scale);
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of strokes) {
    if (s.length === 1) {
      ctx.beginPath();
      ctx.arc(s[0].x, s[0].y, 1.4, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(s[0].x, s[0].y);
    // Smooth curves through the midpoints between samples.
    for (let i = 1; i < s.length - 1; i++) {
      const mx = (s[i].x + s[i + 1].x) / 2;
      const my = (s[i].y + s[i + 1].y) / 2;
      ctx.quadraticCurveTo(s[i].x, s[i].y, mx, my);
    }
    const last = s[s.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }
  ctx.restore();
}

export function SignaturePad({ name, emptyText = "Your signature is needed." }: { name: string; emptyText?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Point[][]>([]);
  const drawing = useRef<Point[] | null>(null);
  const [value, setValue] = useState("");

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = c.getBoundingClientRect();
    if (c.width !== Math.round(width * dpr) || c.height !== Math.round(height * dpr)) {
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    drawStrokes(ctx, drawing.current ? [...strokes.current, drawing.current] : strokes.current, dpr);
  }, []);

  /**
   * The finished signature as a PNG, cropped to the ink with a little margin so it fills the
   * signature line wherever it's shown, at a fixed scale so its size doesn't depend on the screen.
   */
  const exportPng = useCallback(() => {
    const all = strokes.current.flat();
    if (!all.length) return "";
    const pad = 6;
    const minX = Math.min(...all.map((p) => p.x)) - pad;
    const minY = Math.min(...all.map((p) => p.y)) - pad;
    const w = Math.max(...all.map((p) => p.x)) - minX + pad;
    const h = Math.max(...all.map((p) => p.y)) - minY + pad;
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(w * EXPORT_SCALE));
    out.height = Math.max(1, Math.round(h * EXPORT_SCALE));
    const ctx = out.getContext("2d");
    if (!ctx) return "";
    ctx.translate(-minX * EXPORT_SCALE, -minY * EXPORT_SCALE);
    drawStrokes(ctx, strokes.current, EXPORT_SCALE);
    return out.toDataURL("image/png");
  }, []);

  useEffect(() => {
    redraw();
    const c = canvasRef.current;
    if (!c) return;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(c);
    return () => ro.disconnect();
  }, [redraw]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const finish = () => {
    if (!drawing.current) return;
    strokes.current.push(drawing.current);
    drawing.current = null;
    redraw();
    setValue(exportPng());
  };

  const clear = () => {
    strokes.current = [];
    drawing.current = null;
    redraw();
    setValue("");
  };

  return (
    <div>
      <div className="relative">
        <canvas
          ref={canvasRef}
          aria-label="Signature box: draw your signature here"
          role="img"
          className="block h-44 w-full cursor-crosshair touch-none rounded-xl border-2 border-dashed border-ink-300 bg-white select-none"
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            drawing.current = [point(e)];
            redraw();
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            // Coalesced events give smoother lines on phones and pens.
            const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
            const r = e.currentTarget.getBoundingClientRect();
            for (const ev of events) drawing.current.push({ x: ev.clientX - r.left, y: ev.clientY - r.top });
            redraw();
          }}
          onPointerUp={finish}
          onPointerCancel={finish}
        />
        {!value && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-ink-400">
            Sign here with your finger or mouse
          </span>
        )}
        <div className="pointer-events-none absolute right-4 bottom-8 left-4 border-b border-ink-200" aria-hidden />
      </div>
      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="text-ink-500">{value ? "Signature added." : emptyText}</span>
        <button type="button" onClick={clear} className="btn btn-sm" disabled={!value}>
          Clear
        </button>
      </div>
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
