"use client";

// Options command center chart. The chart instance is created ONCE
// and updated in place: bar refreshes call setData while preserving
// the user's zoom/pan; overlays and level lines are swapped without
// tearing the chart down. Only a symbol/timeframe change refits.

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries, HistogramSeries, LineSeries, createChart,
  type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp,
} from "lightweight-charts";
import { Maximize2, Minimize2 } from "lucide-react";
import type { Bar } from "@/lib/bars";
import { emaSeries } from "@/lib/indicators";
import { sessionVwapSeries } from "@/lib/intraday";
import type { LevelZone } from "@/lib/intraday";
import type { TradePlan } from "@/lib/setupMachine";

const C = {
  up: "#16c784", down: "#ea3943", vwap: "#f0b90b", ema9: "#60a5fa", ema20: "#a78bfa",
  grid: "#1f2937", text: "#8b97a8",
  resistance: "#ea3943", support: "#16c784", trigger: "#f59e0b", target: "#38bdf8", inv: "#f43f5e",
};

export interface ChartToggles {
  vwap: boolean;
  emas: boolean;
  zones: boolean;
  plan: boolean;
}

const toTime = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;

export default function OptionsChart({
  bars, zones, plan, minStrength, toggles, resetKey, height = 460,
}: {
  bars: Bar[];
  zones: LevelZone[];
  plan: TradePlan | null;
  minStrength: number;
  toggles: ChartToggles;
  /** Change this (symbol + timeframe) to refit the view; data refreshes keep the view. */
  resetKey: string;
  height?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const overlayRefs = useRef<ISeriesApi<"Line">[]>([]);
  const lineRefs = useRef<IPriceLine[]>([]);
  const lastResetKey = useRef<string>("");
  const [full, setFull] = useState(false);

  // 1. Create the chart once per mount / fullscreen toggle.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = createChart(host, {
      height: full ? window.innerHeight - 80 : height,
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
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chartRef.current = chart;
    candlesRef.current = candles;
    volRef.current = vol;
    lastResetKey.current = ""; // force a refit after (re)creation
    return () => {
      chart.remove();
      chartRef.current = null;
      candlesRef.current = null;
      volRef.current = null;
      overlayRefs.current = [];
      lineRefs.current = [];
    };
  }, [full, height]);

  // 2. Bars: update in place, preserving the visible range.
  useEffect(() => {
    const chart = chartRef.current;
    const candles = candlesRef.current;
    const vol = volRef.current;
    if (!chart || !candles || !vol || bars.length === 0) return;
    const range = chart.timeScale().getVisibleLogicalRange();
    candles.setData(bars.map((b) => ({ time: toTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c })));
    vol.setData(bars.map((b) => ({ time: toTime(b.t), value: b.v, color: b.c >= b.o ? "#16c78455" : "#ea394355" })));
    if (lastResetKey.current !== resetKey) {
      chart.timeScale().fitContent();
      lastResetKey.current = resetKey;
    } else if (range) {
      chart.timeScale().setVisibleLogicalRange(range);
    }
  }, [bars, resetKey]);

  // 3. Overlays (VWAP/EMA) swapped without recreating the chart.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || bars.length === 0) return;
    for (const s of overlayRefs.current) chart.removeSeries(s);
    overlayRefs.current = [];
    const add = (color: string, width: 1 | 2, values: (number | null)[]) => {
      const line = chart.addSeries(LineSeries, { color, lineWidth: width, priceLineVisible: false, lastValueVisible: false });
      line.setData(
        bars.map((b, i) => ({ time: toTime(b.t), value: values[i] }))
          .filter((x): x is { time: UTCTimestamp; value: number } => x.value !== null)
      );
      overlayRefs.current.push(line);
    };
    if (toggles.vwap) add(C.vwap, 2, sessionVwapSeries(bars));
    if (toggles.emas) {
      const closes = bars.map((b) => b.c);
      add(C.ema9, 1, emaSeries(closes, 9));
      add(C.ema20, 1, emaSeries(closes, 20));
    }
  }, [bars, toggles.vwap, toggles.emas, full]);

  // 4. Level + plan lines swapped in place.
  useEffect(() => {
    const candles = candlesRef.current;
    if (!candles) return;
    for (const l of lineRefs.current) candles.removePriceLine(l);
    lineRefs.current = [];
    const line = (price: number, color: string, width: 1 | 2, style: 0 | 1 | 2 | 3, title: string) => {
      lineRefs.current.push(candles.createPriceLine({ price, color, lineWidth: width, lineStyle: style, axisLabelVisible: true, title }));
    };
    if (toggles.zones) {
      for (const z of zones.filter((z) => z.strength >= minStrength).slice(0, 14)) {
        line(z.price, z.kind === "resistance" ? C.resistance : C.support, z.strength >= 90 ? 2 : 1, z.strength >= 80 ? 0 : 2, `${z.kind === "resistance" ? "R" : "S"} ${z.strength}`);
      }
    }
    if (toggles.plan && plan) {
      line(plan.trigger, C.trigger, 2, 0, "TRIG");
      plan.targets.forEach((t, i) => line(t, C.target, 1, 3, `T${i + 1}`));
      line(plan.invalidation, C.inv, 2, 2, "INV");
    }
  }, [zones, plan, minStrength, toggles.zones, toggles.plan, full]);

  return (
    <div className={full ? "fixed inset-0 z-50 bg-bg p-3" : "relative"}>
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
      <div ref={hostRef} style={{ height: full ? "calc(100vh - 80px)" : height }} />
    </div>
  );
}
