// IO for the SPX / SPY command center: SPY tape from Alpaca, SPX / VIX /
// VIX1D delayed prints from CBOE, end-of-day breadth from the
// whole-market table. Cached 20 seconds. Everything unavailable is
// reported as such, never estimated.

import { getStockBars, getStockSnapshots, hasAlpacaKeys } from "@/providers/alpaca";
import { getCboeQuote } from "@/providers/cboe";
import type { Bar } from "./bars";
import { buildLevels, etStamp, sessionOf, sessionVwapSeries } from "./intraday";
import { classify, marketEvidence, type MarketState } from "./marketState";
import { computeMarketBreadth } from "./marketPulseLive";
import { sessionLevels, type SessionLevels } from "./sessionLevels";
import { buildMatrix, type MatrixRow } from "./timeframeMatrix";
import { hasDatabase, queryOne } from "./db";

export interface IndexPrint { price: number; prevClose: number; changePct: number; asOf: string; delayed: true }

export interface MarketSnapshot {
  asOf: string;
  session: string;
  marketOpen: boolean;
  state: MarketState | null;
  spy: { price: number | null; changePct: number | null; vwap: number | null; levels: SessionLevels | null; support: number[]; resistance: number[]; rows: MatrixRow[] } | null;
  qqq: { price: number | null; changePct: number | null } | null;
  spx: IndexPrint | null;
  vix: IndexPrint | null;
  vix1d: IndexPrint | null;
  breadth: { advancersPct: number; upVolumePct: number; asOf: string } | null;
  notes: string[];
}

let cache: { at: number; data: MarketSnapshot } | null = null;
const toBar = (b: { t: string; o: number; h: number; l: number; c: number; v: number; vw?: number }): Bar => ({ t: Date.parse(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, vw: b.vw ?? b.c });

async function indexPrint(sym: string): Promise<IndexPrint | null> {
  try {
    const q = await getCboeQuote(sym, 30_000);
    if (!(q.price > 0) || !(q.prevClose > 0)) return null;
    return { price: q.price, prevClose: q.prevClose, changePct: Math.round(((q.price - q.prevClose) / q.prevClose) * 10000) / 100, asOf: q.lastTradeIso ?? q.asOf, delayed: true };
  } catch {
    return null;
  }
}

export async function buildMarketSnapshot(nowMs = Date.now()): Promise<MarketSnapshot> {
  if (cache && nowMs - cache.at < 20_000) return cache.data;
  const notes: string[] = [];
  const session = sessionOf(nowMs);
  const empty: MarketSnapshot = { asOf: new Date(nowMs).toISOString(), session, marketOpen: session === "rth", state: null, spy: null, qqq: null, spx: null, vix: null, vix1d: null, breadth: null, notes };
  if (!hasAlpacaKeys()) { notes.push("Alpaca keys not configured."); return empty; }
  const [snaps, m1raw, dailyRaw, spx, vix, vix1d, breadth, breadthDate] = await Promise.all([
    getStockSnapshots(["SPY", "QQQ"], 3_000).catch(() => ({} as Awaited<ReturnType<typeof getStockSnapshots>>)),
    getStockBars("SPY", "1Min", new Date(nowMs - 3 * 86400e3).toISOString(), undefined, 20_000).catch(() => []),
    getStockBars("SPY", "1Day", new Date(nowMs - 200 * 86400e3).toISOString(), undefined, 300_000).catch(() => []),
    indexPrint("_SPX"), indexPrint("_VIX"), indexPrint("_VIX1D"),
    computeMarketBreadth().catch(() => null),
    hasDatabase() ? queryOne<{ d: string }>("select max(date)::text as d from market_daily").catch(() => null) : Promise.resolve(null),
  ]);
  const m1 = m1raw.map(toBar);
  const daily = dailyRaw.map(toBar);
  const pctOf = (s?: { latestTrade?: { p: number }; prevDailyBar?: { c: number } }) => (s?.latestTrade && s.prevDailyBar?.c ? Math.round(((s.latestTrade.p - s.prevDailyBar.c) / s.prevDailyBar.c) * 10000) / 100 : null);
  const spySnap = snaps["SPY"], qqqSnap = snaps["QQQ"];
  const spyPrice = spySnap?.latestTrade?.p ?? (m1.length ? m1[m1.length - 1].c : null);
  const vwapArr = sessionVwapSeries(m1);
  const vwap = vwapArr.length ? vwapArr[vwapArr.length - 1] : null;
  const lv = m1.length ? sessionLevels(m1, daily, nowMs) : null;
  const rows = m1.length >= 30 ? buildMatrix({ m1, daily, nowMs }) : [];
  const lvl = m1.length >= 30 ? buildLevels({ minuteBars: m1, dailyBars: daily, nowMs }) : null;
  const strong = (kind: "support" | "resistance") => (lvl ? lvl.zones.filter((z) => z.kind === kind && z.strength >= 80).sort((a, b) => b.strength - a.strength).slice(0, 3).map((z) => z.price).sort((a, b) => (kind === "support" ? b - a : a - b)) : []);
  if (!vix) notes.push("VIX print unavailable from CBOE.");
  if (!breadth) notes.push("Breadth needs the whole-market table (end of day).");
  if (spx) notes.push("SPX, VIX and VIX1D prints are CBOE delayed by about 15 minutes.");
  const prevDaily = daily.filter((d) => etStamp(d.t).date < etStamp(nowMs).date);
  const prev = prevDaily[prevDaily.length - 1];
  const spyChange = pctOf(spySnap);
  const ev = spyPrice !== null && rows.length
    ? marketEvidence({
        spy: { rows, price: spyPrice, vwap, rvol: null, trendLabel: null, choppy: false, changePct: spyChange, prevHigh: prev?.h ?? null, prevLow: prev?.l ?? null },
        qqqChangePct: pctOf(qqqSnap), spyChangePct: spyChange,
        vix: vix ? { level: vix.price, prevClose: vix.prevClose } : null,
        vix1d: vix1d ? { level: vix1d.price, prevClose: vix1d.prevClose } : null,
        breadth: breadth ? { ...breadth, asOf: breadthDate?.d ?? "last session" } : null,
      })
    : null;
  const data: MarketSnapshot = {
    asOf: new Date(nowMs).toISOString(), session, marketOpen: session === "rth",
    state: ev ? classify(ev.evidence, ev.notMeasured, ev.chopSignals) : null,
    spy: spyPrice !== null ? { price: spyPrice, changePct: spyChange, vwap, levels: lv, support: strong("support"), resistance: strong("resistance"), rows } : null,
    qqq: qqqSnap?.latestTrade ? { price: qqqSnap.latestTrade.p, changePct: pctOf(qqqSnap) } : null,
    spx, vix, vix1d,
    breadth: breadth ? { ...breadth, asOf: breadthDate?.d ?? "last session" } : null,
    notes,
  };
  cache = { at: nowMs, data };
  return data;
}
