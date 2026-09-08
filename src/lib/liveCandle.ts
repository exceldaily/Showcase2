// ─────────────────────────────────────────────────────────
// Live candle patching (pure, unit-tested).
// Between bar refreshes the chart gets a 2-second quote; this folds
// that quote into the current candle (or opens a new one when the
// quote falls into a fresh time bucket) so the chart moves with the
// tape instead of stepping every refresh.
// ─────────────────────────────────────────────────────────

import type { Bar } from "./bars";

export interface LiveQuote {
  t: number;      // trade timestamp (ms)
  price: number;
}

/**
 * Returns the candle the chart should draw for the quote, or null when the
 * quote is older than the last bar (nothing to change). `bucketMs` is the
 * chart timeframe in ms; null (daily/weekly) just patches the last bar.
 */
export function liveCandle(bars: Bar[], q: LiveQuote, bucketMs: number | null): Bar | null {
  if (bars.length === 0 || !(q.price > 0)) return null;
  const last = bars[bars.length - 1];
  if (q.t < last.t) return null;
  const inLast = bucketMs === null || q.t < last.t + bucketMs;
  if (inLast) {
    return { ...last, h: Math.max(last.h, q.price), l: Math.min(last.l, q.price), c: q.price };
  }
  const start = Math.floor(q.t / bucketMs!) * bucketMs!;
  return { t: start, o: q.price, h: q.price, l: q.price, c: q.price, v: 0, vw: q.price };
}

/** How old a quote may be before it is flagged, by session (premarket prints are sparse). */
export function quoteStaleMs(session: string): number {
  return session === "rth" ? 10_000 : 90_000;
}
