// ─────────────────────────────────────────────────────────
// Live regime builder.
// Pulls SPY/QQQ trend from Polygon and VIX from FRED, then runs the
// pure classifier in regime.ts. Returns null if data isn't available
// (no keys / API failure) so callers can fall back to mock.
// ─────────────────────────────────────────────────────────

import { loadBars } from "./bars";
import { hasDatabase } from "./db";
import { getVix } from "./fred";
import { computeMetricsFromBars, getSnapshotMetrics, hasPolygonKey, type SnapshotMetrics } from "./polygon";
import { computeMarketBreadth } from "./marketPulseLive";
import { buildRegimeSnapshot, type RegimeInputs } from "./regime";
import type { RegimeSnapshot } from "./types";

export function canBuildLiveRegime(): boolean {
  // Cached bars in the DB are the preferred source; the API path is a
  // fallback that costs 2 of the 5 req/min free-tier budget.
  return hasDatabase() || hasPolygonKey();
}

export async function buildLiveRegime(): Promise<RegimeSnapshot | null> {
  if (!canBuildLiveRegime()) return null;

  // Prefer cached bars (zero API calls).
  let spy: SnapshotMetrics | null = null;
  let qqq: SnapshotMetrics | null = null;
  if (hasDatabase()) {
    const cached = await loadBars(["SPY", "QQQ"], 220);
    const spyBars = cached.get("SPY");
    const qqqBars = cached.get("QQQ");
    if (spyBars && spyBars.length >= 60) spy = computeMetricsFromBars("SPY", spyBars);
    if (qqqBars && qqqBars.length >= 60) qqq = computeMetricsFromBars("QQQ", qqqBars);
  }
  if ((!spy || !qqq) && hasPolygonKey()) {
    [spy, qqq] = await Promise.all([getSnapshotMetrics("SPY"), getSnapshotMetrics("QQQ")]);
  }
  const vix = await getVix();

  if (!spy || !qqq) return null;

  // Breadth and weekly change are approximated here until the breadth
  // engine (advancers/decliners) lands in Week 2. SPY 5-day change is a
  // reasonable proxy for the weekly move in the meantime.
  const spyWeekChangePct = estimateWeekChange(spy.price, spy.ema9);

  // Real whole-market breadth when the snapshot table has data; the
  // index-alignment estimate stays only as the empty-table fallback.
  const marketBreadth = await computeMarketBreadth();
  const inputs: RegimeInputs = {
    spyAbove50d: spy.price > spy.ema50,
    qqqAbove50d: qqq.price > qqq.ema50,
    // Neutral default when FRED key is absent; the scanner path uses a
    // realized-vol proxy instead and persists it for the UI.
    vix: vix ?? 18,
    breadth: marketBreadth ? Math.round(marketBreadth.advancersPct) : estimateBreadth(spy, qqq),
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
