// ─────────────────────────────────────────────────────────
// Stock detail assembly (spec §23) + chart payload.
// Every field carries provenance: a value, or an explicit
// "unavailable" reason. Nothing is invented.
// ─────────────────────────────────────────────────────────

import { loadBars, type Bar } from "./bars";
import { query } from "./db";
import { computeMetricsFromBars } from "./polygon";
import { swingAnchoredVwap } from "./vwap";
import {
  atrSeries,
  detectExtension,
  emaSeries,
  findLevels,
  macdSeries,
  rsiSeries,
  vwapSeries,
  type ExtensionRead,
  type Level,
} from "./indicators";
import { round2 } from "./scoring";
import { polygonCapabilities } from "@/providers/polygonProvider";
import type { Timeframe } from "@/providers/marketData";

export interface FieldValue<T = number | string | boolean> {
  value: T | null;
  /** Why it's missing, when it is. */
  unavailable?: string;
}

export interface StockDetail {
  symbol: string;
  company: string | null;
  sector: string | null;
  industry: string | null;
  exchange: string | null;

  price: FieldValue<number>;
  changePct: FieldValue<number>;
  gapPct: FieldValue<number>;
  prevClose: FieldValue<number>;
  dayHigh: FieldValue<number>;
  dayLow: FieldValue<number>;
  volume: FieldValue<number>;
  avgVolume: FieldValue<number>;
  rvol: FieldValue<number>;
  dollarVolume: FieldValue<number>;
  marketCap: FieldValue<number>;
  sharesOutstanding: FieldValue<number>;
  floatShares: FieldValue<number>;
  bid: FieldValue<number>;
  ask: FieldValue<number>;
  spreadPct: FieldValue<number>;
  premarketHigh: FieldValue<number>;
  premarketLow: FieldValue<number>;
  halted: FieldValue<boolean>;

  week52High: FieldValue<number>;
  week52Low: FieldValue<number>;
  atr: FieldValue<number>;
  atrPct: FieldValue<number>;
  rsi: FieldValue<number>;
  vwap: FieldValue<number>;
  vwapDistancePct: FieldValue<number>;
  ema9: FieldValue<number>;
  ema20: FieldValue<number>;
  ema50: FieldValue<number>;
  emaState: FieldValue<string>;
  macdState: FieldValue<string>;

  extension: ExtensionRead | null;
  levels: Level[];
  barDate: string | null;
  dataQuality: string;
}

const NEEDS_INTRADAY = "Requires intraday minute bars (paid data plan).";
const NEEDS_QUOTES = "Requires real-time quotes (paid data plan).";
const NEEDS_FLOAT = "Requires float / shares-outstanding reference data.";
const NEEDS_HALTS = "Requires real-time halt status.";

function v<T>(value: T | null | undefined): FieldValue<T> {
  return value === null || value === undefined ? { value: null } : { value };
}
function na<T = number>(reason: string): FieldValue<T> {
  return { value: null as T | null, unavailable: reason };
}

export interface ChartPayload {
  bars: { t: number; o: number; h: number; l: number; c: number; v: number }[];
  overlays: {
    vwap: (number | null)[];
    ema9: (number | null)[];
    ema20: (number | null)[];
    ema50: (number | null)[];
    ema200: (number | null)[];
    macd: { macd: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[] };
    rsi: (number | null)[];
    levels: Level[];
    prevClose: number | null;
  };
}

export function buildChartPayload(bars: Bar[]): ChartPayload {
  const closes = bars.map((b) => b.c);
  return {
    bars: bars.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })),
    overlays: {
      vwap: vwapSeries(bars),
      ema9: emaSeries(closes, 9),
      ema20: emaSeries(closes, 20),
      ema50: emaSeries(closes, 50),
      ema200: emaSeries(closes, 200),
      macd: macdSeries(closes),
      rsi: rsiSeries(closes),
      levels: findLevels(bars),
      prevClose: bars.length >= 2 ? bars[bars.length - 2].c : null,
    },
  };
}

export async function getStockDetail(symbol: string): Promise<{ detail: StockDetail; chart: ChartPayload } | null> {
  const sym = symbol.toUpperCase();
  const caps = polygonCapabilities();

  const refRows = await query<{
    symbol: string;
    company_name: string | null;
    sector: string | null;
    industry: string | null;
    exchange: string | null;
    market_cap: string | null;
    shares_outstanding: string | null;
    float_shares: string | null;
  }>(
    `select symbol, company_name, sector, industry, exchange, market_cap, shares_outstanding, float_shares
     from tickers where symbol = $1 or symbol = $2 limit 1`,
    [sym, `X:${sym}`]
  );
  const ref = refRows[0];

  const barsMap = await loadBars([ref?.symbol ?? sym], 260);
  const bars = barsMap.get(ref?.symbol ?? sym) ?? [];
  if (bars.length < 30) return null;

  const m = computeMetricsFromBars(sym, bars);
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const closes = bars.map((b) => b.c);

  const { value: avwap } = swingAnchoredVwap(bars, 40);
  const atrArr = atrSeries(bars, 14);
  const atr = atrArr[atrArr.length - 1];
  const window52 = bars.slice(-252);

  const emaState =
    m.ema9 > m.ema20 && m.ema20 > m.ema50
      ? "9 > 20 > 50 (stacked)"
      : m.ema9 > m.ema20
        ? "9 > 20"
        : m.price < m.ema20 && m.ema9 < m.ema20
          ? "Breakdown"
          : "9 < 20";

  const macd = macdSeries(closes);
  const mi = macd.macd.length - 1;
  const macdState =
    macd.macd[mi] !== null && macd.signal[mi] !== null
      ? (macd.macd[mi] as number) > (macd.signal[mi] as number)
        ? (macd.histogram[mi] as number) > (macd.histogram[mi - 1] ?? 0)
          ? "Bullish, expanding"
          : "Bullish, contracting"
        : "Bearish"
      : null;

  const detail: StockDetail = {
    symbol: sym,
    company: ref?.company_name ?? null,
    sector: ref?.sector ?? null,
    industry: ref?.industry ?? null,
    exchange: ref?.exchange ?? null,

    price: v(m.price),
    changePct: v(prev && prev.c > 0 ? round2(((last.c - prev.c) / prev.c) * 100) : null),
    gapPct: v(prev && prev.c > 0 ? round2(((last.o - prev.c) / prev.c) * 100) : null),
    prevClose: v(prev?.c ?? null),
    dayHigh: v(last.h),
    dayLow: v(last.l),
    volume: v(last.v),
    avgVolume: v(Math.round(m.avgVolume)),
    rvol: v(m.relVolume),
    dollarVolume: v(Math.round(m.price * last.v)),
    marketCap: v(ref?.market_cap ? Number(ref.market_cap) : null),
    sharesOutstanding: v(ref?.shares_outstanding ? Number(ref.shares_outstanding) : null),
    floatShares: caps.floatData ? v<number>(ref?.float_shares ? Number(ref.float_shares) : null) : na<number>(NEEDS_FLOAT),
    bid: caps.quotes ? v<number>(null) : na<number>(NEEDS_QUOTES),
    ask: caps.quotes ? v<number>(null) : na<number>(NEEDS_QUOTES),
    spreadPct: caps.quotes ? v<number>(null) : na<number>(NEEDS_QUOTES),
    premarketHigh: caps.premarket ? v<number>(null) : na<number>(NEEDS_INTRADAY),
    premarketLow: caps.premarket ? v<number>(null) : na<number>(NEEDS_INTRADAY),
    halted: caps.halts ? v<boolean>(false) : na<boolean>(NEEDS_HALTS),

    week52High: v(window52.length ? round2(Math.max(...window52.map((b) => b.h))) : null),
    week52Low: v(window52.length ? round2(Math.min(...window52.map((b) => b.l))) : null),
    atr: v(atr),
    atrPct: v(atr && m.price > 0 ? round2((atr / m.price) * 100) : null),
    rsi: v(m.rsi14),
    vwap: v(avwap),
    vwapDistancePct: v(avwap > 0 ? round2(((m.price - avwap) / avwap) * 100) : null),
    ema9: v(m.ema9),
    ema20: v(m.ema20),
    ema50: v(m.ema50),
    emaState: v(emaState),
    macdState: v(macdState),

    extension: detectExtension(bars),
    levels: findLevels(bars),
    barDate: new Date(last.t).toISOString().slice(0, 10),
    dataQuality: caps.quality,
  };

  return { detail, chart: buildChartPayload(bars) };
}

/** Timeframes the current plan can actually serve (spec §16). */
export function availableTimeframes(): { tf: Timeframe; label: string; enabled: boolean }[] {
  const caps = polygonCapabilities();
  const all: { tf: Timeframe; label: string }[] = [
    { tf: "1m", label: "1m" }, { tf: "5m", label: "5m" }, { tf: "15m", label: "15m" },
    { tf: "30m", label: "30m" }, { tf: "1h", label: "1H" }, { tf: "1d", label: "D" },
    { tf: "1w", label: "W" },
  ];
  return all.map((t) => ({ ...t, enabled: caps.timeframes.includes(t.tf) }));
}
