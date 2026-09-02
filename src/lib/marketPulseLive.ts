// ─────────────────────────────────────────────────────────
// Market Pulse IO: feeds the pure engine in marketPulse.ts from
// cached bars, the whole-market snapshot (REAL breadth — replaces the
// old index-proxy estimates), sector strength, FRED VIX, and the
// catalyst cache. Zero market-data API calls on the hot path.
// ─────────────────────────────────────────────────────────

import { loadBars, loadSnapshotBars, type Bar } from "./bars";
import { hasDatabase, query } from "./db";
import { getVixWithPrev } from "./fred";
import {
  classifyPulseRegime,
  momentumDayScore,
  optionsEnvironment,
  readTrend,
  type MomentumResult,
  type OptionsGrade,
  type PulseRegime,
  type RegimeResult,
  type TrendRead,
} from "./marketPulse";

export interface PulseSnapshot {
  regime: RegimeResult;
  spyLabel: PulseRegime | null;
  qqqLabel: PulseRegime | null;
  sectorName: string | null;
  sectorLabel: "Strong" | "Rising" | "Mixed" | "Weak" | null;
  stockLabel: PulseRegime | null;
  momentum: MomentumResult | null;
  options: { grade: OptionsGrade; reason: string } | null;
  asOf: string;
  dataQuality: "eod";
}

/**
 * Real market breadth from the latest whole-market snapshot: what
 * fraction of liquid stocks advanced, and where the volume went.
 */
export async function computeMarketBreadth(): Promise<{ advancersPct: number; upVolumePct: number } | null> {
  if (!hasDatabase()) return null;
  const rows = await query<{ adv: string; total: string; upvol: string; vol: string }>(
    `with d as (
       select distinct date from market_daily order by date desc limit 2
     ), pair as (
       select max(date) as today, min(date) as prev from d
     )
     select
       count(*) filter (where t.close > p.close)::text as adv,
       count(*)::text as total,
       coalesce(sum(t.close * t.volume) filter (where t.close > p.close), 0)::text as upvol,
       coalesce(sum(t.close * t.volume), 0)::text as vol
     from market_daily t
     join pair on t.date = pair.today
     join market_daily p on p.symbol = t.symbol and p.date = pair.prev
     where t.close >= 1 and t.close * t.volume >= 1000000`
  );
  const r = rows[0];
  if (!r || Number(r.total) < 100 || Number(r.vol) <= 0) return null;
  return {
    advancersPct: (Number(r.adv) / Number(r.total)) * 100,
    upVolumePct: (Number(r.upvol) / Number(r.vol)) * 100,
  };
}

async function sectorTrend(sector: string | null): Promise<{ name: string; score: number; change5d: number | null } | null> {
  if (!sector || sector === "General") return null;
  const rows = await query<{ date: string; score: string }>(
    `select date::text, score from sector_strength_daily
     where sector = $1 order by date desc limit 6`,
    [sector]
  );
  if (!rows.length) return null;
  const nowScore = Number(rows[0].score);
  const back = rows.length >= 5 ? Number(rows[rows.length - 1].score) : null;
  return { name: sector, score: nowScore, change5d: back !== null ? nowScore - back : null };
}

async function barsFor(symbol: string): Promise<Bar[]> {
  const map = await loadBars([symbol], 220);
  const bars = map.get(symbol) ?? [];
  if (bars.length >= 30) return bars;
  // Untracked symbols: the snapshot table still has ~130 days.
  return loadSnapshotBars(symbol);
}

/**
 * Build the full pulse for one stock (or the market alone when no
 * symbol is given). EOD honesty: recomputed per request from the
 * freshest cached session, and clearly stamped as end-of-day.
 */
export async function buildMarketPulse(symbol?: string): Promise<PulseSnapshot | null> {
  if (!hasDatabase()) return null;

  const [idxMap, breadth, vix] = await Promise.all([
    loadBars(["SPY", "QQQ"], 220),
    computeMarketBreadth(),
    getVixWithPrev(),
  ]);
  const spy = readTrend("SPY", idxMap.get("SPY") ?? []);
  const qqq = readTrend("QQQ", idxMap.get("QQQ") ?? []);

  let stock: TrendRead | null = null;
  let sector: { name: string; score: number; change5d: number | null } | null = null;
  let catalystFound: boolean | null = null;

  if (symbol) {
    const sym = symbol.toUpperCase();
    const [bars, refRows, catRows] = await Promise.all([
      barsFor(sym),
      query<{ sector: string | null }>(`select sector from tickers where symbol = $1 limit 1`, [sym]),
      query<{ published_at: string | null; checked_at: string }>(
        `select published_at, checked_at from catalyst_news where symbol = $1 limit 1`,
        [sym]
      ),
    ]);
    stock = readTrend(sym, bars);
    sector = await sectorTrend(refRows[0]?.sector ?? null);
    if (catRows[0]) {
      const pub = catRows[0].published_at ? new Date(catRows[0].published_at).getTime() : null;
      catalystFound = pub !== null && Date.now() - pub <= 72 * 3600e3;
    }
  }

  if (!spy && !qqq && !stock) return null;

  const regime = classifyPulseRegime({
    spy,
    qqq,
    stock: symbol ? stock : undefined,
    breadth,
    sector,
    vix,
  });

  let momentum: MomentumResult | null = null;
  let options: { grade: OptionsGrade; reason: string } | null = null;
  if (stock) {
    const sectorAligned =
      sector === null
        ? null
        : (sector.score >= 55 && (stock.label === "Bullish" || stock.label === "Strong Bullish")) ||
          (sector.score <= 45 && (stock.label === "Bearish" || stock.label === "Strong Bearish"));
    momentum = momentumDayScore({
      stock,
      spy,
      qqq,
      sectorAligned,
      breadth,
      vixMoving: vix && vix.prev !== null ? Math.abs(vix.level - vix.prev) / vix.prev > 0.04 : null,
      catalystFound,
      intraday: null, // flips on when a live intraday feed is connected
    });
    options = optionsEnvironment(regime.regime, momentum.score);
  }

  const sectorLabel = sector
    ? sector.score >= 65
      ? ("Strong" as const)
      : sector.change5d !== null && sector.change5d > 3
        ? ("Rising" as const)
        : sector.score <= 40
          ? ("Weak" as const)
          : ("Mixed" as const)
    : null;

  return {
    regime,
    spyLabel: spy?.label ?? null,
    qqqLabel: qqq?.label ?? null,
    sectorName: sector?.name ?? null,
    sectorLabel,
    stockLabel: stock?.label ?? null,
    momentum,
    options,
    asOf: new Date().toISOString(),
    dataQuality: "eod",
  };
}
