// ─────────────────────────────────────────────────────────
// Index mode (SPX). Alpaca has no index bars and no index options, so:
//   chart + levels  = the tracking ETF's real-time bars scaled by
//                     yesterday's real index/ETF close ratio (about 10.0x
//                     for SPX/SPY; drift within a day is a few basis points)
//   option chain    = CBOE delayed SPX/SPXW quotes (about 15 minutes behind)
// Everything downstream (levels, plan, machine, scoring) then works in
// index points without knowing the difference. Not tradeable on Alpaca.
// ─────────────────────────────────────────────────────────

import type { Bar } from "./bars";
import { getStockBars, getStockSnapshots } from "@/providers/alpaca";
import { etStamp, sessionOf } from "./intraday";
import { getCboeQuote } from "@/providers/cboe";

export interface IndexMode {
  symbol: string;   // "SPX"
  proxy: string;    // "SPY"
  cboe: string;     // "_SPX"
  label: string;
}

const INDEX_MODES: Record<string, IndexMode> = {
  SPX: { symbol: "SPX", proxy: "SPY", cboe: "_SPX", label: "S&P 500 index" },
  SPXW: { symbol: "SPX", proxy: "SPY", cboe: "_SPX", label: "S&P 500 index" },
};

export function resolveIndex(requested: string): IndexMode | null {
  return INDEX_MODES[requested] ?? null;
}

/** Pure: scale an ETF bar into index points (volume stays the ETF's). */
export function scaleBar(b: Bar, ratio: number): Bar {
  const r = (n: number) => Math.round(n * ratio * 100) / 100;
  return { t: b.t, o: r(b.o), h: r(b.h), l: r(b.l), c: r(b.c), v: b.v, vw: r(b.vw) };
}

export interface IndexRatio {
  ratio: number;
  indexPrevClose: number;
  proxyPrevClose: number;
  /** CBOE's delayed index print, for display next to the live estimate. */
  indexDelayedPrice: number;
  indexAsOf: string;
  /** When the ratio was re-fit to a CBOE print matched to the ETF bar of the same minute (null = closes only). */
  calibratedAt: string | null;
}

const ratioCache = new Map<string, { at: number; data: IndexRatio }>();

/**
 * Yesterday's index close over yesterday's ETF close, then, during the
 * session, re-fit to the latest CBOE print against the ETF bar of that
 * same minute so the drift between the index and its ETF (dividends,
 * premium/discount) is taken out. Cached 60s.
 */
export async function getIndexRatio(mode: IndexMode): Promise<IndexRatio> {
  const hit = ratioCache.get(mode.symbol);
  if (hit && Date.now() - hit.at < 60_000) return hit.data;
  const [q, snaps] = await Promise.all([getCboeQuote(mode.cboe), getStockSnapshots([mode.proxy], 30_000)]);
  const s = snaps[mode.proxy];
  // Alpaca's dailyBar stays on the last completed session until today's bar exists.
  const todayEt = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const dailyIsToday = s?.dailyBar ? new Date(Date.parse(s.dailyBar.t)).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) === todayEt : false;
  const proxyPrev = dailyIsToday ? s?.prevDailyBar?.c : s?.dailyBar?.c ?? s?.prevDailyBar?.c;
  if (!proxyPrev || !q.prevClose) throw new Error(`no reference closes for ${mode.symbol}`);
  let ratio = q.prevClose / proxyPrev;
  let calibratedAt: string | null = null;
  // Intraday: match the delayed print to the ETF's 1-minute bar at that time.
  const printMs = q.lastTradeIso ? Date.parse(q.lastTradeIso) : NaN;
  const printEt = Number.isFinite(printMs) ? etStamp(printMs) : null;
  if (printEt && printEt.date === todayEt && sessionOf(printMs) === "rth" && q.price > 0) {
    try {
      const bars = await getStockBars(mode.proxy, "1Min", new Date(printMs - 3 * 60e3).toISOString(), new Date(printMs + 60e3).toISOString(), 60_000);
      const at = [...bars].reverse().find((b) => Date.parse(b.t) <= printMs);
      if (at && at.c > 0) {
        const fitted = q.price / at.c;
        // Sanity: the fit must stay within 0.5% of the close-to-close ratio.
        if (Math.abs(fitted / ratio - 1) < 0.005) {
          ratio = fitted;
          calibratedAt = q.lastTradeIso;
        }
      }
    } catch {
      /* keep the close-to-close ratio */
    }
  }
  const data: IndexRatio = {
    ratio, indexPrevClose: q.prevClose, proxyPrevClose: proxyPrev,
    indexDelayedPrice: q.price, indexAsOf: q.asOf, calibratedAt,
  };
  ratioCache.set(mode.symbol, { at: Date.now(), data });
  return data;
}
