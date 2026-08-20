// ─────────────────────────────────────────────────────────
// Metric snapshot builder.
// Turns cached bars + reference data into the flat row the scanner
// rule engine and column system consume. Fields the current provider
// cannot supply are left UNDEFINED (never zero, never invented) so
// rules fail closed and the UI can show DATA UNAVAILABLE.
// ─────────────────────────────────────────────────────────

import type { Bar } from "./bars";
import { computeMetricsFromBars } from "./polygon";
import { swingAnchoredVwap } from "./vwap";
import { round2 } from "./scoring";
import type { MetricRow } from "./scannerRules";

export interface TickerRef {
  symbol: string;
  company_name?: string | null;
  sector?: string | null;
  industry?: string | null;
  exchange?: string | null;
  market_cap?: number | null;
  shares_outstanding?: number | null;
  float_shares?: number | null;
}

function emaState(m: { ema9: number; ema20: number; ema50: number; price: number }): string {
  const { ema9, ema20, ema50, price } = m;
  const spread = ema20 > 0 ? Math.abs(ema9 - ema20) / ema20 : 1;
  if (spread < 0.005) return "Compressed";
  if (ema9 > ema20 && ema20 > ema50) return "9>20>50";
  if (ema9 > ema20) return "9>20";
  if (price < ema20 && ema9 < ema20) return "Breakdown";
  return "9<20";
}

function macdParts(closes: number[]): { line: number; signal: number; hist: number; state: string } {
  const emaAt = (vals: number[], period: number) => {
    if (vals.length === 0) return 0;
    const k = 2 / (period + 1);
    let e = vals[0];
    for (let i = 1; i < vals.length; i++) e = vals[i] * k + e * (1 - k);
    return e;
  };
  if (closes.length < 35) return { line: 0, signal: 0, hist: 0, state: "Below Zero" };

  // Build the MACD line series so the signal line is a real EMA of it.
  const lineSeries: number[] = [];
  for (let i = 26; i <= closes.length; i++) {
    const slice = closes.slice(0, i);
    lineSeries.push(emaAt(slice, 12) - emaAt(slice, 26));
  }
  const line = lineSeries[lineSeries.length - 1];
  const signal = emaAt(lineSeries, 9);
  const hist = line - signal;

  const prevLine = lineSeries[lineSeries.length - 2] ?? line;
  const prevSignal = emaAt(lineSeries.slice(0, -1), 9);
  const prevHist = prevLine - prevSignal;

  let state: string;
  if (prevLine <= prevSignal && line > signal) state = "Bullish Cross";
  else if (prevLine >= prevSignal && line < signal) state = "Bearish Cross";
  else if (Math.abs(hist) > Math.abs(prevHist)) state = hist > 0 ? "Expanding" : "Contracting";
  else state = line > 0 ? "Above Zero" : "Below Zero";

  return { line: round2(line), signal: round2(signal), hist: round2(hist), state };
}

function coilTightnessPct(bars: Bar[], win = 8): number {
  const seg = bars.slice(-win);
  if (seg.length < 2) return 100;
  const hi = Math.max(...seg.map((b) => b.h));
  const lo = Math.min(...seg.map((b) => b.l));
  const mid = (hi + lo) / 2;
  return mid > 0 ? round2(((hi - lo) / mid) * 100) : 100;
}

/**
 * Build one scanner row. `caps` gates which fields are populated so we
 * never fabricate intraday/quote/float values on an EOD-only feed.
 */
export function buildMetricRow(
  ref: TickerRef,
  bars: Bar[],
  caps: { intraday: boolean; quotes: boolean; floatData: boolean; halts: boolean }
): MetricRow | null {
  if (bars.length < 30) return null;
  const m = computeMetricsFromBars(ref.symbol, bars);
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const closes = bars.map((b) => b.c);

  const { value: avwap } = swingAnchoredVwap(bars, 40);
  const vwapDistancePct = avwap > 0 ? round2(((m.price - avwap) / avwap) * 100) : undefined;

  // VWAP state from EOD structure: a reclaim is crossing back above.
  let vwapState: string | undefined;
  if (vwapDistancePct !== undefined && prev) {
    const prevAbove = prev.c >= avwap;
    const nowAbove = m.price >= avwap;
    if (!prevAbove && nowAbove) vwapState = "Reclaim";
    else if (prevAbove && !nowAbove) vwapState = "Rejection";
    else vwapState = nowAbove ? "Above" : "Below";
  }

  const macd = macdParts(closes);
  const gapPct = prev && prev.c > 0 ? round2(((last.o - prev.c) / prev.c) * 100) : undefined;
  const changePct = prev && prev.c > 0 ? round2(((last.c - prev.c) / prev.c) * 100) : undefined;

  const row: MetricRow = {
    symbol: ref.symbol.replace(/^X:/, ""),
    company: ref.company_name ?? undefined,
    price: m.price,
    changePct,
    gapPct,
    volume: last.v,
    avgVolume: Math.round(m.avgVolume),
    rvol: m.relVolume,
    dollarVolume: Math.round(m.price * last.v),
    ema9: m.ema9,
    ema20: m.ema20,
    ema50: m.ema50,
    emaState: emaState(m),
    rsi14: m.rsi14,
    atr14: m.atr14,
    atrPct: m.price > 0 ? round2((m.atr14 / m.price) * 100) : undefined,
    macdState: macd.state,
    macdHist: macd.hist,
    aboveSma200: m.above200d,
    coilPct: coilTightnessPct(bars),
    vwapDistancePct,
    vwapState,
    sector: ref.sector ?? undefined,
    industry: ref.industry ?? undefined,
    exchange: ref.exchange ?? undefined,
    marketCap: ref.market_cap ?? undefined,
    sharesOutstanding: ref.shares_outstanding ?? undefined,
  };

  // Entitlement-gated fields: present ONLY when the provider supplies them.
  if (caps.floatData && ref.float_shares != null) row.floatShares = ref.float_shares;
  // intraday / quotes / halts fields intentionally omitted on EOD feeds:
  // hodDistancePct, premarketVolume, volumeAcceleration, spreadPct, halted...

  return row;
}

/** Float bucket label using user-configurable thresholds (spec §12). */
export function floatCategory(
  floatShares: number | undefined,
  th = { ultraLow: 5_000_000, low: 20_000_000, moderate: 50_000_000 }
): string {
  if (floatShares === undefined || floatShares === null) return "UNKNOWN";
  if (floatShares < th.ultraLow) return "ULTRA LOW FLOAT";
  if (floatShares < th.low) return "LOW FLOAT";
  if (floatShares < th.moderate) return "MODERATE FLOAT";
  return "HIGHER FLOAT";
}
