// ─────────────────────────────────────────────────────────
// Anchored VWAP for swing analysis.
//
// A true intraday session VWAP needs minute bars (paid data). What we
// CAN compute honestly from daily bars is the Anchored VWAP: the
// volume-weighted average price since a chosen anchor (the recent swing
// low). It answers "what has the average buyer paid since this base
// formed" — the level institutions defend. Price holding above a
// rising anchored VWAP = accumulation intact.
//
// Pure functions over Bar[]; fully unit-testable.
// ─────────────────────────────────────────────────────────

import type { Bar } from "./bars";
import { round2 } from "./scoring";

// Index of the lowest low within the last `lookback` sessions.
export function swingLowIndex(bars: Bar[], lookback = 40): number {
  const start = Math.max(0, bars.length - lookback);
  let idx = start;
  let lo = Infinity;
  for (let i = start; i < bars.length; i++) {
    if (bars[i].l < lo) {
      lo = bars[i].l;
      idx = i;
    }
  }
  return idx;
}

// Volume-weighted average of typical price from anchorIndex to the end.
export function anchoredVwap(bars: Bar[], anchorIndex: number): number {
  let pv = 0;
  let vol = 0;
  for (let i = Math.max(0, anchorIndex); i < bars.length; i++) {
    const b = bars[i];
    const typical = (b.h + b.l + b.c) / 3;
    pv += typical * b.v;
    vol += b.v;
  }
  return vol > 0 ? round2(pv / vol) : bars[bars.length - 1]?.c ?? 0;
}

// Convenience: anchored VWAP from the recent swing low, plus whether it
// is rising (compares the last two sessions' anchored values).
export function swingAnchoredVwap(bars: Bar[], lookback = 40): { value: number; rising: boolean } {
  if (bars.length < 5) return { value: bars[bars.length - 1]?.c ?? 0, rising: false };
  const anchor = swingLowIndex(bars, lookback);
  const value = anchoredVwap(bars, anchor);
  const prev = anchoredVwap(bars.slice(0, -1), Math.min(anchor, bars.length - 2));
  return { value, rising: value >= prev };
}
