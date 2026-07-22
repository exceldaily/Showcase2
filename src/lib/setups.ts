// ─────────────────────────────────────────────────────────
// Setup detection + trade-plan construction, LONG and SHORT.
// Shared by the live scanner and the backtester so detection logic
// can never drift between them. Pure functions over bar arrays:
// no I/O, fully unit-testable.
//
// Every target carries a documented method + evidence string. Every
// stop is structural. Nothing here is random or invented.
// ─────────────────────────────────────────────────────────

import type { Bar } from "./bars";
import type { SnapshotMetrics } from "./polygon";
import { round2 } from "./scoring";

export type Direction = "Long" | "Short";

export interface Detected {
  type: string;
  direction: Direction;
  quality: number; // 0-20 bonus for technical score
}

export interface TargetSpec {
  price: number;
  method: string;
  evidence: string;
}

export interface PlanSpec {
  entryZoneLow: number;
  entryZoneHigh: number;
  entryAggressive: number;
  entryConservative: number;
  stopLoss: number;
  stopBasis: string;
  targets: [TargetSpec, TargetSpec, TargetSpec];
  expectedPctMove: number;
  expectedHoldDays: number;
  riskReward: number; // computed at target 2
}

const MIN_REL_VOLUME_BREAKOUT = 1.3;

// ── Swing structure helpers ──

// Prior swing highs: bars whose high exceeds both neighbors' highs.
export function swingHighs(bars: Bar[], lookback = 60): number[] {
  const start = Math.max(1, bars.length - lookback);
  const out: number[] = [];
  for (let i = start; i < bars.length - 1; i++) {
    if (bars[i].h > bars[i - 1].h && bars[i].h > bars[i + 1].h) out.push(bars[i].h);
  }
  return out;
}

export function swingLows(bars: Bar[], lookback = 60): number[] {
  const start = Math.max(1, bars.length - lookback);
  const out: number[] = [];
  for (let i = start; i < bars.length - 1; i++) {
    if (bars[i].l < bars[i - 1].l && bars[i].l < bars[i + 1].l) out.push(bars[i].l);
  }
  return out;
}

function rangeTightness(bars: Bar[]): number {
  const hi = Math.max(...bars.map((b) => b.h));
  const lo = Math.min(...bars.map((b) => b.l));
  return hi > 0 ? (hi - lo) / hi : 1;
}

// ── Detection ──

export function detectLongSetup(m: SnapshotMetrics, bars: Bar[], isIpo: boolean): Detected | null {
  const last = bars[bars.length - 1];
  const prior = bars.slice(-22, -1);
  if (prior.length < 15) return null;
  const priorHigh = Math.max(...prior.map((b) => b.h));

  // Breakout: close at/above the prior 20d high on expanded volume.
  if (last.c >= priorHigh * 0.998 && m.relVolume >= MIN_REL_VOLUME_BREAKOUT && m.price > m.ema20) {
    const tight = rangeTightness(prior);
    return {
      type: isIpo ? "IPO Base Breakout" : "Breakout",
      direction: "Long",
      quality: tight < 0.08 ? 20 : tight < 0.12 ? 14 : 8,
    };
  }

  // Pullback: uptrend, orderly retreat into the 20 EMA zone, holding.
  const uptrend = m.ema20 > m.ema50 && m.price > m.ema50;
  const nearEma20 = last.l <= m.ema20 * 1.02 && last.c >= m.ema20 * 0.99;
  const healthyRsi = m.rsi14 >= 38 && m.rsi14 <= 62;
  if (uptrend && nearEma20 && healthyRsi) {
    return { type: "Pullback", direction: "Long", quality: 12 };
  }

  return null;
}

export function detectShortSetup(m: SnapshotMetrics, bars: Bar[]): Detected | null {
  const last = bars[bars.length - 1];
  const prior = bars.slice(-22, -1);
  if (prior.length < 15) return null;
  const priorLow = Math.min(...prior.map((b) => b.l));

  // Support Breakdown: close at/below the prior 20d low on volume,
  // with price already under the 20 EMA (trend agreement).
  if (last.c <= priorLow * 1.002 && m.relVolume >= MIN_REL_VOLUME_BREAKOUT && m.price < m.ema20) {
    const tight = rangeTightness(prior);
    return {
      type: "Support Breakdown",
      direction: "Short",
      quality: tight < 0.08 ? 20 : tight < 0.12 ? 14 : 8,
    };
  }

  // Moving-Average Rejection: downtrend, weak bounce into the falling
  // 20 EMA from below, closing back under it.
  const downtrend = m.ema20 < m.ema50 && m.price < m.ema50;
  const taggedEma20 = last.h >= m.ema20 * 0.98 && last.c <= m.ema20 * 1.01;
  const softRsi = m.rsi14 >= 35 && m.rsi14 <= 60;
  if (downtrend && taggedEma20 && softRsi) {
    return { type: "MA Rejection", direction: "Short", quality: 12 };
  }

  return null;
}

// RS Leader Coil: the "hidden bullish stock" detector. A name beating
// SPY by 15%+ over the quarter, holding within 5% of its 60-session
// high, compressed into a tight 10-session range with the trend
// intact. Classic institutional-accumulation footprint BEFORE the
// obvious breakout bar that everyone else sees.
export function detectRsLeader(m: SnapshotMetrics, bars: Bar[], spyBars: Bar[]): Detected | null {
  if (bars.length < 80 || spyBars.length < 80) return null;
  const last = bars[bars.length - 1];
  const p63 = bars[bars.length - 64]?.c;
  const s63 = spyBars[spyBars.length - 64]?.c;
  const spyLast = spyBars[spyBars.length - 1].c;
  if (!p63 || !s63 || p63 <= 0 || s63 <= 0) return null;

  const rs = last.c / p63 / (spyLast / s63);
  if (rs < 1.15) return null;

  const high60 = Math.max(...bars.slice(-60).map((b) => b.h));
  if (last.c < high60 * 0.95) return null;

  if (rangeTightness(bars.slice(-10)) > 0.07) return null;
  if (m.price < m.ema20 || m.ema20 < m.ema50) return null;

  return {
    type: "RS Leader Coil",
    direction: "Long",
    quality: rs >= 1.35 ? 20 : rs >= 1.25 ? 16 : 12,
  };
}

// ── Trade plan with documented targets ──

export interface PlanOptions {
  /** ATR multiple added beyond structure for the stop. The July 2026
   * forward test proved 0.25 sits inside daily noise (19 straight
   * stop-outs, most in one session); the default is set from the
   * stop-width backtest sweep. */
  stopAtrMult?: number;
}

export const DEFAULT_STOP_ATR_MULT = 1.0;

export function buildPlan(
  m: SnapshotMetrics,
  bars: Bar[],
  detected: Detected,
  opts: PlanOptions = {}
): PlanSpec | null {
  const mult = opts.stopAtrMult ?? DEFAULT_STOP_ATR_MULT;
  const price = m.price;
  const atr = m.atr14;
  if (atr <= 0 || price <= 0) return null;
  const last = bars[bars.length - 1];

  if (detected.direction === "Long") {
    const entry = round2(price);
    const stop = round2(Math.min(last.l, m.ema20) - mult * atr);
    const risk = entry - stop;
    if (risk <= 0 || risk / price > 0.15) return null;

    // Target 1: nearest prior swing-high resistance above entry when one
    // exists within a reachable band; otherwise 2R.
    const highs = swingHighs(bars).filter((h) => h > entry * 1.01 && h < entry * 1.2);
    const t1 = highs.length
      ? {
          price: round2(Math.min(...highs)),
          method: "Prior resistance",
          evidence: `Nearest swing high above entry from the last 60 sessions (${highs.length} level${highs.length > 1 ? "s" : ""} identified).`,
        }
      : {
          price: round2(entry + 2 * risk),
          method: "2R risk multiple",
          evidence: "No clean resistance within 20% of entry; target set at 2x the defined risk.",
        };

    // Target 2: measured move for breakouts, 3.2R otherwise.
    const prior = bars.slice(-22, -1);
    const rangeHeight = Math.max(...prior.map((b) => b.h)) - Math.min(...prior.map((b) => b.l));
    const isBreakout = detected.type.includes("Breakout");
    const t2 = isBreakout
      ? {
          price: round2(entry + rangeHeight),
          method: "Measured move (range projection)",
          evidence: `Breakout level plus the ${round2(rangeHeight)} height of the 20-session base.`,
        }
      : {
          price: round2(entry + 3.2 * risk),
          method: "3.2R risk multiple",
          evidence: "Continuation target at 3.2x defined risk, consistent with the platform R/R gate.",
        };

    const t3 = {
      price: round2(entry + 5 * risk),
      method: "Trend extension (5R)",
      evidence: "Runner target at 5x defined risk; only reached in sustained trends.",
    };

    // Guarantee ordering T1 < T2 < T3; if resistance sits above the
    // measured move, swap so the card reads sensibly.
    const ordered = [t1, t2].sort((a, b) => a.price - b.price) as [TargetSpec, TargetSpec];

    const rr = round2((ordered[1].price - entry) / risk);
    return {
      entryZoneLow: round2(entry * 0.995),
      entryZoneHigh: round2(entry * 1.01),
      entryAggressive: round2(price * 1.005),
      entryConservative: entry,
      stopLoss: stop,
      stopBasis: `Below the signal-day low / 20 EMA minus ${mult} ATR`,
      targets: [ordered[0], ordered[1], t3],
      expectedPctMove: round2(((ordered[1].price - entry) / entry) * 100),
      expectedHoldDays: atr / price > 0.035 ? 6 : 12,
      riskReward: rr,
    };
  }

  // Short plan (mirrored)
  const entry = round2(price);
  const stop = round2(Math.max(last.h, m.ema20) + mult * atr);
  const risk = stop - entry;
  if (risk <= 0 || risk / price > 0.15) return null;

  const lows = swingLows(bars).filter((l) => l < entry * 0.99 && l > entry * 0.8);
  const t1 = lows.length
    ? {
        price: round2(Math.max(...lows)),
        method: "Prior support",
        evidence: `Nearest swing low below entry from the last 60 sessions (${lows.length} level${lows.length > 1 ? "s" : ""} identified).`,
      }
    : {
        price: round2(entry - 2 * risk),
        method: "2R risk multiple",
        evidence: "No clean support within 20% below entry; target set at 2x the defined risk.",
      };
  const prior = bars.slice(-22, -1);
  const rangeHeight = Math.max(...prior.map((b) => b.h)) - Math.min(...prior.map((b) => b.l));
  const isBreakdown = detected.type.includes("Breakdown");
  const t2 = isBreakdown
    ? {
        price: round2(entry - rangeHeight),
        method: "Measured move (range projection)",
        evidence: `Breakdown level minus the ${round2(rangeHeight)} height of the 20-session range.`,
      }
    : {
        price: round2(entry - 3.2 * risk),
        method: "3.2R risk multiple",
        evidence: "Continuation target at 3.2x defined risk, consistent with the platform R/R gate.",
      };
  const t3 = {
    price: round2(entry - 5 * risk),
    method: "Trend extension (5R)",
    evidence: "Runner target at 5x defined risk; only reached in sustained downtrends.",
  };
  const ordered = [t1, t2].sort((a, b) => b.price - a.price) as [TargetSpec, TargetSpec];

  const rr = round2((entry - ordered[1].price) / risk);
  return {
    entryZoneLow: round2(entry * 0.99),
    entryZoneHigh: round2(entry * 1.005),
    entryAggressive: round2(price * 0.995),
    entryConservative: entry,
    stopLoss: stop,
    stopBasis: `Above the signal-day high / 20 EMA plus ${mult} ATR`,
    targets: [ordered[0], ordered[1], t3],
    expectedPctMove: round2(((entry - ordered[1].price) / entry) * 100),
    expectedHoldDays: atr / price > 0.035 ? 6 : 12,
    riskReward: rr,
  };
}
