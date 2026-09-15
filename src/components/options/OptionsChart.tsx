"use client";

// Command-center chart. Created ONCE per mount and updated in place:
// zoom and pan survive data refreshes, resizes and fullscreen.
//
// Every line type has its own look so the eye can tell them apart:
//   support / resistance   dotted, green / rose, 1px
//   trigger                solid white, 2px          "TRIGGER"
//   targets                dashed teal, 1px          "T1" "T2" "T3"
//   invalidation           dashed red, 2px           "INVALID"
//   session levels         grey                      "PDH" "PMH" "ORH" ...
//   my trade               violet                    "MY STRIKE" "MY B/E"
// Labels are drawn by an overlay at the RIGHT edge (next to the price
// axis) and never on top of candles. Indicators are per-toggle; MACD
// and RSI open their own panes under the price.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries, HistogramSeries, LineSeries, createChart, createSeriesMarkers,
  type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp,
  type WhitespaceData, type LineData,
} from "lightweight-charts";
import { Maximize2, Minimize2, Scan } from "lucide-react";
import type { Bar } from "@/lib/bars";
import { emaSeries, macdSeries, rsiSeries } from "@/lib/indicators";
import type { ChartToggles } from "@/lib/chartPrefs";
import { etOffsetMs, sessionVwapSeries } from "@/lib/intraday";
import { liveCandle, type LiveQuote } from "@/lib/liveCandle";
import type { LevelZone } from "@/lib/intraday";
import type { MachineState, TradePlan } from "@/lib/setupMachine";
import type { SessionLevels } from "@/lib/sessionLevels";

export const CHART_COLORS = {
  up: "#21C987", down: "#F45B69",
  vwap: "#E5AE45", ema9: "#5DA9FF", ema20: "#A78BFA", ema50: "#F472B6", ema200: "#FB923C",
  macd: "#5DA9FF", signal: "#E5AE45", rsi: "#A78BFA",
  grid: "#151E29", text: "#84909D", axis: "#22303D",
  support: "#3DBF8E", resistance: "#E07A87", trigger: "#E8EDF2", target: "#2DD4BF", invalidation: "#F45B69",
  session: "#84909D", sessionFaint: "#5E6B78", mine: "#B08CFF",
};

export interface ChartContext {
  symbol: string;
  direction: "long" | "short";
  state: string | null;
  lockedAt?: string | null;
  machine: MachineState | null;
  machineBars: Bar[];
}

interface LineSpec {
  price: number;
  color: string;
  width: 1 | 2;
  style: 0 | 1 | 2 | 3;
  label: string;
  /** Lower = drawn first, wins de-overlap ties. */
  priority: number;
}

interface Placed { y: number; label: string; color: string; price: number }

// lightweight-charts labels timestamps in UTC; shifting by the Eastern
// offset makes the axis read in market time (9:30 open, 16:00 close).
const toTime = (ms: number) => Math.floor((ms + etOffsetMs(ms)) / 1000) as UTCTimestamp;
const LABEL_H = 14;

export default function OptionsChart({
  bars, zones, plan, minStrength, toggles, resetKey, context, height, live = null, bucketMs = null, myTrade = null, session = null, className = "",
}: {
  bars: Bar[];
  zones: LevelZone[];
  plan: TradePlan | null;
  minStrength: number;
  toggles: ChartToggles;
  resetKey: string;
  context: ChartContext;
  /** Fixed pixel height (board). Omit to fill the parent. */
  height?: number;
  live?: LiveQuote | null;
  bucketMs?: number | null;
  myTrade?: { side: "call" | "put"; strike: number; breakEven: number; label: string } | null;
  session?: SessionLevels | null;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const overlayRefs = useRef<ISeriesApi<"Line">[]>([]);
  const paneRefs = useRef<(ISeriesApi<"Line"> | ISeriesApi<"Histogram">)[]>([]);
  const lineRefs = useRef<IPriceLine[]>([]);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const lastResetKey = useRef<string>("");
  const [full, setFull] = useState(false);
  const [ready, setReady] = useState(false);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [axisW, setAxisW] = useState(60);
  const specsRef = useRef<LineSpec[]>([]);
  const overlayLabelsRef = useRef<LineSpec[]>([]);

  // ── Instance (once) ──
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = createChart(host, {
      layout: { background: { color: "transparent" }, textColor: CHART_COLORS.text, fontSize: 11, fontFamily: "var(--font-mono), ui-monospace, monospace" },
      grid: { vertLines: { color: CHART_COLORS.grid }, horzLines: { color: CHART_COLORS.grid } },
      rightPriceScale: { borderColor: CHART_COLORS.axis, scaleMargins: { top: 0.08, bottom: 0.18 } },
      timeScale: { borderColor: CHART_COLORS.axis, timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: 0, vertLine: { color: "#2C3D4D", labelBackgroundColor: "#16212D" }, horzLine: { color: "#2C3D4D", labelBackgroundColor: "#16212D" } },
      autoSize: true,
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: CHART_COLORS.up, downColor: CHART_COLORS.down, borderUpColor: CHART_COLORS.up, borderDownColor: CHART_COLORS.down,
      wickUpColor: CHART_COLORS.up, wickDownColor: CHART_COLORS.down, priceLineVisible: true, priceLineColor: "#2C3D4D", lastValueVisible: true,
    });
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.86, bottom: 0 } });
    chartRef.current = chart;
    candlesRef.current = candles;
    volRef.current = vol;
    markersRef.current = createSeriesMarkers(candles, []);
    lastResetKey.current = "";
    setReady(true);
    return () => {
      chart.remove();
      chartRef.current = null;
      candlesRef.current = null;
      volRef.current = null;
      overlayRefs.current = [];
      paneRefs.current = [];
      lineRefs.current = [];
      markersRef.current = null;
      setReady(false);
    };
  }, []);

  // ── Right-edge label placement ──
  const placeLabels = useCallback(() => {
    const chart = chartRef.current;
    const candles = candlesRef.current;
    const host = hostRef.current;
    if (!chart || !candles || !host) return;
    const h = host.clientHeight;
    const specs = [...specsRef.current, ...overlayLabelsRef.current];
    const raw: Placed[] = [];
    for (const s of specs) {
      const y = candles.priceToCoordinate(s.price);
      if (y === null || y < 0 || y > h) continue;
      raw.push({ y, label: s.label, color: s.color, price: s.price });
    }
    // De-overlap: sort by y and push later labels down by the label height.
    raw.sort((a, b) => a.y - b.y);
    for (let i = 1; i < raw.length; i++) if (raw[i].y - raw[i - 1].y < LABEL_H) raw[i].y = raw[i - 1].y + LABEL_H;
    // Keep the stack inside the chart from the bottom too.
    for (let i = raw.length - 1; i >= 0; i--) {
      const maxY = h - LABEL_H / 2 - (raw.length - 1 - i) * LABEL_H;
      if (raw[i].y > maxY) raw[i].y = maxY;
    }
    setPlaced(raw);
    try { setAxisW(chart.priceScale("right").width()); } catch { /* not laid out yet */ }
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !ready) return;
    const ts = chart.timeScale();
    const h = () => placeLabels();
    ts.subscribeVisibleLogicalRangeChange(h);
    const id = setInterval(h, 1000);
    return () => {
      ts.unsubscribeVisibleLogicalRangeChange(h);
      clearInterval(id);
    };
  }, [ready, placeLabels]);

  // ── Data ──
  useEffect(() => {
    const chart = chartRef.current;
    const candles = candlesRef.current;
    const vol = volRef.current;
    if (!chart || !candles || !vol || !ready || bars.length === 0) return;
    const range = chart.timeScale().getVisibleLogicalRange();
    candles.setData(bars.map((b) => ({ time: toTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c })));
    vol.setData(toggles.volume ? bars.map((b) => ({ time: toTime(b.t), value: b.v, color: b.c >= b.o ? "#21C98733" : "#F45B6933" })) : []);
    if (lastResetKey.current !== resetKey) {
      chart.timeScale().fitContent();
      // A dragged price axis switches autoscale OFF for good; a new
      // symbol at a different price level would then render off-screen.
      candles.priceScale().applyOptions({ autoScale: true });
      lastResetKey.current = resetKey;
    } else if (range) {
      chart.timeScale().setVisibleLogicalRange(range);
    }
    // Self-heal: if the latest close is outside the visible window, restore autoscale.
    const lastClose = bars[bars.length - 1].c;
    const y = candles.priceToCoordinate(lastClose);
    const h = hostRef.current?.clientHeight ?? 0;
    if (y === null || y < 0 || y > h) {
      candles.priceScale().applyOptions({ autoScale: true });
      chart.timeScale().fitContent();
    }
    placeLabels();
  }, [bars, resetKey, ready, toggles.volume, placeLabels]);

  // Live candle: fold the newest print into the current bar.
  useEffect(() => {
    const candles = candlesRef.current;
    if (!candles || !ready || !live || bars.length === 0) return;
    const b = liveCandle(bars, live, bucketMs);
    if (!b) return;
    try {
      candles.update({ time: toTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c });
    } catch {
      /* out-of-order print; ignore */
    }
  }, [live, bars, bucketMs, ready]);

  // ── Overlays (whitespace across session gaps) ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !ready || bars.length === 0) return;
    for (const s of overlayRefs.current) chart.removeSeries(s);
    overlayRefs.current = [];
    const labels: LineSpec[] = [];
    const add = (color: string, width: 1 | 2, values: (number | null)[], title: string) => {
      const line = chart.addSeries(LineSeries, { color, lineWidth: width, priceLineVisible: false, lastValueVisible: false, title: "", crosshairMarkerVisible: false });
      const lastVal = [...values].reverse().find((v) => v !== null);
      if (lastVal !== undefined && lastVal !== null) labels.push({ price: lastVal, color, width, style: 0, label: title, priority: 9 });
      const data: (LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>)[] = bars.map((b, i) =>
        values[i] === null ? { time: toTime(b.t) } : { time: toTime(b.t), value: values[i] as number }
      );
      line.setData(data);
      overlayRefs.current.push(line);
    };
    const closes = bars.map((b) => b.c);
    if (toggles.vwap) add(CHART_COLORS.vwap, 2, sessionVwapSeries(bars), "VWAP");
    if (toggles.ema9) add(CHART_COLORS.ema9, 1, emaSeries(closes, 9), "EMA9");
    if (toggles.ema20) add(CHART_COLORS.ema20, 1, emaSeries(closes, 20), "EMA20");
    if (toggles.ema50) add(CHART_COLORS.ema50, 1, emaSeries(closes, 50), "EMA50");
    if (toggles.ema200) add(CHART_COLORS.ema200, 2, emaSeries(closes, 200), "EMA200");
    overlayLabelsRef.current = toggles.labels ? labels : [];
    placeLabels();
  }, [bars, ready, toggles.labels, toggles.vwap, toggles.ema9, toggles.ema20, toggles.ema50, toggles.ema200, placeLabels]);

  // ── Indicator panes: MACD then RSI, each removed with its last series ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !ready) return;
    for (const s of paneRefs.current) chart.removeSeries(s);
    paneRefs.current = [];
    // Drop any pane left empty (the price pane is index 0).
    for (let i = chart.panes().length - 1; i >= 1; i--) if (chart.panes()[i].getSeries().length === 0) chart.removePane(i);
    if (bars.length < 35) return;
    const pts = (values: (number | null)[]) =>
      bars.map((b, i) => (values[i] === null ? { time: toTime(b.t) } : { time: toTime(b.t), value: values[i] as number }));
    let pane = 1;
    if (toggles.macd) {
      const m = macdSeries(bars.map((b) => b.c));
      const hist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false, title: "" }, pane);
      hist.setData(bars.map((b, i) => (m.histogram[i] === null ? { time: toTime(b.t) } : { time: toTime(b.t), value: m.histogram[i] as number, color: (m.histogram[i] as number) >= 0 ? "#21C98766" : "#F45B6966" })));
      const macdLine = chart.addSeries(LineSeries, { color: CHART_COLORS.macd, lineWidth: 1, priceLineVisible: false, lastValueVisible: toggles.labels, title: toggles.labels ? "MACD" : "", crosshairMarkerVisible: false }, pane);
      macdLine.setData(pts(m.macd));
      const sig = chart.addSeries(LineSeries, { color: CHART_COLORS.signal, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "", crosshairMarkerVisible: false }, pane);
      sig.setData(pts(m.signal));
      paneRefs.current.push(hist, macdLine, sig);
      pane += 1;
    }
    if (toggles.rsi) {
      const r = rsiSeries(bars.map((b) => b.c), 14);
      const line = chart.addSeries(LineSeries, { color: CHART_COLORS.rsi, lineWidth: 1, priceLineVisible: false, lastValueVisible: toggles.labels, title: toggles.labels ? "RSI" : "", crosshairMarkerVisible: false }, pane);
      line.setData(pts(r));
      line.createPriceLine({ price: 70, color: "#2C3D4D", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
      line.createPriceLine({ price: 30, color: "#2C3D4D", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
      paneRefs.current.push(line);
    }
    const panes = chart.panes();
    panes[0]?.setStretchFactor(4);
    for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(1);
  }, [bars, ready, toggles.macd, toggles.rsi, toggles.labels]);

  // ── Horizontal lines ──
  const specs = useMemo<LineSpec[]>(() => {
    const out: LineSpec[] = [];
    const price = bars.length ? bars[bars.length - 1].c : null;
    const planPrices = plan ? [plan.trigger, plan.invalidation, ...plan.targets] : [];
    const onPlanLine = (p: number) => planPrices.some((q) => Math.abs(q - p) / Math.max(1e-9, p) < 0.0015);
    if (toggles.levels) {
      let picked = zones.filter((z) => z.strength >= minStrength && !onPlanLine(z.price));
      if (!toggles.allLevels && price !== null) {
        const above = picked.filter((z) => z.price > price).sort((a, b) => a.price - b.price).slice(0, 1);
        const below = picked.filter((z) => z.price < price).sort((a, b) => b.price - a.price).slice(0, 1);
        picked = [...above, ...below];
      } else picked = picked.slice(0, 12);
      for (const z of picked) {
        const res = z.kind === "resistance";
        out.push({ price: z.price, color: res ? CHART_COLORS.resistance : CHART_COLORS.support, width: z.strength >= 90 ? 2 : 1, style: 1, label: `${res ? "CEILING" : "FLOOR"} ${z.strength}`, priority: 5 });
      }
    }
    if (plan) {
      if (toggles.trigger) out.push({ price: plan.trigger, color: CHART_COLORS.trigger, width: 2, style: 0, label: "TRIGGER", priority: 0 });
      if (toggles.targets) plan.targets.forEach((t, i) => out.push({ price: t, color: CHART_COLORS.target, width: 1, style: 2, label: `T${i + 1}`, priority: 2 }));
      if (toggles.invalidation) out.push({ price: plan.invalidation, color: CHART_COLORS.invalidation, width: 2, style: 2, label: "INVALID", priority: 1 });
    }
    if (session) {
      const s = session;
      const add = (p: number | null, label: string, color: string, style: 0 | 1 | 2 | 3) => { if (p !== null) out.push({ price: p, color, width: 1, style, label, priority: 6 }); };
      if (toggles.prevDay) { add(s.prevHigh, "PDH", CHART_COLORS.session, 0); add(s.prevLow, "PDL", CHART_COLORS.session, 0); }
      if (toggles.premarket) { add(s.premarketHigh, "PMH", CHART_COLORS.sessionFaint, 1); add(s.premarketLow, "PML", CHART_COLORS.sessionFaint, 1); }
      if (toggles.openingRange) { add(s.openingRangeHigh, "ORH", CHART_COLORS.session, 3); add(s.openingRangeLow, "ORL", CHART_COLORS.session, 3); }
    }
    if (myTrade) {
      out.push({ price: myTrade.strike, color: CHART_COLORS.mine, width: 1, style: 0, label: `MY ${myTrade.label}`, priority: 3 });
      out.push({ price: myTrade.breakEven, color: CHART_COLORS.mine, width: 1, style: 2, label: "MY B/E", priority: 4 });
    }
    return out.sort((a, b) => a.priority - b.priority);
  }, [bars, zones, plan, minStrength, toggles.levels, toggles.allLevels, toggles.trigger, toggles.targets, toggles.invalidation, toggles.prevDay, toggles.premarket, toggles.openingRange, session, myTrade]);

  useEffect(() => {
    const candles = candlesRef.current;
    if (!candles || !ready) return;
    for (const l of lineRefs.current) candles.removePriceLine(l);
    lineRefs.current = [];
    for (const s of specs) {
      lineRefs.current.push(candles.createPriceLine({ price: s.price, color: s.color, lineWidth: s.width, lineStyle: s.style, axisLabelVisible: true, title: "" }));
    }
    specsRef.current = toggles.labels ? specs : [];
    placeLabels();
  }, [specs, ready, toggles.labels, placeLabels]);

  // ── Markers where the setup machine changed state ──
  useEffect(() => {
    const m = markersRef.current;
    if (!m || !ready) return;
    if (!toggles.markers || !context.machine || context.machineBars.length === 0 || bars.length === 0) {
      m.setMarkers([]);
      return;
    }
    const want: Record<string, { text: string; color: string; position: "aboveBar" | "belowBar"; shape: "arrowUp" | "arrowDown" | "circle" | "square" }> = {
      TRIGGERED: { text: "BREAK", color: CHART_COLORS.vwap, position: "aboveBar", shape: "circle" },
      CONFIRMED: { text: "CONFIRMED", color: CHART_COLORS.up, position: "belowBar", shape: "arrowUp" },
      RETESTING: { text: "RETEST", color: CHART_COLORS.vwap, position: "aboveBar", shape: "square" },
      CONTINUATION: { text: "HELD", color: CHART_COLORS.up, position: "belowBar", shape: "arrowUp" },
      FAILED: { text: "FAILED", color: CHART_COLORS.down, position: "aboveBar", shape: "arrowDown" },
      INVALIDATED: { text: "INVALID", color: CHART_COLORS.down, position: "aboveBar", shape: "arrowDown" },
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
  }, [bars, context.machine, context.machineBars, toggles.markers, ready]);

  const fit = () => {
    candlesRef.current?.priceScale().applyOptions({ autoScale: true });
    chartRef.current?.timeScale().fitContent();
  };

  return (
    <div className={full ? "fixed inset-0 z-50 bg-bg p-2" : `relative h-full w-full ${className}`} style={!full && height ? { height } : undefined}>
      <div className="absolute right-[4.5rem] top-1.5 z-10 flex items-center gap-0.5">
        <button onClick={fit} className="btn-quiet h-6 px-1" data-tip="Reset view" aria-label="Reset view"><Scan size={12} /></button>
        <button onClick={() => setFull((v) => !v)} className="btn-quiet h-6 px-1" data-tip={full ? "Exit fullscreen" : "Fullscreen"} aria-label="Fullscreen">
          {full ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
        </button>
      </div>
      <div ref={hostRef} className="h-full w-full" />
      {/* Right-edge labels, placed next to the price axis, never over candles. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-[5]" style={{ right: axisW + 2 }}>
        {placed.map((p, i) => (
          <span
            key={`${p.label}:${p.price}:${i}`}
            className="absolute right-0 whitespace-nowrap rounded-sm px-1 font-mono text-2xs font-semibold leading-[13px]"
            style={{ top: p.y - LABEL_H / 2, color: p.color, background: "rgba(13,19,27,0.85)" }}
          >
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}
