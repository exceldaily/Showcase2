// ─────────────────────────────────────────────────────────
// Options scanner: finds UNDERLYINGS with actionable setups across
// a universe, then runs the full options pipeline on the most active
// names. Cheap first pass = one batched snapshot call for the whole
// universe; the expensive analysis runs only for the top candidates.
// ─────────────────────────────────────────────────────────

import { getStockSnapshots, hasAlpacaKeys } from "@/providers/alpaca";
import { buildOptionsAnalysis, type OptionsAnalysis } from "./optionsTerminal";

import { MEGACAPS, SP100 } from "./universes";
export { MEGACAPS, SP100 };

const UNIVERSES: Record<string, { name: string; symbols: string[] }> = {
  megacaps: { name: "Megacaps + ETFs", symbols: MEGACAPS },
  sp100: { name: "S&P 100", symbols: SP100 },
};

export interface ScanRow {
  symbol: string;
  price: number | null;
  changePct: number | null;
  volumeRatio: number | null;   // today's volume vs previous session (cheap first-pass activity)
  analyzed: boolean;
  trend: string | null;
  trendConfidence: number | null;
  direction: "long" | "short" | null;
  state: string | null;
  /** Standard lifecycle state shared with the terminal. */
  lifecycle: string | null;
  quality: number | null;
  opportunity: number | null;
  trigger: number | null;
  distanceToTriggerPct: number | null;
  roomGrade: string | null;
  rvol: number | null;
  bestCall: { symbol: string; strike: number; expiry: string; score: number; spreadPct: number | null; mid: number } | null;
  bestPut: { symbol: string; strike: number; expiry: string; score: number; spreadPct: number | null; mid: number } | null;
  /** From the history cache: confirmed breaks that reached T1, as a rate, plus the sample size. */
  t1HitRate: number | null;
  histConfirmed: number | null;
}

export interface ScanResult {
  universe: string;
  rows: ScanRow[];
  analyzedCount: number;
  asOf: string;
  notes: string[];
}

const scanCache = new Map<string, { at: number; data: ScanResult }>();

/** Cheap ranking signal: absolute move times participation. Pure. */
export function activityScore(changePct: number | null, volumeRatio: number | null): number {
  const move = Math.abs(changePct ?? 0);
  const part = Math.max(0.2, volumeRatio ?? 0.5);
  return move * Math.log2(1 + part * 2);
}

function pick(c: OptionsAnalysis["best"]): ScanRow["bestCall"] {
  return c ? { symbol: c.symbol, strike: c.strike, expiry: c.expiry, score: c.score, spreadPct: c.spreadPct, mid: c.mid } : null;
}

export async function scanOptionsUniverse(
  universeKey: string,
  customSymbols: string[] = [],
  topN = 10,
  profile = "BALANCED"
): Promise<ScanResult> {
  const notes: string[] = [];
  const symbols = universeKey === "custom"
    ? Array.from(new Set(customSymbols.map((s) => s.toUpperCase()).filter((s) => /^[A-Z.]{1,6}$/.test(s)))).slice(0, 120)
    : (UNIVERSES[universeKey]?.symbols ?? MEGACAPS);
  const cacheKey = `${universeKey}:${symbols.join(",")}:${topN}:${profile}`;
  const hit = scanCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 45_000) return hit.data;

  if (!hasAlpacaKeys()) {
    return { universe: universeKey, rows: [], analyzedCount: 0, asOf: new Date().toISOString(), notes: ["Alpaca keys not configured."] };
  }
  if (symbols.length === 0) {
    return { universe: universeKey, rows: [], analyzedCount: 0, asOf: new Date().toISOString(), notes: ["Add symbols to your list to scan."] };
  }

  // Pass 1: one batched snapshot call for the whole universe.
  const snaps = await getStockSnapshots(symbols, 5_000);
  const rows: ScanRow[] = symbols.map((sym) => {
    const s = snaps[sym];
    const price = s?.latestTrade?.p ?? s?.dailyBar?.c ?? null;
    const prevC = s?.prevDailyBar?.c ?? null;
    const changePct = price !== null && prevC ? Math.round(((price - prevC) / prevC) * 10000) / 100 : null;
    const volumeRatio = s?.dailyBar?.v && s?.prevDailyBar?.v ? Math.round((s.dailyBar.v / s.prevDailyBar.v) * 100) / 100 : null;
    return {
      symbol: sym, price, changePct, volumeRatio, analyzed: false,
      trend: null, trendConfidence: null, direction: null, state: null, lifecycle: null, quality: null, opportunity: null,
      trigger: null, distanceToTriggerPct: null, roomGrade: null, rvol: null, bestCall: null, bestPut: null,
      t1HitRate: null, histConfirmed: null,
    };
  });

  // Pass 2: full pipeline for the most active names (concurrency-limited).
  const ranked = [...rows].filter((r) => r.price !== null).sort((a, b) => activityScore(b.changePct, b.volumeRatio) - activityScore(a.changePct, a.volumeRatio)).slice(0, topN);
  const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
  for (let i = 0; i < ranked.length; i += 6) {
    const chunk = ranked.slice(i, i + 6);
    await Promise.all(
      chunk.map(async (r) => {
        try {
          const a = await buildOptionsAnalysis(r.symbol, { profile });
          const row = bySymbol.get(r.symbol)!;
          row.analyzed = true;
          row.trend = a.trend?.label ?? null;
          row.trendConfidence = a.trend?.confidence ?? null;
          row.direction = a.direction;
          row.state = a.machine?.state ?? (a.plan ? "WATCHING" : null);
          row.lifecycle = a.lifecycle;
          row.quality = a.machine?.quality ?? null;
          row.opportunity = a.opportunity?.total ?? null;
          row.trigger = a.plan?.trigger ?? null;
          row.distanceToTriggerPct = a.plan && a.price ? Math.round((Math.abs(a.plan.trigger - a.price) / a.price) * 10000) / 100 : null;
          row.roomGrade = a.room?.grade ?? null;
          row.rvol = a.rvol;
          row.bestCall = pick(a.sides.call.best);
          row.bestPut = pick(a.sides.put.best);
          if (a.history && a.history.stats.confirmed > 0) {
            row.t1HitRate = Math.round((a.history.stats.t1Hit / a.history.stats.confirmed) * 100);
            row.histConfirmed = a.history.stats.confirmed;
          }
          if (a.price !== null) row.price = a.price;
          if (a.changePct !== null) row.changePct = a.changePct;
        } catch (e) {
          notes.push(`${r.symbol}: ${e instanceof Error ? e.message.slice(0, 80) : "analysis failed"}`);
        }
      })
    );
  }

  rows.sort((a, b) => {
    if (a.analyzed !== b.analyzed) return a.analyzed ? -1 : 1;
    if (a.analyzed) return (b.opportunity ?? 0) - (a.opportunity ?? 0);
    return activityScore(b.changePct, b.volumeRatio) - activityScore(a.changePct, a.volumeRatio);
  });
  const result: ScanResult = { universe: universeKey, rows, analyzedCount: ranked.length, asOf: new Date().toISOString(), notes };
  scanCache.set(cacheKey, { at: Date.now(), data: result });
  return result;
}
