"use client";

// The board: a 12-column grid of widgets you drag by the header and
// resize by the corner. Layout lives in this browser (localStorage).
// Presets: "4 charts" and "Trader". Pointer events cover mouse + touch.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GripVertical, LayoutGrid, Plus, RotateCcw, X } from "lucide-react";
import {
  addWidget, boardRows, COLS, KIND_LABEL, moveWidget, parseBoard, presetFourCharts, presetTrader, removeWidget, resizeWidget, ROW_PX, updateWidget,
  type Widget, type WidgetKind, type WidgetTf,
} from "@/lib/board";
import { ALL_SYMBOLS } from "@/lib/universes";
import { loadRecents } from "@/components/options/SymbolSwitcher";
import ChartWidget from "./ChartWidget";
import PlanWidget from "./PlanWidget";
import MorningWatch from "@/components/options/MorningWatch";
import { ScannerTab } from "@/components/options/OptionsPanels";
import { loadChartPrefs, onChartPrefs, saveChartPrefs, type ChartToggles } from "@/lib/chartPrefs";

const KEY = "af_board";

/** Rows per chart so a 2x2 preset fills the window height. */
function rowsForHalfScreen(): number {
  if (typeof window === "undefined") return 9;
  return Math.max(7, Math.floor((window.innerHeight - 150) / 2 / ROW_PX));
}
const HEADER_PX = 30;
const TFS: WidgetTf[] = ["1m", "5m", "15m", "1h"];

interface Drag {
  id: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  appliedX: number;
  appliedY: number;
}

export default function Board({ isOwner }: { isOwner: boolean }) {
  const [widgets, setWidgets] = useState<Widget[] | null>(null);
  const [width, setWidth] = useState(1200);
  const hostRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<ChartToggles>({ labels: true, emas: false, macd: false });
  useEffect(() => {
    setPrefs(loadChartPrefs());
    return onChartPrefs(setPrefs);
  }, []);
  const flip = (k: "emas" | "macd") => saveChartPrefs({ ...loadChartPrefs(), [k]: !prefs[k] });

  // Load once; default to the four-chart preset seeded from recents.
  useEffect(() => {
    const stored = parseBoard(localStorage.getItem(KEY));
    setWidgets(stored && stored.length ? stored : presetFourCharts(loadRecents(), rowsForHalfScreen()));
  }, []);

  useEffect(() => {
    if (widgets) {
      try { localStorage.setItem(KEY, JSON.stringify(widgets)); } catch { /* ignore */ }
    }
  }, [widgets]);

  // Measure the grid host once it exists (it mounts after the layout
  // loads) and keep measuring as the window changes.
  const ready = widgets !== null;
  useEffect(() => {
    const el = hostRef.current;
    if (!ready || !el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [ready]);

  const colPx = width / COLS;

  const onPointerDown = useCallback((e: React.PointerEvent, id: string, mode: Drag["mode"]) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { id, mode, startX: e.clientX, startY: e.clientY, appliedX: 0, appliedY: 0 };
    setDragging(id);
    e.preventDefault();
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = Math.round((e.clientX - d.startX) / colPx);
    const dy = Math.round((e.clientY - d.startY) / ROW_PX);
    const stepX = dx - d.appliedX;
    const stepY = dy - d.appliedY;
    if (stepX === 0 && stepY === 0) return;
    d.appliedX = dx;
    d.appliedY = dy;
    setWidgets((list) => (list ? (d.mode === "move" ? moveWidget(list, d.id, stepX, stepY) : resizeWidget(list, d.id, stepX, stepY)) : list));
  }, [colPx]);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
    setDragging(null);
  }, []);

  const rows = useMemo(() => (widgets ? boardRows(widgets) : 10), [widgets]);

  if (!widgets) return <div className="p-6 text-sm text-ink-faint">Loading your board…</div>;

  const add = (kind: WidgetKind) => setWidgets((l) => addWidget(l ?? [], kind, loadRecents()[0]));

  return (
    <div className="-mx-4 -my-6 sm:-mx-6">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-bg-card px-3 py-2">
        <span className="panel-title"><LayoutGrid size={12} /> My board</span>
        <span className="text-xs text-ink-faint">Drag a header to move, drag a corner to resize. Saved on this device.</span>
        <span className="flex-1" />
        <span className="text-xs text-ink-faint">Add:</span>
        {(Object.keys(KIND_LABEL) as WidgetKind[]).map((k) => (
          <button key={k} onClick={() => add(k)} className="btn-ghost !px-2 !py-1 !text-xs"><Plus size={11} className="mr-1 inline" />{KIND_LABEL[k]}</button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <button onClick={() => flip("emas")} className={`rounded border px-2 py-1 text-xs ${prefs.emas ? "border-brand/40 text-brand-glow" : "border-border text-ink-faint"}`} title="EMA 20/50/200 on every chart">EMAs</button>
        <button onClick={() => flip("macd")} className={`rounded border px-2 py-1 text-xs ${prefs.macd ? "border-brand/40 text-brand-glow" : "border-border text-ink-faint"}`} title="MACD pane on every chart">MACD</button>
        <span className="mx-1 h-4 w-px bg-border" />
        <button onClick={() => setWidgets(presetFourCharts(loadRecents(), rowsForHalfScreen()))} className="btn-ghost !px-2 !py-1 !text-xs">4 charts</button>
        <button onClick={() => setWidgets(presetTrader(loadRecents()))} className="btn-ghost !px-2 !py-1 !text-xs">Trader</button>
        <button onClick={() => { if (window.confirm("Clear the board?")) setWidgets([]); }} className="btn-ghost !px-2 !py-1 !text-xs" title="Clear"><RotateCcw size={11} /></button>
      </div>

      <div
        ref={hostRef}
        className="relative w-full select-none"
        style={{ height: rows * ROW_PX }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {widgets.length === 0 && (
          <div className="absolute inset-x-0 top-10 text-center text-sm text-ink-faint">Empty board. Add a widget or pick a preset above.</div>
        )}
        {widgets.map((w) => {
          const active = dragging === w.id;
          const px = { left: w.x * colPx + 4, top: w.y * ROW_PX + 4, width: w.w * colPx - 8, height: w.h * ROW_PX - 8 };
          const bodyH = px.height - HEADER_PX;
          return (
            <div
              key={w.id}
              className={`absolute flex flex-col overflow-hidden rounded-xl border bg-bg-card shadow-card transition-shadow ${active ? "z-20 border-brand shadow-glow" : "z-10 border-border"}`}
              style={px}
            >
              <div
                className="flex h-[30px] shrink-0 cursor-grab items-center gap-2 border-b border-border bg-bg-elevated/70 px-2 active:cursor-grabbing"
                style={{ touchAction: "none" }}
                onPointerDown={(e) => onPointerDown(e, w.id, "move")}
              >
                <GripVertical size={12} className="text-ink-faint" />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{KIND_LABEL[w.kind]}</span>
                {(w.kind === "chart" || w.kind === "plan") && (
                  <input
                    defaultValue={w.symbol}
                    list="af-board-symbols"
                    onPointerDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const v = (e.currentTarget.value || "").trim().toUpperCase();
                        if (/^[A-Z.]{1,6}$/.test(v)) setWidgets((l) => updateWidget(l ?? [], w.id, { symbol: v }));
                        e.currentTarget.blur();
                      }
                    }}
                    onBlur={(e) => {
                      const v = (e.currentTarget.value || "").trim().toUpperCase();
                      if (/^[A-Z.]{1,6}$/.test(v) && v !== w.symbol) setWidgets((l) => updateWidget(l ?? [], w.id, { symbol: v }));
                    }}
                    className="w-20 rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-xs uppercase outline-none focus:border-brand"
                    autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false}
                  />
                )}
                {w.kind === "chart" && (
                  <span className="flex gap-0.5" onPointerDown={(e) => e.stopPropagation()}>
                    {TFS.map((t) => (
                      <button key={t} onClick={() => setWidgets((l) => updateWidget(l ?? [], w.id, { tf: t }))} className={`rounded px-1.5 py-0.5 text-[11px] ${w.tf === t ? "bg-brand text-white" : "text-ink-faint hover:text-ink"}`}>{t}</button>
                    ))}
                  </span>
                )}
                <span className="flex-1" />
                <button onPointerDown={(e) => e.stopPropagation()} onClick={() => setWidgets((l) => removeWidget(l ?? [], w.id))} className="text-ink-faint hover:text-bear" title="Remove"><X size={13} /></button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                {w.kind === "chart" && <ChartWidget symbol={w.symbol ?? "NVDA"} tf={w.tf ?? "5m"} height={bodyH} />}
                {w.kind === "plan" && <PlanWidget symbol={w.symbol ?? "NVDA"} />}
                {w.kind === "watch" && (
                  <div className="h-full overflow-y-auto">
                    <MorningWatch isOwner={isOwner} onLoad={(sym) => { window.location.href = `/options?s=${sym}`; }} />
                  </div>
                )}
                {w.kind === "scanner" && (
                  <div className="h-full overflow-y-auto">
                    <ScannerTab compact profile="DAY" onPick={(sym) => setWidgets((l) => addWidget(l ?? [], "chart", sym))} />
                  </div>
                )}
              </div>
              <div
                className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize"
                style={{ touchAction: "none", background: "linear-gradient(135deg, transparent 50%, rgba(138,180,255,0.6) 50%)" }}
                onPointerDown={(e) => onPointerDown(e, w.id, "resize")}
                title="Resize"
              />
            </div>
          );
        })}
      </div>
      <datalist id="af-board-symbols">{ALL_SYMBOLS.map((s) => <option key={s} value={s} />)}</datalist>
    </div>
  );
}
