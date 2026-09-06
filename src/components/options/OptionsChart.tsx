"use client";

// Options command center chart. Created ONCE and updated in place
// (zoom/pan survive data refreshes).
//
// View presets keep it readable:
//   clean   — plan lines + the nearest buy zone below and sell zone
//             above, words instead of numbers, EMA9 + VWAP only
//   levels  — every zone above the strength filter with its score
//   minimal — candles, VWAP and plan lines only
// Zones sitting on top of a plan line are skipped (the plan line
// already says it). Beginner labels add a trend badge, a "what to do
// now" line, a colour legend and markers where the setup changed.

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries, HistogramSeries, LineSeries, createChart, createSeriesMarkers,
  type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp,
  type WhitespaceData, type LineData,
} from "lightweight-charts";
import { Maximize2, Minimize2 } from "lucide-react";
import type { Bar } from "@/lib/bars";
import { emaSeries } from "@/lib/indicators";
import { etStamp, sessionOf, sessionVwapSeries } from "@/lib/intraday";
import type { LevelZone } from "@/lib/intraday";
import type { MachineState, TradePlan } from "@/lib/setupMachine";

const C = {
  up: "#16c784", down: "#ea3943", vwap: "#f0b90b", ema9: "#60a5fa", ema20: "#a78bfa",
  grid: "#1f2937", text: "#8b97a8",
  resistance: "#ea3943", support: "#16c784", trigger: "#f59e0b", target: "#38bdf8", inv: "#f43f5e",
};

export type ChartView = "clean" | "levels" | "minimal";

export interface ChartToggles {
  labels: boolean;
}

export interface ChartContext {
  trend: string | null;
  trendConfidence: number | null;
  direction: "long" | "short";
  state: string | null;
  actionLine: string;
  machine: MachineState | null;
  machineBars: Bar[];
  symbol: string;
}

const toTime = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;
const strengthWord = (s: number) => (s >= 90 ? "MAJOR " : s >= 80 ? "STRONG " : "");

export default function OptionsChart({
  bars, zones, plan, minStrength, view, toggles, resetKey, context, height = 460,
}: {
  bars: Bar[];
  zones: LevelZone[];
  plan: TradePlan | null;
  minStrength: number;
  view: ChartView;
  toggles: ChartToggles;
  resetKey: string;
  context: ChartContext;
  height?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const overlayRefs = useRef<ISeriesApi<"Line">[]>([]);
  const lineRefs = useRef<IPriceLine[]>([]);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const lastResetKey = useRef<string>("");
  const [full, setFull] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = createChart(host, {
      height: full ? window.innerHeight - 110 : height,
      layout: { background: { color: "transparent" }, textColor: C.text, fontSize: 11 },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderColor: C.grid },
      timeScale: { borderColor: C.grid, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      autoSize: true,
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down,
      wickUpColor: C.up, wickDownColor: C.down,
    });
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" } });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    chartRef.current = chart;
    candlesRef.current = candles;
    volRef.current = vol;
    markersRef.current = createSeriesMarkers(candles, []);
    lastResetKey.current = "";
    return () => {
      chart.remove();
      chartRef.current = null;
      candlesRef.current = null;
      volRef.current = null;
      overlayRefs.current = [];
      lineRefs.current = [];
      markersRef.current = null;
    };
  }, [full, height]);

  useEffect(() => {
    const chart = chartRef.current;
    const candles = candlesRef.current;
    const vol = volRef.current;
    if (!chart || !candles || !vol || bars.length === 0) return;
    const range = chart.timeScale().getVisibleLogicalRange();
    candles.setData(bars.map((b) => ({ time: toTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c })));
    vol.setData(bars.map((b) => ({ time: toTime(b.t), value: b.v, color: b.c >= b.o ? "#16c78440" : "#ea394340" })));
    if (lastResetKey.current !== resetKey) {
      chart.timeScale().fitContent();
      lastResetKey.current = resetKey;
    } else if (range) {
      chart.timeScale().setVisibleLogicalRange(range);
    }
  }, [bars, resetKey]);

  // Overlays. Nulls become whitespace points so the line BREAKS across
  // session gaps instead of drawing a diagonal to the next day.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || bars.length === 0) return;
    for (const s of overlayRefs.current) chart.removeSeries(s);
    overlayRefs.current = [];
    const add = (color: string, width: 1 | 2, values: (number | null)[], title: string) => {
      const line = chart.addSeries(LineSeries, { color, lineWidth: width, priceLineVisible: false, lastValueVisible: toggles.labels, title: toggles.labels ? title : "" });
      const data: (LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>)[] = bars.map((b, i) =>
        values[i] === null ? { time: toTime(b.t) } : { time: toTime(b.t), value: values[i] as number }
      );
      line.setData(data);
      overlayRefs.current.push(line);
    };
    add(C.vwap, 2, sessionVwapSeries(bars), "VWAP (avg price paid today)");
    if (view !== "minimal") {
      const closes = bars.map((b) => b.c);
      add(C.ema9, 1, emaSeries(closes, 9), "EMA9 (fast trend)");
      if (view === "levels") add(C.ema20, 1, emaSeries(closes, 20), "EMA20 (slow trend)");
    }
  }, [bars, view, toggles.labels, full]);

  // Level + plan lines.
  useEffect(() => {
    const candles = candlesRef.current;
    if (!candles) return;
    for (const l of lineRefs.current) candles.removePriceLine(l);
    lineRefs.current = [];
    const L = toggles.labels;
    const line = (price: number, color: string, width: 1 | 2, style: 0 | 1 | 2 | 3, title: string) => {
      lineRefs.current.push(candles.createPriceLine({ price, color, lineWidth: width, lineStyle: style, axisLabelVisible: true, title }));
    };
    const price = bars.length ? bars[bars.length - 1].c : null;
    const planPrices = plan ? [plan.trigger, plan.invalidation, ...plan.targets] : [];
    const onPlanLine = (p: number) => planPrices.some((q) => Math.abs(q - p) / Math.max(1e-9, p) < 0.0015);

    if (view !== "minimal") {
      let picked = zones.filter((z) => z.strength >= minStrength && !onPlanLine(z.price));
      if (view === "clean" && price !== null) {
        const above = picked.filter((z) => z.price > price).sort((a, b) => a.price - b.price).slice(0, 1);
        const below = picked.filter((z) => z.price < price).sort((a, b) => b.price - a.price).slice(0, 1);
        picked = [...above, ...below];
      } else {
        picked = picked.slice(0, 12);
      }
      for (const z of picked) {
        const res = z.kind === "resistance";
        const title = L
          ? view === "clean"
            ? `${strengthWord(z.strength)}${res ? "SELL ZONE" : "BUY ZONE"}`
            : `${res ? "sell zone" : "buy zone"} ${z.strength}`
          : `${res ? "R" : "S"} ${z.strength}`;
        line(z.price, res ? C.resistance : C.support, z.strength >= 90 ? 2 : 1, z.strength >= 80 ? 0 : 2, title);
      }
    }
    if (plan) {
      const up = plan.direction === "long";
      line(plan.trigger, C.trigger, 2, 0, L ? (up ? "BREAK HERE ▲ (buy calls above)" : "BREAK HERE ▼ (buy puts below)") : "TRIG");
      const targets = view === "clean" ? plan.targets.slice(0, 2) : plan.targets;
      targets.forEach((t, i) => line(t, C.target, 1, 3, L ? `TARGET ${i + 1} (take profit)` : `T${i + 1}`));
      line(plan.invalidation, C.inv, 2, 2, L ? (up ? "WRONG BELOW (get out)" : "WRONG ABOVE (get out)") : "INV");
    }
  }, [bars, zones, plan, minStrength, view, toggles.labels, full]);

  // Markers where the setup machine changed state (5m/1m charts).
  useEffect(() => {
    const m = markersRef.current;
    if (!m) return;
    if (!toggles.labels || !context.machine || context.machineBars.length === 0 || bars.length === 0) {
      m.setMarkers([]);
      return;
    }
    const want: Record<string, { text: string; color: string; position: "aboveBar" | "belowBar"; shape: "arrowUp" | "arrowDown" | "circle" | "square" }> = {
      TRIGGERED: { text: "poked through", color: C.trigger, position: "aboveBar", shape: "circle" },
      CONFIRMED: { text: "BREAK CONFIRMED", color: C.up, position: "belowBar", shape: "arrowUp" },
      RETESTING: { text: "retest", color: C.trigger, position: "aboveBar", shape: "square" },
      CONTINUATION: { text: "held, going", color: C.up, position: "belowBar", shape: "arrowUp" },
      FAILED: { text: "FAILED", color: C.down, position: "aboveBar", shape: "arrowDown" },
      INVALIDATED: { text: "WRONG", color: C.down, position: "aboveBar", shape: "arrowDown" },
    };
    const first = bars[0].t;
    const last = bars[bars.length - 1].t;
    const markers: SeriesMarker<Time>[] = [];
    for (const tr of context.machine.transitions) {
      const spec = want[tr.to];
      const bar = context.machineBars[tr.index];
      if (!spec || !bar || bar.t < first || bar.t > last) continue;
      const snapped = [...bars].reverse().find((b) => b.t <= bar.t) ?? bar;
      markers.push({ time: toTime(snapped.t), position: spec.position, color: spec.color, shape: spec.shape, text: spec.text });
    }
    m.setMarkers(markers);
  }, [bars, context.machine, context.machineBars, toggles.labels]);

  const trendTone = !context.trend ? "text-ink-muted border-border bg-bg-card/90" : /Bullish/.test(context.trend) ? "text-bull border-bull/40 bg-bg-card/90" : /Bearish/.test(context.trend) ? "text-bear border-bear/40 bg-bg-card/90" : "text-warn border-warn/40 bg-bg-card/90";
  const inSession = bars.length ? sessionOf(bars[bars.length - 1].t) : "closed";
  const lastDate = bars.length ? etStamp(bars[bars.length - 1].t).date : "";

  return (
    <div className={full ? "fixed inset-0 z-50 bg-bg p-3" : "relative"}>
      {toggles.labels && (
        <div className="pointer-events-none absolute left-2 top-2 z-10 max-w-[min(520px,70%)]">
          <div className={`rounded border px-2 py-1 text-[11px] font-bold ${trendTone}`}>
            {context.symbol} is {context.trend ? context.trend.toUpperCase() : "UNREAD"}
            {context.trendConfidence !== null && <span className="ml-1 font-normal opacity-80">({context.trendConfidence}/100)</span>}
          </div>
          {context.actionLine && (
            <div className="mt-1 rounded border border-border bg-bg-card/95 px-2 py-1 text-[11px] leading-snug text-ink">
              <span className="mr-1 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">Now:</span>
              {context.actionLine}
            </div>
          )}
        </div>
      )}
      <button
        onClick={() => setFull((v) => !v)}
        className="absolute right-2 top-2 z-10 rounded border border-border bg-bg-card p-1 text-ink-muted hover:text-ink"
        title={full ? "Exit fullscreen" : "Fullscreen"}
      >
        {full ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
      </button>
      <button
        onClick={() => chartRef.current?.timeScale().fitContent()}
        className="absolute right-9 top-2 z-10 rounded border border-border bg-bg-card px-1.5 py-0.5 text-[10px] text-ink-muted hover:text-ink"
        title="Reset view"
      >
        Fit
      </button>
      <div ref={hostRef} style={{ height: full ? "calc(100vh - 110px)" : height }} />
      {toggles.labels && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-border px-2 py-1 text-[9px] text-ink-faint">
          <span><span className="mr-1 inline-block h-2 w-3 bg-[#16c784]" />buy zone (support)</span>
          <span><span className="mr-1 inline-block h-2 w-3 bg-[#ea3943]" />sell zone (resistance)</span>
          <span><span className="mr-1 inline-block h-2 w-3 bg-[#f59e0b]" />break level</span>
          <span><span className="mr-1 inline-block h-2 w-3 bg-[#38bdf8]" />targets</span>
          <span><span className="mr-1 inline-block h-2 w-3 bg-[#f43f5e]" />wrong past here</span>
          <span><span className="mr-1 inline-block h-2 w-3 bg-[#f0b90b]" />VWAP</span>
          {view === "clean" && <span className="text-ink-faint/70">clean view: nearest zone each side only</span>}
          <span className="ml-auto">{inSession === "closed" ? `last session ${lastDate}` : `${inSession} session`}</span>
        </div>
      )}
    </div>
  );
}
