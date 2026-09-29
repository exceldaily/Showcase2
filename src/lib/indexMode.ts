// ─────────────────────────────────────────────────────────
// Index mode (SPX). Alpaca has no index bars and no index options, so:
//   daily bars      = the REAL index (CBOE history)
//   today's minutes = the REAL index up to CBOE's delay (about 15 minutes),
//                     then the tracking ETF in real time scaled by a ratio
//                     fitted to the latest real print
//   earlier days    = the ETF's minutes scaled by THAT day's real
//                     index/ETF close ratio (the ratio drifts with the
//                     ETF's dividend accrual, so one ratio for every day
//                     put older bars several points off)
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

/** Pure: real index close over the ETF close, per ET date both sides have. */
export function dayRatios(indexDaily: { date: string; c: number }[], proxyDaily: Bar[]): Map<string, number> {
  const idx = new Map(indexDaily.map((d) => [d.date, d.c]));
  const out = new Map<string, number>();
  for (const b of proxyDaily) {
    const d = etStamp(b.t).date;
    const c = idx.get(d);
    if (c && c > 0 && b.c > 0) out.set(d, c / b.c);
  }
  return out;
}

/**
 * Pure: scale ETF minute bars into index points one session at a time.
 * Regular-hours and later bars use their own day's ratio (today: the
 * fitted ratio); premarket bars use the previous session's ratio because
 * they trade against that close.
 */
export function scaleIntradayByDay(bars: Bar[], ratios: Map<string, number>, todayEt: string, todayRatio: number): Bar[] {
  const dates = [...ratios.keys()].sort();
  const prevOf = (d: string): number | null => {
    for (let i = dates.length - 1; i >= 0; i--) if (dates[i] < d) return ratios.get(dates[i]) ?? null;
    return null;
  };
  const memo = new Map<string, { rth: number; pre: number }>();
  return bars.map((b) => {
    const s = etStamp(b.t);
    let r = memo.get(s.date);
    if (!r) {
      const prev = prevOf(s.date);
      const rth = s.date >= todayEt ? todayRatio : ratios.get(s.date) ?? prev ?? todayRatio;
      r = { rth, pre: prev ?? rth };
      memo.set(s.date, r);
    }
    return scaleBar(b, s.minutes >= 9 * 60 + 30 ? r.rth : r.pre);
  });
}

/** Pure: put the real index minutes over the scaled estimate where both exist (volume stays the ETF's). */
export function overlayRealMinutes(scaled: Bar[], real: { t: number; o: number; h: number; l: number; c: number }[]): Bar[] {
  if (real.length === 0) return scaled;
  const by = new Map(real.map((r) => [r.t, r]));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return scaled.map((b) => {
    const r = by.get(b.t);
    if (!r) return b;
    return { t: b.t, o: r2(r.o), h: r2(r.h), l: r2(r.l), c: r2(r.c), v: b.v, vw: r2(Math.min(r.h, Math.max(r.l, b.vw))) };
  });
}

/** Pure: real index daily bars on the ETF's calendar; days the index file lacks fall back to the scaled ETF bar. */
export function indexDailyBars(indexDaily: { date: string; o: number; h: number; l: number; c: number }[], proxyDaily: Bar[], fallbackRatio: number): Bar[] {
  const idx = new Map(indexDaily.map((d) => [d.date, d]));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return proxyDaily.map((b) => {
    const row = idx.get(etStamp(b.t).date);
    if (!row || !(b.c > 0)) return scaleBar(b, fallbackRatio);
    const vw = b.vw * (row.c / b.c);
    return { t: b.t, o: r2(row.o), h: r2(row.h), l: r2(row.l), c: r2(row.c), v: b.v, vw: r2(Math.min(row.h, Math.max(row.l, vw))) };
  });
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
  // The ratio pairs the index's previous close with the ETF close of the SAME session.
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
