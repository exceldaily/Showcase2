// ─────────────────────────────────────────────────────────
// Live regime builder.
// Pulls SPY/QQQ trend from Polygon and VIX from FRED, then runs the
// pure classifier in regime.ts. Returns null if data isn't available
// (no keys / API failure) so callers can fall back to mock.
// ─────────────────────────────────────────────────────────

import { getVix, hasFredKey } from "./fred";
import { getSnapshotMetrics, hasPolygonKey } from "./polygon";
import { buildRegimeSnapshot, type RegimeInputs } from "./regime";
import type { RegimeSnapshot } from "./types";

export function canBuildLiveRegime(): boolean {
  return hasPolygonKey() && hasFredKey();
}

export async function buildLiveRegime(): Promise<RegimeSnapshot | null> {
  if (!canBuildLiveRegime()) return null;

  const [spy, qqq, vix] = await Promise.all([
    getSnapshotMetrics("SPY"),
    getSnapshotMetrics("QQQ"),
    getVix(),
  ]);

  if (!spy || !qqq || vix === null) return null;

  // Breadth and weekly change are approximated here until the breadth
  // engine (advancers/decliners) lands in Week 2. SPY 5-day change is a
  // reasonable proxy for the weekly move in the meantime.
  const spyWeekChangePct = estimateWeekChange(spy.price, spy.ema9);

  const inputs: RegimeInputs = {
    spyAbove50d: spy.price > spy.ema50,
    qqqAbove50d: qqq.price > qqq.ema50,
    vix,
    breadth: estimateBreadth(spy, qqq),
    spyWeekChangePct,
  };

  return buildRegimeSnapshot(inputs);
}

// Rough breadth proxy from index trend alignment until the real
// advancers/decliners feed is wired. Both indices above their 20 EMA
// implies broad participation.
function estimateBreadth(
  spy: { price: number; ema20: number },
  qqq: { price: number; ema20: number }
): number {
  let score = 50;
  if (spy.price > spy.ema20) score += 12;
  if (qqq.price > qqq.ema20) score += 12;
  return Math.max(0, Math.min(100, score));
}

function estimateWeekChange(price: number, ema9: number): number {
  if (ema9 <= 0) return 0;
  return Math.round(((price - ema9) / ema9) * 1000) / 10;
}
