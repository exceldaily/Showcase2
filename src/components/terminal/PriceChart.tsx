"use client";

// Professional candlestick chart (spec §16).
// Candles + volume + VWAP/EMA overlays + MACD/RSI panes, level lines,
// and prev-close marker. Renders only what the data supports.

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

export interface ChartBar {
  t: number; // epoch ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface ChartOverlays {
  vwap?: (number | null)[];
  ema9?: (number | null)[];
  ema20?: (number | null)[];
  ema50?: (number | null)[];
  ema200?: (number | null)[];
  macd?: { macd: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[] };
  rsi?: (number | null)[];
  levels?: { price: number; kind: "support" | "resistance"; touches: number }[];
  prevClose?: number | null;
}

const COLORS = {
  up: "#16c784",
  down: "#ea3943",
  vwap: "#f0b90b",
  ema9: "#60a5fa",
  ema20: "#a78bfa",
  ema50: "#f472b6",
  ema200: "#94a3b8",
  grid: "#1f2937",
  text: "#8b97a8",
};

export default function PriceChart({
  bars,
  overlays = {},
  showPanes = true,
  height = 420,
}: {
  bars: ChartBar[];
  overlays?: ChartOverlays;
  showPanes?: boolean;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [visible, setVisible] = useState({ vwap: true, ema9: true, ema20: true, ema50: true, ema200: false, levels: true });

  useEffect(() => {
    if (!containerRef.current || bars.length === 0) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: COLORS.text,
        fontSize: 11,
        panes: { separatorColor: COLORS.grid, separatorHoverColor: "#2a3546" },
      },
      grid: {
        vertLines: { color: COLORS.grid, style: 1 },
        horzLines: { color: COLORS.grid, style: 1 },
      },
      rightPriceScale: { borderColor: COLORS.grid, scaleMargins: { top: 0.08, bottom: 0.28 } },
      timeScale: { borderColor: COLORS.grid, rightOffset: 4, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    });
    chartRef.current = chart;

    const toTime = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;

    // ── Candles (pane 0) ──
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.up,
      downColor: COLORS.down,
      borderUpColor: COLORS.up,
      borderDownColor: COLORS.down,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down,
    });
    candles.setData(bars.map((b) => ({ time: toTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c })));

    // ── Volume (overlay on pane 0, bottom 22%) ──
    const vol = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
    vol.setData(
      bars.map((b, i) => ({
        time: toTime(b.t),
        value: b.v,
        color: i > 0 && b.c >= bars[i - 1].c ? "rgba(22,199,132,0.35)" : "rgba(234,57,67,0.35)",
      }))
    );

    // ── Overlays ──
    const addLine = (data: (number | null)[] | undefined, color: string, width: 1 | 2, title: string) => {
      if (!data) return null;
      const s = chart.addSeries(LineSeries, {
        color,
        lineWidth: width,
        priceLineVisible: false,
        lastValueVisible: false,
        title,
      });
      s.setData(
        bars
          .map((b, i) => ({ time: toTime(b.t), value: data[i] }))
          .filter((p): p is { time: UTCTimestamp; value: number } => p.value !== null && p.value !== undefined)
      );
      return s;
    };

    const series: Record<string, ISeriesApi<"Line"> | null> = {};
    if (visible.vwap) series.vwap = addLine(overlays.vwap, COLORS.vwap, 2, "VWAP");
    if (visible.ema9) series.ema9 = addLine(overlays.ema9, COLORS.ema9, 1, "EMA 9");
    if (visible.ema20) series.ema20 = addLine(overlays.ema20, COLORS.ema20, 1, "EMA 20");
    if (visible.ema50) series.ema50 = addLine(overlays.ema50, COLORS.ema50, 1, "EMA 50");
    if (visible.ema200) series.ema200 = addLine(overlays.ema200, COLORS.ema200, 1, "EMA 200");

    // ── Level lines + previous close ──
    if (visible.levels && overlays.levels) {
      for (const lv of overlays.levels.slice(0, 5)) {
        candles.createPriceLine({
          price: lv.price,
          color: lv.kind === "resistance" ? "rgba(234,57,67,0.5)" : "rgba(22,199,132,0.5)",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: `${lv.kind === "resistance" ? "R" : "S"} ×${lv.touches}`,
        });
      }
    }
    if (overlays.prevClose) {
      candles.createPriceLine({
        price: overlays.prevClose,
        color: "rgba(139,151,168,0.6)",
        lineWidth: 1,
        lineStyle: 3,
        axisLabelVisible: true,
        title: "PC",
      });
    }

    // ── MACD pane ──
    if (showPanes && overlays.macd) {
      const macdPane = 1;
      const hist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, macdPane);
      hist.setData(
        bars
          .map((b, i) => ({
            time: toTime(b.t),
            value: overlays.macd!.histogram[i],
            color: (overlays.macd!.histogram[i] ?? 0) >= 0 ? "rgba(22,199,132,0.6)" : "rgba(234,57,67,0.6)",
          }))
          .filter((p): p is { time: UTCTimestamp; value: number; color: string } => p.value !== null && p.value !== undefined)
      );
      const macdLine = chart.addSeries(LineSeries, { color: COLORS.ema9, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "MACD" }, macdPane);
      macdLine.setData(
        bars.map((b, i) => ({ time: toTime(b.t), value: overlays.macd!.macd[i] }))
          .filter((p): p is { time: UTCTimestamp; value: number } => p.value !== null && p.value !== undefined)
      );
      const sigLine = chart.addSeries(LineSeries, { color: COLORS.vwap, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "Signal" }, macdPane);
      sigLine.setData(
        bars.map((b, i) => ({ time: toTime(b.t), value: overlays.macd!.signal[i] }))
          .filter((p): p is { time: UTCTimestamp; value: number } => p.value !== null && p.value !== undefined)
      );
      chart.panes()[macdPane]?.setHeight(90);
    }

    // ── RSI pane ──
    if (showPanes && overlays.rsi) {
      const rsiPane = overlays.macd ? 2 : 1;
      const rsiLine = chart.addSeries(LineSeries, { color: "#a78bfa", lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: "RSI 14" }, rsiPane);
      rsiLine.setData(
        bars.map((b, i) => ({ time: toTime(b.t), value: overlays.rsi![i] }))
          .filter((p): p is { time: UTCTimestamp; value: number } => p.value !== null && p.value !== undefined)
      );
      for (const lvl of [70, 30]) {
        rsiLine.createPriceLine({ price: lvl, color: "rgba(139,151,168,0.35)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
      }
      chart.panes()[rsiPane]?.setHeight(70);
    }

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, overlays, showPanes, visible]);

  if (bars.length === 0) {
    return (
      <div className="flex items-center justify-center border border-border bg-bg-card p-8 text-xs text-ink-muted" style={{ height }}>
        DATA UNAVAILABLE — no bars for this symbol and timeframe.
      </div>
    );
  }

  const toggles: { key: keyof typeof visible; label: string; color: string }[] = [
    { key: "vwap", label: "VWAP", color: COLORS.vwap },
    { key: "ema9", label: "EMA 9", color: COLORS.ema9 },
    { key: "ema20", label: "EMA 20", color: COLORS.ema20 },
    { key: "ema50", label: "EMA 50", color: COLORS.ema50 },
    { key: "ema200", label: "EMA 200", color: COLORS.ema200 },
    { key: "levels", label: "S/R", color: "#8b97a8" },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-bg-card px-2 py-1">
        {toggles.map((t) => (
          <button
            key={t.key}
            onClick={() => setVisible((v) => ({ ...v, [t.key]: !v[t.key] }))}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
              visible[t.key] ? "bg-bg-hover text-ink" : "text-ink-faint hover:text-ink-muted"
            }`}
          >
            <span className="h-0.5 w-3 rounded" style={{ background: visible[t.key] ? t.color : "#3a4759" }} />
            {t.label}
          </button>
        ))}
      </div>
      <div ref={containerRef} style={{ height }} />
    </div>
  );
}
