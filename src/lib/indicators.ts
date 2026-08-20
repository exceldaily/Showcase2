// ─────────────────────────────────────────────────────────
// Indicator series engine (spec §6, §10, §11, §26).
//
// Returns full SERIES (not just the latest value) so charts can plot
// overlays and panes. All pure functions over Bar[]; unit-tested.
// Values before an indicator has enough history are null — charts skip
// them rather than drawing a fabricated flat line.
// ─────────────────────────────────────────────────────────

import type { Bar } from "./bars";
import { round2 } from "./scoring";

export type Series = (number | null)[];

/** Exponential moving average series. */
export function emaSeries(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  // Seed with the SMA of the first `period` values (standard practice).
  let acc = 0;
  for (let i = 0; i < period; i++) acc += values[i];
  let e = acc / period;
  out[period - 1] = round2(e);
  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out[i] = round2(e);
  }
  return out;
}

/** Simple moving average series. */
export function smaSeries(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = round2(sum / period);
  }
  return out;
}

export interface MacdSeries {
  macd: Series;
  signal: Series;
  histogram: Series;
}

/** MACD 12/26/9 by default (spec §10), fully configurable. */
export function macdSeries(values: number[], fast = 12, slow = 26, signalPeriod = 9): MacdSeries {
  const fastE = emaSeries(values, fast);
  const slowE = emaSeries(values, slow);
  const macd: Series = values.map((_, i) =>
    fastE[i] !== null && slowE[i] !== null ? round2((fastE[i] as number) - (slowE[i] as number)) : null
  );

  // Signal = EMA of the MACD line, computed only over its defined portion.
  const defined = macd.filter((v): v is number => v !== null);
  const sigDefined = emaSeries(defined, signalPeriod);
  const firstIdx = macd.findIndex((v) => v !== null);
  const signal: Series = new Array(values.length).fill(null);
  if (firstIdx >= 0) {
    for (let i = 0; i < sigDefined.length; i++) signal[firstIdx + i] = sigDefined[i];
  }

  const histogram: Series = values.map((_, i) =>
    macd[i] !== null && signal[i] !== null ? round2((macd[i] as number) - (signal[i] as number)) : null
  );

  return { macd, signal, histogram };
}

/** Wilder-smoothed RSI series. */
export function rsiSeries(values: number[], period = 14): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = round2(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = round2(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return out;
}

/** True-range based ATR series (Wilder smoothing). */
export function atrSeries(bars: Bar[], period = 14): Series {
  const out: Series = new Array(bars.length).fill(null);
  if (bars.length <= period) return out;

  const trs: number[] = [0];
  for (let i = 1; i < bars.length; i++) {
    const c = bars[i];
    const p = bars[i - 1];
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }

  let acc = 0;
  for (let i = 1; i <= period; i++) acc += trs[i];
  let atr = acc / period;
  out[period] = round2(atr);
  for (let i = period + 1; i < bars.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
    out[i] = round2(atr);
  }
  return out;
}

export interface BollingerSeries {
  upper: Series;
  middle: Series;
  lower: Series;
}

export function bollingerSeries(values: number[], period = 20, mult = 2): BollingerSeries {
  const middle = smaSeries(values, period);
  const upper: Series = new Array(values.length).fill(null);
  const lower: Series = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const seg = values.slice(i - period + 1, i + 1);
    const mean = seg.reduce((a, b) => a + b, 0) / period;
    const sd = Math.sqrt(seg.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    upper[i] = round2(mean + mult * sd);
    lower[i] = round2(mean - mult * sd);
  }
  return { upper, middle, lower };
}

/** Rolling anchored-VWAP series for chart overlay (anchored at index 0 of the window). */
export function vwapSeries(bars: Bar[]): Series {
  const out: Series = new Array(bars.length).fill(null);
  let pv = 0;
  let vol = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const typical = (b.h + b.l + b.c) / 3;
    pv += typical * b.v;
    vol += b.v;
    out[i] = vol > 0 ? round2(pv / vol) : null;
  }
  return out;
}

// ── Support / resistance zones (spec §16 chart drawings) ──
export interface Level {
  price: number;
  kind: "resistance" | "support";
  touches: number;
}

/**
 * Cluster swing pivots into levels. Zones, not false-precision pennies:
 * pivots within `tolPct` of each other merge and count as touches.
 */
export function findLevels(bars: Bar[], lookback = 120, tolPct = 0.015): Level[] {
  const seg = bars.slice(-lookback);
  const last = seg[seg.length - 1]?.c ?? 0;
  const pivots: { p: number; kind: "resistance" | "support" }[] = [];

  for (let i = 2; i < seg.length - 2; i++) {
    const h = seg[i].h;
    const l = seg[i].l;
    if (h > seg[i - 1].h && h > seg[i - 2].h && h > seg[i + 1].h && h > seg[i + 2].h) {
      pivots.push({ p: h, kind: "resistance" });
    }
    if (l < seg[i - 1].l && l < seg[i - 2].l && l < seg[i + 1].l && l < seg[i + 2].l) {
      pivots.push({ p: l, kind: "support" });
    }
  }

  const clusters: Level[] = [];
  for (const piv of pivots) {
    const hit = clusters.find((c) => Math.abs(c.price - piv.p) / piv.p < tolPct);
    if (hit) {
      hit.price = round2((hit.price * hit.touches + piv.p) / (hit.touches + 1));
      hit.touches++;
    } else {
      clusters.push({ price: round2(piv.p), kind: piv.kind, touches: 1 });
    }
  }

  // Relabel by position relative to current price, prefer well-tested levels.
  return clusters
    .map((c) => ({ ...c, kind: (c.price >= last ? "resistance" : "support") as Level["kind"] }))
    .filter((c) => c.touches >= 2)
    .sort((a, b) => Math.abs(a.price - last) - Math.abs(b.price - last))
    .slice(0, 8);
}

// ── Extension detection (spec §26) ──
export type ExtensionState = "Normal" | "Extended" | "Very Extended" | "Parabolic";

export interface ExtensionRead {
  state: ExtensionState;
  atrExtension: number;   // distance above EMA9 in ATRs
  pctAboveEma9: number;
  pct5BarMove: number;
  note: string;
}

/**
 * A stock can be strongly bullish AND a poor place to chase. This
 * measures how stretched price is from its own structure.
 */
export function detectExtension(bars: Bar[]): ExtensionRead | null {
  if (bars.length < 25) return null;
  const closes = bars.map((b) => b.c);
  const ema9 = emaSeries(closes, 9);
  const atr = atrSeries(bars, 14);
  const i = bars.length - 1;
  const e9 = ema9[i];
  const a = atr[i];
  const price = closes[i];
  if (e9 === null || a === null || a <= 0) return null;

  const atrExtension = round2((price - e9) / a);
  const pctAboveEma9 = round2(((price - e9) / e9) * 100);
  const back5 = closes[i - 5] ?? closes[0];
  const pct5BarMove = round2(((price - back5) / back5) * 100);

  let state: ExtensionState = "Normal";
  if (atrExtension >= 4 || pct5BarMove >= 35) state = "Parabolic";
  else if (atrExtension >= 2.5 || pct5BarMove >= 20) state = "Very Extended";
  else if (atrExtension >= 1.5 || pct5BarMove >= 12) state = "Extended";

  const notes: Record<ExtensionState, string> = {
    Normal: "Price is within a normal distance of its short-term structure.",
    Extended: "Stretched from the 9 EMA. Entries here carry wider risk; waiting for structure is common practice.",
    "Very Extended": "Well beyond typical range from structure. Chasing risks buying into a mean-reversion move.",
    Parabolic: "Vertical move far from structure. Historically these resolve violently in either direction.",
  };

  return { state, atrExtension, pctAboveEma9, pct5BarMove, note: notes[state] };
}
