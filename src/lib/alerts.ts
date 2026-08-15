// ─────────────────────────────────────────────────────────
// Breakout radar. The "about to break and shoot up" engine, built on
// EMA 9/20/50 alignment + anchored VWAP + volatility compression under
// a defined resistance lid.
//
// Timeframe honesty: this reads daily closes. "Primed" means the coil
// is set as of the last close — actionable at the next open, a swing
// signal, not an intraday scalp trigger. Real-time intraday alerts
// need a paid tick feed.
// ─────────────────────────────────────────────────────────

import type { Bar } from "./bars";
import type { SnapshotMetrics } from "./polygon";
import { swingHighs } from "./setups";
import { swingAnchoredVwap } from "./vwap";
import { round2 } from "./scoring";

export type AlertType = "Primed" | "Breakout" | "EMA Reclaim";

export interface AlertSignal {
  type: AlertType;
  symbol: string;
  price: number;
  resistance: number | null;
  vwap: number;
  distanceToBreakoutPct: number; // how far below the lid, 0 = through it
  coilTightnessPct: number; // range of the coil as % of price
  message: string;
  strength: number; // 0-100 how textbook the setup is
}

// The nearest untested resistance: lowest swing high that still sits
// above the current price (the lid the coil is pressing into).
function nearestResistanceAbove(bars: Bar[], price: number): number | null {
  const highs = swingHighs(bars, 60).filter((h) => h > price * 1.001);
  return highs.length ? Math.min(...highs) : null;
}

function coilTightness(bars: Bar[], win = 8): number {
  const seg = bars.slice(-win);
  const hi = Math.max(...seg.map((b) => b.h));
  const lo = Math.min(...seg.map((b) => b.l));
  const mid = (hi + lo) / 2;
  return mid > 0 ? (hi - lo) / mid : 1;
}

// ── Primed: coiled and ready to break ──
// EMA 9 > 20 > 50 (momentum stacked), price above the stack AND above a
// rising anchored VWAP (accumulation intact), squeezed into a tight
// range within striking distance below a real resistance level.
export function detectPrimed(m: SnapshotMetrics, bars: Bar[]): AlertSignal | null {
  if (bars.length < 55) return null;

  const stacked = m.ema9 > m.ema20 && m.ema20 > m.ema50 && m.price >= m.ema9 * 0.99;
  if (!stacked) return null;

  const { value: avwap, rising } = swingAnchoredVwap(bars, 40);
  if (m.price < avwap || !rising) return null;

  const resistance = nearestResistanceAbove(bars, m.price);
  if (resistance === null) return null;

  const distPct = ((resistance - m.price) / m.price) * 100;
  // Coiling into the lid: within 6% below it, not already blown past.
  if (distPct > 6 || distPct < 0) return null;

  const tight = coilTightness(bars, 8);
  if (tight > 0.09) return null; // range too wide = not a coil

  // Volume should not be collapsing into the coil (accumulation, not apathy).
  if (m.relVolume < 0.6) return null;

  // Strength: tighter coil + closer to the lid + healthy RSI = higher.
  let strength = 40;
  if (tight < 0.04) strength += 22;
  else if (tight < 0.06) strength += 14;
  else strength += 6;
  if (distPct < 2) strength += 20;
  else if (distPct < 4) strength += 12;
  else strength += 4;
  if (m.rsi14 >= 50 && m.rsi14 <= 68) strength += 12;
  if (m.above200d) strength += 6;
  strength = Math.min(100, strength);

  return {
    type: "Primed",
    symbol: m.symbol,
    price: m.price,
    resistance: round2(resistance),
    vwap: avwap,
    distanceToBreakoutPct: round2(distPct),
    coilTightnessPct: round2(tight * 100),
    strength,
    message: `Coiled ${round2(distPct)}% under $${round2(resistance)} resistance. EMA 9>20>50 stacked, holding above rising anchored VWAP ($${avwap}). A close above the lid on volume is the trigger.`,
  };
}

// ── Breakout: the lid just gave way ──
// Price closed above the recent 20-session high on expanded volume with
// the EMA stack intact. This is the confirmation the Primed coil fired.
export function detectBreakout(m: SnapshotMetrics, bars: Bar[]): AlertSignal | null {
  if (bars.length < 55) return null;
  const stacked = m.ema9 > m.ema20 && m.ema20 > m.ema50;
  if (!stacked) return null;

  const prior = bars.slice(-21, -1);
  if (prior.length < 15) return null;
  const priorHigh = Math.max(...prior.map((b) => b.h));
  const last = bars[bars.length - 1];

  const brokeOut = last.c > priorHigh && m.relVolume >= 1.5;
  if (!brokeOut) return null;

  const { value: avwap } = swingAnchoredVwap(bars, 40);
  if (m.price < avwap) return null;

  let strength = 55;
  if (m.relVolume >= 3) strength += 25;
  else if (m.relVolume >= 2) strength += 15;
  else strength += 8;
  const pushThrough = ((last.c - priorHigh) / priorHigh) * 100;
  if (pushThrough > 0.5 && pushThrough < 6) strength += 15; // clean break, not exhausted
  if (m.above200d) strength += 5;
  strength = Math.min(100, strength);

  return {
    type: "Breakout",
    symbol: m.symbol,
    price: m.price,
    resistance: round2(priorHigh),
    vwap: avwap,
    distanceToBreakoutPct: 0,
    coilTightnessPct: round2(coilTightness(bars, 8) * 100),
    strength,
    message: `Broke out above the $${round2(priorHigh)} 20-session high on ${m.relVolume}x volume, EMA stack aligned, above anchored VWAP ($${avwap}). Breakout confirmed as of the close.`,
  };
}

export function detectAlerts(m: SnapshotMetrics, bars: Bar[]): AlertSignal[] {
  const out: AlertSignal[] = [];
  const breakout = detectBreakout(m, bars);
  if (breakout) out.push(breakout);
  else {
    const primed = detectPrimed(m, bars);
    if (primed) out.push(primed);
  }
  return out;
}
