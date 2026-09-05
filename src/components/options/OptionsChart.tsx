"use client";

// Options command center chart: intraday candles + volume with
// VWAP/EMA overlays and CATEGORIZED level lines (zones, trade plan)
// that can be toggled per group so the chart never turns into soup.

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries, HistogramSeries, LineSeries, createChart,
  type IChartApi, type UTCTimestamp,
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

export default function OptionsChart({
  bars, zones, plan, minStrength, toggles, height = 460,
}: {
  bars: Bar[];
  zones: LevelZone[];
  plan: TradePlan | null;
  minStrength: number;
  toggles: ChartToggles;
  height?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [full, setFull] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || bars.length === 0) return;

    const chart = createChart(host, {
      height: full ? window.innerHeight - 80 : height,
      layout: { background: { color: "transparent" }, textColor: C.text, fontSize: 11 },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderColor: C.grid },
      timeScale: { borderColor: C.grid, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      autoSize: true,
    });
    chartRef.current = chart;
    const toTime = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down,
      wickUpColor: C.up, wickDownColor: C.down,
    });
    candles.setData(bars.map((b) => ({ time: toTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c })));

    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" } });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vol.setData(bars.map((b) => ({ time: toTime(b.t), value: b.v, color: b.c >= b.o ? "#16c78455" : "#ea394355" })));

    if (toggles.vwap) {
      const vw = sessionVwapSeries(bars);
      const line = chart.addSeries(LineSeries, { color: C.vwap, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
      line.setData(bars.map((b, i) => ({ time: toTime(b.t), value: vw[i] })).filter((x): x is { time: UTCTimestamp; value: number } => x.value !== null));
    }
    if (toggles.emas) {
      const closes = bars.map((b) => b.c);
      for (const [period, color] of [[9, C.ema9], [20, C.ema20]] as const) {
        const ema = emaSeries(closes, period);
        const line = chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
        line.setData(bars.map((b, i) => ({ time: toTime(b.t), value: ema[i] })).filter((x): x is { time: UTCTimestamp; value: number } => x.value !== null));
      }
    }
    if (toggles.zones) {
      for (const z of zones.filter((z) => z.strength >= minStrength).slice(0, 14)) {
        candles.createPriceLine({
          price: z.price,
          color: z.kind === "resistance" ? C.resistance : C.support,
          lineWidth: z.strength >= 90 ? 2 : 1,
          lineStyle: z.strength >= 80 ? 0 : 2,
          axisLabelVisible: true,
          title: `${z.kind === "resistance" ? "R" : "S"} ${z.strength}`,
        });
      }
    }
    if (toggles.plan && plan) {
      candles.createPriceLine({ price: plan.trigger, color: C.trigger, lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: "TRIG" });
      plan.targets.forEach((t, i) => {
        candles.createPriceLine({ price: t, color: C.target, lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: `T${i + 1}` });
      });
      candles.createPriceLine({ price: plan.invalidation, color: C.inv, lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: "INV" });
    }

    chart.timeScale().fitContent();
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, zones, plan, minStrength, toggles, height, full]);

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
