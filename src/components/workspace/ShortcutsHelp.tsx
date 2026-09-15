"use client";

// Keyboard map popover.

import { useEffect, useRef, useState } from "react";
import { Keyboard } from "lucide-react";
import { Kbd } from "@/components/ui/primitives";

export const SHORTCUTS: [string, string][] = [
  ["F", "Focus mode"], ["/", "Ticker search"], ["1", "1 minute"], ["2", "2 minute"], ["5", "5 minute"], ["I", "15 minute"], ["3", "30 minute"], ["H", "1 hour"], ["D", "Daily"], ["W", "Weekly"],
  ["O", "Options chain drawer"], ["S", "Scanner rail"], ["P", "Trade Command Panel"], ["J", "Journal"], ["[ ]", "Previous / next recent symbol"], ["Esc", "Close dialog or leave a field"], ["?", "This list"],
];

export default function ShortcutsHelp({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, setOpen]);
  return (
    <div className="relative" ref={ref} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button onClick={() => setOpen(!open)} className={`btn-quiet h-6 px-1 ${open ? "bg-bg-hover text-ink" : ""}`} aria-label="Keyboard shortcuts" title={hover ? undefined : "Keyboard shortcuts (?)"}><Keyboard size={13} /></button>
      {open && (
        <div className="absolute right-0 top-7 z-40 w-64 rounded-lg bg-bg-card p-2 shadow-pop">
          <div className="stat-label mb-1">Keyboard</div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-ink-muted">
            {SHORTCUTS.map(([k, v]) => [<span key={`${k}k`} className="flex gap-0.5">{k.split(" ").map((x) => <Kbd key={x}>{x}</Kbd>)}</span>, <span key={`${k}v`}>{v}</span>])}
          </div>
          <div className="mt-1.5 text-2xs text-ink-faint">Shortcuts are off while typing in a field.</div>
        </div>
      )}
    </div>
  );
}
