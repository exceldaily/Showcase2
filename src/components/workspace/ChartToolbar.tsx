"use client";

// Chart controls: timeframe, preset, per-indicator toggles, level
// strength filter, and the freshness clock.

import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { CHART_PRESETS, TOGGLE_LABELS, effectiveToggles, setPreset, toggleIndicator, type ChartPrefs, type ChartToggles } from "@/lib/chartPrefs";
import { TF_CHOICES, type ChartTf } from "@/components/options/types";
import { Seg } from "@/components/ui/primitives";

const GROUPS: { title: string; keys: (keyof ChartToggles)[] }[] = [
  { title: "Overlays", keys: ["vwap", "ema9", "ema20", "ema50", "ema200", "volume"] },
  { title: "Panes", keys: ["macd", "rsi"] },
  { title: "Plan", keys: ["trigger", "targets", "invalidation", "markers"] },
  { title: "Levels", keys: ["levels", "allLevels", "prevDay", "premarket", "openingRange"] },
  { title: "Labels", keys: ["labels"] },
];

export default function ChartToolbar({
  tf, setTf, prefs, setPrefs, minStrength, setMinStrength, right,
}: {
  tf: ChartTf; setTf: (t: ChartTf) => void;
  prefs: ChartPrefs; setPrefs: (p: ChartPrefs) => void;
  minStrength: number; setMinStrength: (n: number) => void;
  right?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const t = effectiveToggles(prefs);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const overrideCount = Object.keys(prefs.overrides).length;
  return (
    <div className="flex flex-wrap items-center gap-2 px-2 py-1">
      <Seg value={tf} onChange={setTf} options={TF_CHOICES.map((c) => ({ key: c.key, label: c.label, title: `Timeframe ${c.label} (${c.hotkey})` }))} />
      <Seg value={prefs.preset} onChange={(p) => setPrefs(setPreset(prefs, p))} options={CHART_PRESETS.map((p) => ({ key: p, label: p.charAt(0) + p.slice(1).toLowerCase(), title: `${p} preset` }))} />
      <div className="relative" ref={ref}>
        <button onClick={() => setOpen((v) => !v)} className={`btn-quiet btn-sm ${open || overrideCount ? "text-ink" : ""}`} data-tip="Indicators and lines">
          <SlidersHorizontal size={12} /> Indicators{overrideCount ? <span className="rounded bg-brand/20 px-1 text-2xs text-brand-glow">{overrideCount}</span> : null}
        </button>
        {open && (
          <div className="absolute left-0 top-7 z-40 w-64 rounded-lg bg-bg-card p-2 shadow-pop">
            {GROUPS.map((g) => (
              <div key={g.title} className="mb-1.5">
                <div className="stat-label mb-0.5">{g.title}</div>
                <div className="grid grid-cols-2 gap-x-2">
                  {g.keys.map((k) => (
                    <label key={k} className="flex cursor-pointer items-center gap-1.5 py-0.5 text-xs text-ink-muted hover:text-ink">
                      <input type="checkbox" className="accent-brand" checked={t[k]} onChange={() => setPrefs(toggleIndicator(prefs, k))} />
                      {TOGGLE_LABELS[k]}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-border/60 pt-1.5 text-xs">
              <label className="flex items-center gap-1 text-ink-faint">
                Levels ≥
                <select value={minStrength} onChange={(e) => setMinStrength(Number(e.target.value))} className="select py-0 text-xs">
                  <option value={50}>50</option><option value={65}>65</option><option value={80}>80</option><option value={90}>90</option>
                </select>
              </label>
              {overrideCount > 0 && <button onClick={() => setPrefs(setPreset(prefs, prefs.preset))} className="btn-quiet btn-sm">reset to preset</button>}
            </div>
          </div>
        )}
      </div>
      <span className="ml-auto flex items-center gap-2 text-xs text-ink-faint">{right}</span>
    </div>
  );
}
