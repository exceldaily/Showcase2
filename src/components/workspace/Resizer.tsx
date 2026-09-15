"use client";

// Drag handle between panels. Vertical handles resize widths,
// horizontal ones resize heights. Pointer events, so it works with a
// mouse, a pen and touch alike.

import { useRef } from "react";

export default function Resizer({
  axis, onDelta, onEnd, className = "",
}: {
  axis: "x" | "y";
  /** Called with the delta from the drag start in pixels. */
  onDelta: (delta: number) => void;
  onEnd?: () => void;
  className?: string;
}) {
  const start = useRef<number | null>(null);
  return (
    <div
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      className={`group relative z-20 shrink-0 select-none ${axis === "x" ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize"} ${className}`}
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        start.current = axis === "x" ? e.clientX : e.clientY;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (start.current === null) return;
        onDelta((axis === "x" ? e.clientX : e.clientY) - start.current);
      }}
      onPointerUp={(e) => {
        start.current = null;
        try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        onEnd?.();
      }}
      onPointerCancel={() => { start.current = null; onEnd?.(); }}
    >
      <div className={`absolute bg-transparent transition-colors group-hover:bg-brand/50 group-active:bg-brand ${axis === "x" ? "inset-y-0 left-0 w-1" : "inset-x-0 top-0 h-1"}`} />
    </div>
  );
}
