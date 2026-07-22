// ─────────────────────────────────────────────────────────
// Historical validation of the setup detectors.
//
// Walks the cached bar history bar-by-bar, fires the SAME detection
// and plan code the live scanner uses, then simulates the outcome:
//   - entry at the NEXT session's open (no same-bar fills)
//   - if the open gaps beyond the stop, the signal is skipped
//     (the platform refuses to chase; so does the backtest)
//   - stop checked BEFORE target when both hit inside one bar
//     (conservative intrabar assumption)
//   - time exit at 20 sessions if neither stop nor target hits
// Results are reported in R multiples. Slippage and commissions are
// NOT modeled yet; the UI says so. This validates structure quality,
// not net-of-cost profitability.
// ─────────────────────────────────────────────────────────

import type { Bar } from "./bars";
import { computeMetricsFromBars } from "./polygon";
import { query } from "./db";
import {
  buildPlan,
  detectLongSetup,
  detectRsLeader,
  detectShortSetup,
  type Direction,
  type PlanOptions,
} from "./setups";
import { MIN_RISK_REWARD, round2 } from "./scoring";

interface SimTrade {
  r: number;
  holdDays: number;
  win: boolean;
}

export interface BacktestBucket {
  setupType: string;
  direction: Direction;
  signals: number;
  wins: number;
  losses: number;
  winRate: number;
  avgR: number;
  profitFactor: number;
  avgHoldDays: number;
}

export interface BacktestReport {
  ranAt: string;
  lookbackDays: number;
  symbols: number;
  buckets: BacktestBucket[];
  totalSignals: number;
}

const MAX_HOLD = 20;
const COOLDOWN = 5; // bars to skip after a signal per symbol+type

export function runBacktestOnBars(
  barsMap: Map<string, Bar[]>,
  isIpoBySymbol: Map<string, boolean>,
  opts: PlanOptions = {}
): BacktestReport {
  const trades = new Map<string, SimTrade[]>(); // key: type|direction
  let totalSignals = 0;
  const spyBars = barsMap.get("SPY") ?? [];

  for (const [symbol, bars] of Array.from(barsMap.entries())) {
    if (symbol === "SPY" || symbol === "QQQ" || bars.length < 90) continue;
    const isIpo = isIpoBySymbol.get(symbol) ?? false;
    const lastSignalAt = new Map<string, number>();

    for (let i = 60; i < bars.length - 1; i++) {
      const slice = bars.slice(0, i + 1);
      const m = computeMetricsFromBars(symbol, slice);
      if (m.price < 5) continue;

      // Point-in-time SPY slice (tail-aligned approximation: recent
      // trading days match across symbols).
      const offsetFromEnd = bars.length - 1 - i;
      const spySlice = spyBars.length > offsetFromEnd ? spyBars.slice(0, spyBars.length - offsetFromEnd) : [];

      const longDet = detectLongSetup(m, slice, isIpo) ?? detectRsLeader(m, slice, spySlice);
      const candidates = [longDet, detectShortSetup(m, slice)].filter(
        (d): d is NonNullable<typeof d> => d !== null
      );

      for (const det of candidates) {
        const key = `${det.type}|${det.direction}`;
        const last = lastSignalAt.get(key);
        if (last !== undefined && i - last < COOLDOWN) continue;

        const plan = buildPlan(m, slice, det, opts);
        if (!plan || plan.riskReward < MIN_RISK_REWARD) continue;

        const sim = simulate(bars, i, det.direction, plan.stopLoss, plan.targets[1].price);
        if (!sim) continue; // gapped past stop at entry: platform would refuse

        lastSignalAt.set(key, i);
        totalSignals++;
        const arr = trades.get(key) ?? [];
        arr.push(sim);
        trades.set(key, arr);
      }
    }
  }

  const buckets: BacktestBucket[] = Array.from(trades.entries()).map(([key, arr]) => {
    const [setupType, direction] = key.split("|") as [string, Direction];
    const wins = arr.filter((t) => t.win).length;
    const grossPos = arr.filter((t) => t.r > 0).reduce((a, t) => a + t.r, 0);
    const grossNeg = Math.abs(arr.filter((t) => t.r < 0).reduce((a, t) => a + t.r, 0));
    return {
      setupType,
      direction,
      signals: arr.length,
      wins,
      losses: arr.length - wins,
      winRate: round2((wins / arr.length) * 100),
      avgR: round2(arr.reduce((a, t) => a + t.r, 0) / arr.length),
      profitFactor: grossNeg > 0 ? round2(grossPos / grossNeg) : arr.length > 0 ? 99 : 0,
      avgHoldDays: round2(arr.reduce((a, t) => a + t.holdDays, 0) / arr.length),
    };
  });

  buckets.sort((a, b) => b.signals - a.signals);

  const anyBars = Array.from(barsMap.values())[0] ?? [];
  return {
    ranAt: new Date().toISOString(),
    lookbackDays: anyBars.length,
    symbols: barsMap.size,
    buckets,
    totalSignals,
  };
}

function simulate(
  bars: Bar[],
  signalIndex: number,
  direction: Direction,
  stop: number,
  target: number
): SimTrade | null {
  const entryBar = bars[signalIndex + 1];
  if (!entryBar) return null;
  const entry = entryBar.o;

  // Refuse entries that gap beyond the stop (platform would not chase).
  if (direction === "Long" && entry <= stop) return null;
  if (direction === "Short" && entry >= stop) return null;

  const risk = direction === "Long" ? entry - stop : stop - entry;
  if (risk <= 0) return null;

  for (let j = signalIndex + 1; j <= Math.min(signalIndex + MAX_HOLD, bars.length - 1); j++) {
    const b = bars[j];
    if (direction === "Long") {
      if (b.l <= stop) return { r: round2((stop - entry) / risk), holdDays: j - signalIndex, win: false };
      if (b.h >= target) return { r: round2((target - entry) / risk), holdDays: j - signalIndex, win: true };
    } else {
      if (b.h >= stop) return { r: round2((entry - stop) / risk), holdDays: j - signalIndex, win: false };
      if (b.l <= target) return { r: round2((entry - target) / risk), holdDays: j - signalIndex, win: true };
    }
  }

  // Time exit
  const exitIdx = Math.min(signalIndex + MAX_HOLD, bars.length - 1);
  const exit = bars[exitIdx].c;
  const r = direction === "Long" ? (exit - entry) / risk : (entry - exit) / risk;
  return { r: round2(r), holdDays: exitIdx - signalIndex, win: r > 0 };
}

export async function persistBacktest(report: BacktestReport): Promise<void> {
  for (const b of report.buckets) {
    await query(
      `insert into backtest_stats (run_at, lookback_days, setup_type, direction, signals, wins, losses,
         win_rate, avg_r, profit_factor, avg_hold_days, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [report.ranAt, report.lookbackDays, b.setupType, b.direction, b.signals, b.wins, b.losses,
       b.winRate, b.avgR, b.profitFactor, b.avgHoldDays,
       "EOD simulation; next-open entries; stop-first intrabar; no slippage/costs modeled"]
    );
  }
}
