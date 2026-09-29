// ─────────────────────────────────────────────────────────
// Options terminal orchestrator (server-side).
// MARKET DATA -> TECHNICAL ENGINE -> STRUCTURE -> SETUP MACHINE ->
// CHAIN FILTER -> CONTRACT SCORING -> SCENARIOS -> TRADE MAP.
// Underlying-first: the stock decides the thesis, the chain only
// decides which contract expresses it. Supports a replay cutoff so
// the identical pipeline can be pointed at any historical moment
// without lookahead.
// ─────────────────────────────────────────────────────────

import {
  getOptionChain, getOptionContracts, getStockBars, getStockSnapshots, getClock, hasAlpacaKeys,
  type OptionSnapshot,
} from "@/providers/alpaca";
import type { Bar } from "./bars";
import {
  buildLevels, daySlot, etMidnightMs, etStamp, intradayTrend, referenceClose, regularHoursShare, resample, sameTimeRvol, sessionOf, sessionVwapSeries,
  timeAdjustedRvol, type LevelZone, type TrendResult, countTrendFlips, type IntradayTrend } from "./intraday";
import { sanitizeBars } from "./barSanity";
import { buildWarm, stitch, type WarmCloses } from "./chartWarm";
import {
  blackScholes, dte as dteOf, extrinsicValue, impliedVol, intrinsicValue, isQuoteStale,
  mid as midOf, parseOcc, scenarioPrice, spreadDollars, spreadPct, yearsToExpiry,
  breakEvenAtExpiry, type ScenarioPoint,
} from "./optionsMath";
import { coachVerdict, strikeChoices, type StrikeChoice } from "./strikeCoach";
import { readTrend } from "./marketPulse";
import { getLock, lockDecision, releaseLock, saveLock } from "./setupLock";
import { dayRatios, getIndexRatio, indexDailyBars, overlayRealMinutes, resolveIndex, scaleIntradayByDay, type IndexMode } from "./indexMode";
import { getCboeChain, getCboeIndexDaily, getCboeIndexMinutes, getCboeOpenInterest } from "@/providers/cboe";
import { SCORE_PROFILES, scoreContract, whyContract, type ContractFacts, type ContractScore } from "./optionsScore";
import {
  buildTradePlan, opportunityScore, roomToMove, runMachine, sessionPenalty,
  DEFAULT_BREAKOUT_CONFIG, type MachineState, type SetupDirection, type TradePlan,
} from "./setupMachine";
import { plainSummary, STATE_EXPLAIN } from "./plainEnglish";
import { getCachedHistory, rvolFromProfile, type SymbolHistory } from "./historyStats";
import { alignmentSummary, buildTimeframeSetups, weekAlignedTail, type TfSetup } from "./multiTimeframe";
import { alignment as alignRows, buildMatrix, type Alignment, type MatrixRow } from "./timeframeMatrix";
import { confluence as scoreConfluence, type Confluence } from "./decision/confluence";
import { lifecycleOf, type LifecycleState } from "./decision/lifecycle";
import { hasDatabase, queryOne } from "./db";
import { contractWarnings, tagContracts, type ContractTag } from "./contractRank";
import { latestCatalyst, refreshSymbolNews } from "./newsFeedsLive";

export interface RankedContract {
  symbol: string;
  side: "call" | "put";
  strike: number;
  expiry: string;
  dte: number;
  bid: number;
  ask: number;
  mid: number;
  last: number | null;
  spreadDollars: number;
  spreadPct: number | null;
  volume: number;
  openInterest: number;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  greeksSource: "alpaca" | "calculated" | "none";
  intrinsic: number;
  extrinsic: number;
  breakEven: number;
  moneyness: string;
  quoteTs: number | null;
  stale: boolean;
  score: number;
  why: string[];
  /** BEST / ALTERNATIVE / AGGRESSIVE / CONSERVATIVE on its side, when tagged. */
  tag: ContractTag | null;
  /** Scorer components (top contracts only, to keep the payload small). */
  parts: { name: string; score: number; max: number }[];
  penalties: string[];
  warnings: string[];
}

export interface LadderRung {
  label: string;
  price: number;
  kind: "target" | "level" | "wrong";
  est: ScenarioPoint | null;
}

export interface SideView {
  side: "call" | "put";
  best: RankedContract | null;
  alternatives: RankedContract[];
  /** Levels the stock would need to reach, and what the best contract is estimated to be worth there. */
  ladder: LadderRung[];
  /** Recommended vs cheaper (strike at the target) vs safer (one strike in the money), same model as the ladder. */
  choices: StrikeChoice[];
  /** Plain-English answer to "why not just buy the cheaper strike?" */
  verdict: string | null;
}

export interface OptionsAnalysis {
  symbol: string;
  /** Plain-English narration for newer traders. */
  summary: string[];
  stateExplain: string | null;
  sides: { call: SideView; put: SideView };
  /** Cached per-symbol history stats (volume profile + breakout backtest), when computed. */
  history: SymbolHistory | null;
  /** The same setup read on 1m / 5m / 15m / 1h / D / W. */
  setups: TfSetup[];
  connected: boolean;
  marketOpen: boolean;
  session: string;
  slot: string;
  asOf: string;
  price: number | null;
  changePct: number | null;
  prevClose: number | null;
  rvol: number | null;
  /** How the relative volume was measured: the same window on past sessions, or an estimate from a volume curve. */
  rvolBasis: { method: "same-time" | "estimate"; sessions: number; window: string } | null;
  atr5m: number | null;
  vwap: number | null;
  lastTradeTs: number | null;
  dataStale: boolean;
  /** 1m (last 480), 5m (all fetched), daily (~280, opening on a week start). 2m/15m/30m/1h/W are resampled client-side. */
  bars: { m1: Bar[]; m5: Bar[]; daily: Bar[] };
  /** Closes that came before each timeframe's first bar, so EMAs and MACD are warmed up like a broker's chart. */
  warm: WarmCloses;
  /** Where open interest came from and the session it belongs to. */
  openInterest: { source: "CBOE" | "Alpaca"; asOf: string | null } | null;
  /** Erroneous prints removed from the bars (wick pulled back to the bar's own open/close). */
  badPrints: { at: string; frame: "1m" | "D"; field: "h" | "l"; from: number; to: number }[];
  zones: LevelZone[];
  keyMarks: { label: string; price: number }[];
  trend: TrendResult | null;
  /** Today's fixed level: the plan stays put until the setup resolves or the owner re-picks. */
  lock: { pickedAt: string; pickedPrice: number | null } | null;
  /** Set for SPX: chart is the proxy ETF scaled by yesterday's real ratio; option quotes are CBOE delayed. */
  indexMode: { proxy: string; ratio: number; delayedPrice: number; delayedAsOf: string; label: string } | null;
  /** Bull/bear switches of the 5-minute read over the last hour; 2+ means choppy. */
  trendFlips: number;
  /** Weak or flip-flopping read: no trend worth trading yet. Direction then follows the daily chart. */
  choppy: boolean;
  direction: SetupDirection;
  machine: MachineState | null;
  plan: TradePlan | null;
  room: ReturnType<typeof roomToMove> | null;
  contracts: RankedContract[];
  best: RankedContract | null;
  scenarios: { contract: string; points: ScenarioPoint[] } | null;
  opportunity: ReturnType<typeof opportunityScore> | null;
  context: { spy: number | null; qqq: number | null };
  /** Compact per-timeframe read (1m, 2m, 5m, 15m, 30m, 1h, D). */
  matrix: MatrixRow[];
  align: Alignment | null;
  /** Eight-part confidence breakdown; `pct` is the number the panel shows. */
  confluence: Confluence | null;
  /** Latest cached headline for the name from the catalyst sweep, when the name is covered. */
  catalyst: { headline: string; publisher: string | null; tier: number; publishedAt: string | null; url: string | null } | null;
  /** Standard lifecycle state (NO SETUP ... EXPIRED) shared by every surface. */
  lifecycle: LifecycleState;
  /** Server compute time for this analysis, for the developer view. */
  timingMs?: number;
  /** Milliseconds spent in each stage of this analysis. */
  stages?: Record<string, number>;
  replayCutoff: string | null;
  notes: string[];
}

const analysisCache = new Map<string, { at: number; data: OptionsAnalysis }>();

function toBar(b: { t: string; o: number; h: number; l: number; c: number; v: number; vw?: number }): Bar {
  return { t: Date.parse(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, vw: b.vw ?? b.c };
}

const slim = (b: Bar): Bar => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, vw: Math.round(b.vw * 100) / 100 });

/** Indexes are not tradeable on Alpaca; map to the ETF that tracks them. */
export const INDEX_ALIASES: Record<string, { etf: string; note: string }> = {
  NDX: { etf: "QQQ", note: "NDX is an index. Showing QQQ, the ETF that tracks it." },
  DJX: { etf: "DIA", note: "DJX is an index. Showing DIA, the ETF that tracks it." },
  RUT: { etf: "IWM", note: "RUT is an index. Showing IWM, the ETF that tracks it." },
  VIX: { etf: "VIXY", note: "VIX itself is not tradeable here. Showing VIXY, a VIX futures ETF (behaves differently from the index)." },
};

export async function buildOptionsAnalysis(
  rawSymbol: string,
  opts: { profile?: string; replayCutoffMs?: number } = {}
): Promise<OptionsAnalysis> {
  const requested = rawSymbol.toUpperCase().replace(/[^A-Z.]/g, "").slice(0, 6);
  const alias = INDEX_ALIASES[requested];
  const index: IndexMode | null = resolveIndex(requested);
  // `symbol` is what the user sees (SPX); `dataSymbol` is what Alpaca is asked for (SPY).
  const symbol = index ? index.symbol : alias ? alias.etf : requested;
  const dataSymbol = index ? index.proxy : symbol;
  const profileName = SCORE_PROFILES[opts.profile ?? ""] ? (opts.profile as string) : "BALANCED";
  const cacheKey = `${symbol}:${profileName}:${opts.replayCutoffMs ?? "live"}`;
  const hit = analysisCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 4_000) return hit.data;
  const startedAt = Date.now();
  // Stage timings for the developer view (ms since the stage before).
  const stages: Record<string, number> = {};
  let stageAt = startedAt;
  const mark = (name: string) => { const t = Date.now(); stages[name] = (stages[name] ?? 0) + (t - stageAt); stageAt = t; };

  const notes: string[] = [];
  if (alias) notes.push(alias.note);
  const emptySide = (side: "call" | "put"): SideView => ({ side, best: null, alternatives: [], ladder: [], choices: [], verdict: null });
  const empty: OptionsAnalysis = {
    symbol, summary: [], stateExplain: null, sides: { call: emptySide("call"), put: emptySide("put") }, history: null, setups: [], trendFlips: 0, choppy: false, lock: null,
    indexMode: null,
    connected: hasAlpacaKeys(), marketOpen: false, session: "closed", slot: "closed",
    asOf: new Date().toISOString(), price: null, changePct: null, prevClose: null, rvol: null, rvolBasis: null,
    atr5m: null, vwap: null, lastTradeTs: null, dataStale: true,
    bars: { m1: [], m5: [], daily: [] }, warm: {}, openInterest: null, badPrints: [], zones: [], keyMarks: [],
    trend: null, direction: "long", machine: null, plan: null, room: null,
    contracts: [], best: null, scenarios: null, opportunity: null,
    context: { spy: null, qqq: null }, matrix: [], align: null, confluence: null, catalyst: null, lifecycle: "NO SETUP",
    replayCutoff: opts.replayCutoffMs ? new Date(opts.replayCutoffMs).toISOString() : null,
    notes,
  };
  if (!hasAlpacaKeys()) {
    notes.push("Alpaca keys are not configured — no market data connection.");
    return empty;
  }

  const now = opts.replayCutoffMs ?? Date.now();
  const clockP = getClock().catch(() => null);

  // Start times are floored (minute / UTC day) so identical requests share
  // the provider cache. Five days of minutes for the session at hand; the
  // long 5-minute, 30-minute and daily histories exist to warm up the
  // indicators (a 200-period EMA needs several hundred bars behind it).
  const live = !opts.replayCutoffMs;
  const dayFloor = (ms: number) => new Date(Math.floor(ms / 86400e3) * 86400e3).toISOString();
  const startMin = new Date(Math.floor((now - 5 * 86400e3) / 60e3) * 60e3).toISOString();
  const startDay = dayFloor(now - 2600 * 86400e3);
  const startM5 = dayFloor(now - 30 * 86400e3); // 20 sessions for relative volume, and the 15-minute warm-up
  const startM30 = dayFloor(now - 62 * 86400e3); // 600 hourly bars of warm-up
  const within = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
    Promise.race([p.catch(() => null), new Promise<null>((res) => setTimeout(() => res(null), ms))]);
  const endIso = opts.replayCutoffMs ? new Date(opts.replayCutoffMs).toISOString() : undefined;
  // Snapshot first: it is a single fast call and gives the price the
  // chain window needs, so the chain can load alongside the bars.
  const [clock, snaps] = await Promise.all([
    clockP,
    opts.replayCutoffMs ? Promise.resolve({}) : getStockSnapshots([dataSymbol, "SPY", "QQQ"]).catch(() => ({})),
  ]);
  mark("snapshot+clock");
  const marketOpen = clock?.is_open ?? false;
  // Index mode: everything the proxy reports gets scaled into index points.
  let ratioInfo: Awaited<ReturnType<typeof getIndexRatio>> | null = null;
  if (index) {
    try {
      ratioInfo = await getIndexRatio(index);
    } catch (e) {
      notes.push(`${index.symbol}: reference closes unavailable (${e instanceof Error ? e.message : "error"}).`);
      return { ...empty, connected: true };
    }
  }
  const scale = ratioInfo?.ratio ?? 1;
  const preSnap = (snaps as Record<string, { latestTrade?: { p: number } }>)[dataSymbol];
  const prePrice = preSnap?.latestTrade?.p ? preSnap.latestTrade.p * scale : null;
  // Same-day traders only ever see the two nearest expiries, so do not
  // pull two weeks of chain for them; the band is tighter as well.
  const chainDays = profileName === "DAY" ? 8 : 15;
  const band = profileName === "DAY" ? 0.045 : 0.06;
  const expLtePre = new Date(now + chainDays * 86400e3).toISOString().slice(0, 10);
  const chainEarly = prePrice && index
    ? getCboeChain(index.cboe, { strikeGte: prePrice * (1 - band), strikeLte: prePrice * (1 + band), expirationLte: expLtePre, expirationGte: etStamp(now).date })
        .then((c) => [c.snapshots, Array.from(c.openInterest, ([sym, oi]) => ({ symbol: sym, open_interest: oi }))] as const)
        .catch((e: unknown) => {
          notes.push(`CBOE option chain unavailable: ${e instanceof Error ? e.message : "error"}`);
          return [{} as Record<string, OptionSnapshot>, [] as { symbol: string; open_interest: number }[]] as const;
        })
    : prePrice
    ? Promise.all([
        getOptionChain(symbol, { strikeGte: prePrice * (1 - band), strikeLte: prePrice * (1 + band), expirationLte: expLtePre }).catch((e: unknown) => {
          notes.push(`Option chain unavailable: ${e instanceof Error ? e.message : "error"}`);
          return {} as Record<string, OptionSnapshot>;
        }),
        getOptionContracts(symbol, { expirationLte: expLtePre, strikeGte: prePrice * (1 - band), strikeLte: prePrice * (1 + band) }).catch(() => []),
      ])
    : null;
  const [m1raw, dailyRaw, m5LongRaw, m30LongRaw, idxDaily, idxMinutes, cboeOi] = await Promise.all([
    getStockBars(dataSymbol, "1Min", startMin, endIso, 5_000),
    getStockBars(dataSymbol, "1Day", startDay, endIso, 300_000),
    // Warm-up history never holds the analysis up: if it is not in by the
    // deadline this pass goes without it and the next refresh reads the cache.
    within(getStockBars(dataSymbol, "5Min", startM5, endIso, 600_000), 2_500).then((b) => b ?? []),
    within(getStockBars(dataSymbol, "30Min", startM30, endIso, 600_000), 2_500).then((b) => b ?? []),
    index ? getCboeIndexDaily(index.cboe).catch(() => []) : Promise.resolve([]),
    index && live ? getCboeIndexMinutes(index.cboe).catch(() => []) : Promise.resolve([]),
    // Open interest: this morning's OCC figure from CBOE. Alpaca's is often two sessions old.
    !index && live ? within(getCboeOpenInterest(symbol), 3_500) : Promise.resolve(null),
  ]);
  mark("bars+history+oi");
  // Bad prints out first, so nothing downstream builds a level on one.
  const cleanM1 = sanitizeBars(m1raw.map(toBar), { minPct: 0.012 });
  const cleanDaily = sanitizeBars(dailyRaw.map(toBar), { minPct: 0.03 });
  const cleanM5Long = sanitizeBars(m5LongRaw.map(toBar), { minPct: 0.015 }).bars;
  const cleanM30Long = sanitizeBars(m30LongRaw.map(toBar), { minPct: 0.02 }).bars;
  const todayEt = etStamp(now).date;
  // Index mode: each session is scaled by its own real close ratio, then
  // today's real index minutes (up to CBOE's delay) replace the estimate.
  const ratios = index ? dayRatios(idxDaily, cleanDaily.bars) : null;
  const toIndex = (bars: Bar[]) => (index && ratios ? scaleIntradayByDay(bars, ratios, todayEt, scale) : bars);
  let m1 = toIndex(cleanM1.bars);
  if (index && idxMinutes.length) m1 = overlayRealMinutes(m1, idxMinutes);
  if (opts.replayCutoffMs) m1 = m1.filter((b) => b.t <= opts.replayCutoffMs!);
  let dailyAll = index && ratios ? indexDailyBars(idxDaily, cleanDaily.bars, scale) : cleanDaily.bars;
  if (index && idxDaily.length === 0) notes.push(`${index.symbol}: the real daily history did not load from CBOE, so daily bars are ${index.proxy} scaled by one ratio and older bars can sit a few points off.`);
  if (m1.length < 30) {
    notes.push(`No recent trading data for ${symbol}. Check the ticker: it may have changed (for example BK became BNY), been delisted, or be an index rather than a stock.`);
    return { ...empty, connected: true, marketOpen };
  }

  mark("clean+scale");
  const snap = (snaps as Record<string, { latestTrade?: { p: number; t: string }; prevDailyBar?: { c: number }; dailyBar?: { t: string; o: number; h: number; l: number; c: number; v: number; vw: number } }>)[dataSymbol];
  const lastBar = m1[m1.length - 1];
  // When the market is closed (weekend/overnight) the analysis anchors
  // to the most recent session instead of an empty calendar day.
  const anchor = Math.min(now, lastBar.t);
  const lastTradeTs = snap?.latestTrade ? Date.parse(snap.latestTrade.t) : lastBar.t;
  const price = snap?.latestTrade?.p ? Math.round(snap.latestTrade.p * scale * 100) / 100 : lastBar.c;
  // Today's daily candle: the daily history is cached for minutes, so the
  // newest bar is rebuilt from the freshest source on every pass.
  {
    const sessionNow = sessionOf(now);
    const lastDaily = dailyAll[dailyAll.length - 1];
    const lastIsToday = lastDaily ? etStamp(lastDaily.t).date === todayEt : false;
    let todayBar: Bar | null = null;
    if (live && index) {
      const rthToday = m1.filter((b) => etStamp(b.t).date === todayEt && sessionOf(b.t) === "rth");
      if (rthToday.length) {
        const v = rthToday.reduce((a, b) => a + b.v, 0);
        todayBar = {
          t: lastIsToday ? lastDaily.t : etMidnightMs(todayEt),
          o: rthToday[0].o, h: Math.max(...rthToday.map((b) => b.h)), l: Math.min(...rthToday.map((b) => b.l)), c: rthToday[rthToday.length - 1].c,
          v, vw: v > 0 ? Math.round((rthToday.reduce((a, b) => a + b.vw * b.v, 0) / v) * 100) / 100 : rthToday[rthToday.length - 1].c,
        };
      }
    } else if (live && snap?.dailyBar && etStamp(Date.parse(snap.dailyBar.t)).date === todayEt) {
      const d = snap.dailyBar;
      const inRth = sessionNow === "rth";
      todayBar = { t: Date.parse(d.t), o: d.o, h: inRth ? Math.max(d.h, price) : d.h, l: inRth ? Math.min(d.l, price) : d.l, c: inRth ? price : d.c, v: d.v, vw: d.vw ?? d.c };
    }
    if (todayBar) dailyAll = lastIsToday ? [...dailyAll.slice(0, -1), todayBar] : [...dailyAll, todayBar];
  }
  // Everything that reads structure keeps the ~14 months it always had.
  const daily = dailyAll.slice(-290);
  const prevDaily = daily.filter((d) => etStamp(d.t).date < etStamp(Math.min(now, m1[m1.length - 1].t)).date);
  const prevClose = ratioInfo ? ratioInfo.indexPrevClose : (live ? referenceClose(snap, now) : null) ?? prevDaily[prevDaily.length - 1]?.c ?? null;
  const badPrints: OptionsAnalysis["badPrints"] = [
    ...cleanM1.fixes.slice(-5).map((f) => ({ at: new Date(f.t).toISOString(), frame: "1m" as const, field: f.field, from: f.from, to: f.to })),
    ...cleanDaily.fixes.filter((f) => f.t >= (daily[0]?.t ?? 0)).map((f) => ({ at: new Date(f.t).toISOString(), frame: "D" as const, field: f.field, from: f.from, to: f.to })),
  ];
  if (badPrints.length) {
    const d = badPrints.filter((b) => b.frame === "D").map((b) => `${etStamp(Date.parse(b.at) + 12 * 3600e3).date} ${b.field === "l" ? "low" : "high"} ${b.from}`);
    notes.push(`${badPrints.length} bad print${badPrints.length === 1 ? "" : "s"} removed from the bars${d.length ? ` (daily: ${d.join(", ")})` : ""}. The wick was pulled back to that bar's own open/close.`);
  }
  if (index && ratioInfo) {
    const fit = ratioInfo.calibratedAt
      ? `re-fit to the CBOE print at ${etStamp(Date.parse(ratioInfo.calibratedAt)).hm} ET, so the chart sits within about a point of the real index`
      : "ratio from yesterday's closes; re-fits to CBOE prints once the session is open";
    const real = idxMinutes.length ? `Today's minutes up to ${etStamp(idxMinutes[idxMinutes.length - 1].t + 60_000).hm} ET and the daily bars are the real index from CBOE; newer minutes are` : "The chart is";
    notes.push(`${index.symbol} mode: ${real} ${index.proxy} x ${ratioInfo.ratio.toFixed(4)} in real time (${fit}). Earlier days use each day's own close ratio. Option quotes are CBOE delayed about 15 minutes. Index options are not tradeable on the Alpaca paper account; use your broker.`);
  }
  const changePct = prevClose ? Math.round(((price - prevClose) / prevClose) * 10000) / 100 : null;

  // RVOL, like for like: today's volume in the session window so far over
  // the average the same stock traded in that same window on the last 20
  // sessions. (Measuring today's minutes against the daily bar's volume
  // read about 15% low all day, 40% on some names: the daily figure
  // includes the closing auction and extended hours.)
  const today = etStamp(anchor).date;
  const nowStamp = etStamp(now);
  const sessionNow = sessionOf(now);
  const liveDay = nowStamp.date === today;
  const rvolWindow: [number, number] = liveDay && sessionNow === "rth" ? [9 * 60 + 30, nowStamp.minutes]
    : liveDay && sessionNow === "premarket" ? [4 * 60, nowStamp.minutes]
    : [9 * 60 + 30, 16 * 60];
  const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
  const history = await getCachedHistory(dataSymbol).catch(() => null);
  const likeForLike = sameTimeRvol(cleanM1.bars, cleanM5Long, today, rvolWindow[0], rvolWindow[1], 5);
  let rvol: number | null;
  let rvolBasis: OptionsAnalysis["rvolBasis"];
  if (likeForLike) {
    rvol = likeForLike.rvol;
    rvolBasis = { method: "same-time", sessions: likeForLike.sessions, window: `${hm(rvolWindow[0])} to ${hm(rvolWindow[1])} ET` };
  } else {
    // Estimate: regular-hours volume so far against the regular-hours share
    // of an average day, spread over the day by a volume curve.
    const inWindow = (b: Bar) => { const s = etStamp(b.t); return s.date === today && s.minutes >= rvolWindow[0] && s.minutes < Math.max(rvolWindow[1], rvolWindow[0] + 1); };
    const todayVol = cleanM1.bars.filter(inWindow).reduce((a, b) => a + b.v, 0);
    const share = sessionNow === "premarket" && liveDay ? 1 : regularHoursShare(cleanM1.bars, cleanDaily.bars, today) ?? 0.8;
    const avgDaily = (prevDaily.slice(-20).reduce((a, b) => a + b.v, 0) / Math.max(1, Math.min(20, prevDaily.length))) * share;
    rvol = history?.volumeProfile
      ? rvolFromProfile(todayVol, avgDaily, history.volumeProfile, anchor)
      : timeAdjustedRvol(todayVol, avgDaily, anchor);
    rvolBasis = rvol === null ? null : { method: "estimate", sessions: Math.min(20, prevDaily.length), window: `${hm(rvolWindow[0])} to ${hm(rvolWindow[1])} ET` };
  }

  mark("history-cache");
  const levels = buildLevels({ minuteBars: m1, dailyBars: daily, nowMs: anchor });
  const trend = intradayTrend(m1, { rvol });
  // Re-read the trend at 5-minute steps over the last hour to see whether
  // it has been flip-flopping (a premarket "bearish -> bullish" in twenty
  // minutes on thin volume is noise, and a newer trader should be told so).
  const flipLabels: IntradayTrend[] = [];
  for (let back = 60; back >= 0; back -= 5) {
    const sub = m1.filter((b) => b.t <= now - back * 60e3);
    const r = sub.length >= 30 ? intradayTrend(sub, { rvol }) : null;
    if (r) flipLabels.push(r.label);
  }
  const trendFlips = countTrendFlips(flipLabels);
  const choppy = trend !== null && (trend.confidence < 30 || trendFlips >= 2);
  const vwapSeries = sessionVwapSeries(m1);
  const vwap = vwapSeries[vwapSeries.length - 1] ?? null;
  const m5 = resample(m1, 5);
  const session = sessionOf(now);
  const slot = daySlot(anchor);
  if (!marketOpen && !opts.replayCutoffMs) notes.push(`Market closed — showing the ${today} session.`);
  const dataStale = marketOpen && Date.now() - lastTradeTs > 90_000 && !opts.replayCutoffMs;
  if (dataStale) notes.push("Underlying data is stale — analysis paused on last known prints.");

  if (!levels) {
    notes.push("Level engine needs more bars.");
    return { ...empty, connected: true, marketOpen, price, changePct, prevClose, rvol, trend, session, slot };
  }

  mark("levels+trend");
  // Direction from trend; neutral defaults to the long side with a note.
  // A choppy 5-minute read should not flip the plan between calls and puts
  // every few minutes; lean on the daily chart for the side instead.
  const dailyRead = choppy && daily.length >= 30 ? readTrend(symbol, daily) : null;
  let direction: SetupDirection = dailyRead
    ? (/Bear/.test(String(dailyRead.label)) ? "short" : "long")
    : trend && /Bearish/.test(trend.label) ? "short" : "long";
  if (!trend || trend.label === "Neutral") notes.push("Trend is neutral — setup shown for the long side with low conviction.");

  // Trigger: nearest meaningful opposing zone in the setup direction.
  const pickFresh = (dir: SetupDirection): number | null => {
    const opposing = levels.zones
      .filter((z) => z.strength >= 60)
      .filter((z) => (dir === "long" ? z.price > price * 1.0002 : z.price < price * 0.9998))
      .sort((a, b) => (dir === "long" ? a.price - b.price : b.price - a.price));
    return opposing[0]?.price ?? null;
  };

  let machine: MachineState | null = null;
  let plan: TradePlan | null = null;
  let room: ReturnType<typeof roomToMove> | null = null;
  let lockInfo: OptionsAnalysis["lock"] = null;
  let trigger: number | null = null;
  const atr = levels.atr5m ?? price * 0.004;
  // Daily ATR for target synthesis when intraday structure runs out.
  const dailyTr = prevDaily.slice(-15).map((d, i, arr) => (i === 0 ? d.h - d.l : Math.max(d.h - d.l, Math.abs(d.h - arr[i - 1].c), Math.abs(d.l - arr[i - 1].c))));
  const dailyAtr = dailyTr.length ? dailyTr.reduce((a, b) => a + b, 0) / dailyTr.length : price * 0.02;
  const todays5 = m5.filter((b) => etStamp(b.t).date === today && sessionOf(b.t) !== "closed");
  const runWith = (dir: SetupDirection, trig: number, inval: number) =>
    runMachine(todays5, { direction: dir, trigger: trig, invalidation: inval, atr, vwap, rvol }, DEFAULT_BREAKOUT_CONFIG);

  // Sticky level: once a trigger is picked for today it stays until the
  // setup resolves, so "break here" never walks away from the trader.
  // Levels only lock once the opening range has settled (9:45 ET). Before
  // that the plan is provisional: premarket and the first fifteen minutes
  // draw levels on thin or chaotic volume that rarely survive.
  const nowEt = etStamp(now);
  const afterOpeningRange = sessionOf(now) === "rth" && nowEt.minutes >= 9 * 60 + 45;
  const canLock = !opts.replayCutoffMs && afterOpeningRange;
  const stored = !opts.replayCutoffMs && sessionOf(now) !== "closed" ? await getLock(symbol, today).catch(() => null) : null;
  let existing = stored;
  if (existing && etStamp(Date.parse(existing.pickedAt)).minutes < 9 * 60 + 45) {
    await releaseLock(symbol, today, "picked before the opening range").catch(() => undefined);
    existing = null;
  }
  if (!afterOpeningRange && sessionOf(now) !== "closed") {
    notes.push("Levels are provisional until 9:45 ET. The plan locks once the opening range has settled; no entries before then.");
  }
  if (existing) {
    const m = runWith(existing.direction, existing.trigger, existing.invalidation);
    const d = lockDecision(existing, m.state, direction);
    if (d.keep) {
      direction = existing.direction;
      trigger = existing.trigger;
      plan = existing.plan;
      machine = m;
      lockInfo = { pickedAt: existing.pickedAt, pickedPrice: existing.pickedPrice };
    } else {
      await releaseLock(symbol, today, d.reason ?? "resolved").catch(() => undefined);
      notes.push(`Locked level ${existing.trigger.toFixed(2)} released (${d.reason}); picking a fresh one.`);
    }
  }
  if (!plan) {
    trigger = pickFresh(direction);
    if (trigger !== null) {
      plan = buildTradePlan(direction, trigger, levels.zones, atr, DEFAULT_BREAKOUT_CONFIG, 60, dailyAtr);
      machine = runWith(direction, trigger, plan.invalidation);
      if (canLock) {
        const saved = await saveLock({ symbol, day: today, direction, trigger, invalidation: plan.invalidation, plan, pickedPrice: price }).catch(() => null);
        if (saved) lockInfo = { pickedAt: saved.pickedAt, pickedPrice: price };
      }
    } else {
      notes.push("No meaningful level found in the trend direction — WATCHING only.");
    }
  }
  if (trigger !== null) {
    const t = trigger;
    room = roomToMove(price, direction, levels.zones.filter((z) => Math.abs(z.price - t) > atr * 0.2), atr);
  }

  mark("lock+plan");
  // ── Option chain: 2 nearest expiries, strikes within ±6% ──
  const wantSide = direction === "long" ? "call" : "put";
  const expLte = new Date(now + chainDays * 86400e3).toISOString().slice(0, 10);
  const [chain, contractMeta] = chainEarly
    ? await chainEarly
    : await Promise.all([
        getOptionChain(dataSymbol, {
          strikeGte: price * (1 - band),
          strikeLte: price * (1 + band),
          expirationLte: expLte,
        }).catch((e) => {
          notes.push(`Option chain unavailable: ${e instanceof Error ? e.message : "error"}`);
          return {} as Record<string, OptionSnapshot>;
        }),
        getOptionContracts(dataSymbol, {
          expirationLte: expLte, strikeGte: price * (1 - band), strikeLte: price * (1 + band),
        }).catch(() => []),
      ]);
  const alpacaOi = new Map(contractMeta.map((c) => [c.symbol, Number(c.open_interest ?? 0)]));
  const oiOf = (occ: string): number => cboeOi?.byOcc.get(occ) ?? alpacaOi.get(occ) ?? 0;
  const alpacaOiDate = (contractMeta as { open_interest_date?: string | null }[]).map((c) => c.open_interest_date ?? "").filter(Boolean).sort().pop() ?? null;
  const openInterest: OptionsAnalysis["openInterest"] = index || cboeOi
    ? { source: "CBOE", asOf: cboeOi?.asOf ?? null }
    : contractMeta.length ? { source: "Alpaca", asOf: alpacaOiDate } : null;
  if (openInterest?.source === "Alpaca" && live) {
    notes.push(`Open interest is Alpaca's figure${alpacaOiDate ? ` from ${alpacaOiDate}` : ""}; this morning's CBOE figure did not load, so liquidity may be understated.`);
  }

  mark("chain");
  const expectedMove = plan ? Math.abs(plan.targets[0] - price) : null;
  const profile = SCORE_PROFILES[profileName];
  const contracts: RankedContract[] = [];
  for (const [occ, s] of Object.entries(chain)) {
    const p = parseOcc(occ);
    if (!p) continue;
    const q = s.latestQuote;
    if (!q || (q.bp <= 0 && q.ap <= 0)) continue;
    const quoteTs = q.t ? Date.parse(q.t) : null;
    // CBOE feeds are delayed by design; that is disclosed, not flagged as a dead quote.
    const stale = index ? false : isQuoteStale(quoteTs, Date.now(), marketOpen && !opts.replayCutoffMs);
    const midPrice = midOf(q.bp, q.ap);
    let iv = s.impliedVolatility ?? null;
    let greeks = s.greeks ?? null;
    let greeksSource: "alpaca" | "calculated" | "none" = greeks ? "alpaca" : "none";
    if (!greeks && iv && iv > 0) {
      const T = yearsToExpiry(p.expiry, now);
      const bs = blackScholes(p.side, price, p.strike, T, iv);
      greeks = { delta: bs.delta, gamma: bs.gamma, theta: bs.theta, vega: bs.vega };
      greeksSource = "calculated";
    }
    if (!iv && midPrice > 0) {
      // Implied from mid so scoring/scenarios still work, tagged calculated.
      const T = yearsToExpiry(p.expiry, now);
      const solved = impliedVol(p.side, price, p.strike, T, midPrice);
      if (solved) {
        iv = solved;
        if (!greeks) {
          const bs = blackScholes(p.side, price, p.strike, T, solved);
          greeks = { delta: bs.delta, gamma: bs.gamma, theta: bs.theta, vega: bs.vega };
          greeksSource = "calculated";
        }
      }
    }

    const facts: ContractFacts = {
      symbol: occ, side: p.side, strike: p.strike, expiry: p.expiry,
      bid: q.bp, ask: q.ap, last: s.latestTrade?.p ?? null,
      volume: s.dailyBar?.v ?? 0, openInterest: oiOf(occ),
      iv, delta: greeks?.delta ?? null, gamma: greeks?.gamma ?? null,
      theta: greeks?.theta ?? null, vega: greeks?.vega ?? null,
      greeksSource, quoteTs, underlying: price, expectedMove, stale,
    };
    const sc = scoreContract(facts, profile);
    contracts.push({
      symbol: occ, side: p.side, strike: p.strike, expiry: p.expiry, dte: Math.round(dteOf(p.expiry, now) * 10) / 10,
      bid: q.bp, ask: q.ap, mid: Math.round(midPrice * 100) / 100, last: s.latestTrade?.p ?? null,
      spreadDollars: Math.round(spreadDollars(q.bp, q.ap) * 100) / 100,
      spreadPct: spreadPct(q.bp, q.ap) !== null ? Math.round(spreadPct(q.bp, q.ap)! * 10) / 10 : null,
      volume: s.dailyBar?.v ?? 0, openInterest: oiOf(occ),
      iv: iv !== null ? Math.round(iv * 1000) / 1000 : null,
      delta: greeks?.delta != null ? Math.round(greeks.delta * 1000) / 1000 : null,
      gamma: greeks?.gamma != null ? Math.round(greeks.gamma * 10000) / 10000 : null,
      theta: greeks?.theta != null ? Math.round(greeks.theta * 1000) / 1000 : null,
      vega: greeks?.vega != null ? Math.round(greeks.vega * 1000) / 1000 : null,
      greeksSource,
      intrinsic: Math.round(intrinsicValue(p.side, p.strike, price) * 100) / 100,
      extrinsic: Math.round(extrinsicValue(p.side, p.strike, price, midPrice) * 100) / 100,
      breakEven: Math.round(breakEvenAtExpiry(p.side, p.strike, midPrice) * 100) / 100,
      moneyness: sc.moneyness, quoteTs, stale, score: sc.total, why: whyContract(sc),
      tag: null, parts: sc.parts.map((x) => ({ name: x.name, score: x.score, max: x.max })), penalties: sc.penalties, warnings: [],
    });
  }
  contracts.sort((a, b) => b.score - a.score);
  // Trader-facing warnings for every contract; scorer parts only for the top 24.
  contracts.forEach((c, i) => {
    c.warnings = contractWarnings(c, profile.maxSpreadPct, price).map((w) => w.text);
    if (i >= 24) c.parts = [];
  });

  // Same-day profile: a soft DTE weight is not enough (a weekend makes
  // Monday's expiry look like 2.5 calendar days). Hard-limit the
  // candidates to the next two expirations on the board; the full
  // chain stays available in the chain tab.
  let eligible = contracts;
  if (profileName === "DAY") {
    const nearest = Array.from(new Set(contracts.map((c) => c.expiry))).sort().slice(0, 2);
    eligible = contracts.filter((c) => nearest.includes(c.expiry));
    if (nearest.length) notes.push(`Same-day profile: best contracts limited to the ${nearest.join(" and ")} expirations.`);
  }

  const sameSide = eligible.filter((c) => c.side === wantSide);
  const best = sameSide[0] ?? null;
  for (const side of ["call", "put"] as const) {
    const tags = tagContracts(eligible.filter((c) => c.side === side));
    for (const c of contracts) if (tags.has(c.symbol)) c.tag = tags.get(c.symbol)!;
  }

  let scenarios: OptionsAnalysis["scenarios"] = null;
  if (best && plan) {
    const input = {
      side: best.side, strike: best.strike, expiry: best.expiry,
      iv: best.iv, currentMid: best.mid, underlyingNow: price, now,
    };
    const pts: ScenarioPoint[] = [
      scenarioPrice(input, plan.trigger, 30, "Trigger"),
      scenarioPrice(input, plan.targets[0], 60, "Target 1"),
      scenarioPrice(input, plan.targets[1], 120, "Target 2"),
      scenarioPrice(input, plan.targets[2], 240, "Target 3"),
      scenarioPrice(input, plan.invalidation, 60, "Invalidation"),
    ];
    scenarios = { contract: best.symbol, points: pts };
  }

  type CtxSnap = { latestTrade?: { p: number }; dailyBar?: { t: string; c: number }; prevDailyBar?: { c: number } };
  const spySnap = (snaps as Record<string, CtxSnap>)["SPY"];
  const qqqSnap = (snaps as Record<string, CtxSnap>)["QQQ"];
  const ctxPct = (s?: CtxSnap) => {
    const ref = referenceClose(s, now);
    return s?.latestTrade && ref ? Math.round(((s.latestTrade.p - ref) / ref) * 10000) / 100 : null;
  };

  const mtfCount = trigger !== null
    ? (levels.zones.find((z) => Math.abs(z.price - trigger) < atr * 0.2)?.timeframes.length ?? 1)
    : 0;
  const opportunity = plan && machine
    ? opportunityScore({
        trendConfidence: trend?.confidence ?? 0,
        trendAligned: trend ? (direction === "long" ? /Bullish/.test(trend.label) : /Bearish/.test(trend.label)) : false,
        setupQuality: machine.quality,
        setupState: machine.state,
        rvol,
        roomAtr: room?.atrMultiple ?? 0,
        rrToT1: plan.rewardToTargets[0]?.rr ?? 0,
        contractScore: best?.score ?? null,
        mtfAgreeingTimeframes: mtfCount,
        slotPenalty: sessionPenalty(slot),
      })
    : null;

  // Both sides, always: a newer trader needs to see the best call AND the
  // best put with what each could be worth at the levels that matter.
  const strongZones = levels.zones.filter((z) => z.strength >= 65);
  const buildSide = (side: "call" | "put"): SideView => {
    const list = eligible.filter((c) => c.side === side);
    const bestC = list[0] ?? null;
    const upward = side === "call";
    const forward = strongZones
      .filter((z) => (upward ? z.price > price * 1.0005 : z.price < price * 0.9995))
      .sort((a, b) => (upward ? a.price - b.price : b.price - a.price))
      .slice(0, 3);
    const wrong = strongZones
      .filter((z) => (upward ? z.price < price * 0.9995 : z.price > price * 1.0005))
      .sort((a, b) => (upward ? b.price - a.price : a.price - b.price))[0] ?? null;
    const scen = (target: number, minutes: number, label: string) =>
      bestC
        ? scenarioPrice({ side, strike: bestC.strike, expiry: bestC.expiry, iv: bestC.iv, currentMid: bestC.mid, underlyingNow: price, now }, target, minutes, label)
        : null;
    // Same-day traders need tighter horizons: what is it worth if the
    // stock gets there within the next half hour, hour, two hours.
    const step = profileName === "DAY" ? 30 : 60;
    const ladder: LadderRung[] = forward.map((z, i) => ({
      label: `${upward ? "Resistance" : "Support"} ${i + 1} (strength ${z.strength})`,
      price: z.price,
      kind: "level" as const,
      est: scen(z.price, step * (i + 1), `L${i + 1}`),
    }));
    // Fill to three rungs with the plan's daily-scale targets when structure runs out.
    if (ladder.length < 3 && plan && ((upward && direction === "long") || (!upward && direction === "short"))) {
      for (const t of plan.targets) {
        if (ladder.length >= 3) break;
        if (!ladder.some((r) => Math.abs(r.price - t) < atr * 0.3)) {
          ladder.push({ label: `Target ${ladder.length + 1}`, price: t, kind: "target", est: scen(t, step * (ladder.length + 1), "T") });
        }
      }
    }
    if (wrong) ladder.push({ label: `Wrong ${upward ? "below" : "above"} (strength ${wrong.strength})`, price: wrong.price, kind: "wrong", est: scen(wrong.price, 60, "wrong") });
    const firstTarget = ladder.find((r) => r.kind !== "wrong")?.price ?? null;
    const choices = bestC
      ? strikeChoices({
          side, candidates: list, best: bestC, underlying: price, target: firstTarget, wrong: wrong?.price ?? null, now, stepMinutes: step,
        })
      : [];
    return { side, best: bestC, alternatives: list.slice(1, 4), ladder, choices, verdict: coachVerdict(choices, symbol) };
  };
  const sides = { call: buildSide("call"), put: buildSide("put") };

  const summary = plainSummary({
    symbol, price, trend, direction, state: machine?.state ?? null, plan, room, rvol, marketOpen, choppy, trendFlips,
  });
  if (profileName === "DAY") {
    const fav = direction === "long" ? sides.call.best : sides.put.best;
    if (fav && fav.mid > 0) {
      // Cost of waiting: reprice the contract one hour from now at the
      // same stock price. Dividing a per-day theta by the hours in a
      // session overstates it badly on a same-day contract.
      const inAnHour = scenarioPrice({ side: fav.side, strike: fav.strike, expiry: fav.expiry, iv: fav.iv, currentMid: fav.mid, underlyingNow: price, now }, price, 60, "1h");
      const perHour = Math.max(0, (fav.mid - inAnHour.midEstimate) * 100);
      if (inAnHour.method !== "intrinsic-only" && perHour >= 1) {
        summary.push(
          `You trade same-day expiries: the ${fav.strike}${fav.side === "call" ? "C" : "P"} is estimated to lose about $${perHour.toFixed(0)} per contract over the next hour if ${symbol} sits still, so the move has to come soon or the trade bleeds.`
        );
      }
    }
  }

  mark("contracts+sides");
  // The same setup read on every timeframe, plus one alignment sentence.
  const setups = buildTimeframeSetups({
    symbol, minuteBars: m1, dailyBars: daily, intradayZones: levels.zones, price, rvolIntraday: rvol, nowMs: anchor,
  });
  // The 5m row IS the primary read (plan card, chart, siren). Mirror it
  // exactly so the table can never disagree with the card above it.
  const primaryIdx = setups.findIndex((s) => s.tf === "5m");
  if (primaryIdx >= 0 && trend) {
    const label = /Strongly Bullish/.test(trend.label) ? "Strong Bullish" : /Bullish/.test(trend.label) ? "Bullish"
      : /Strongly Bearish/.test(trend.label) ? "Strong Bearish" : /Bearish/.test(trend.label) ? "Bearish" : "Neutral";
    setups[primaryIdx] = {
      ...setups[primaryIdx],
      trend: label, direction, trigger, plan, room,
      state: machine?.state ?? (plan ? "WATCHING" : null), quality: machine?.quality ?? 0,
      note: plan ? null : setups[primaryIdx].note,
    };
  }
  summary.push(alignmentSummary(setups, direction));

  mark("setups");
  // Compact timeframe matrix and its alignment with the plan.
  const setupStates: Partial<Record<MatrixRow["tf"], string | null>> = {};
  for (const s of setups) if (s.tf !== "W") setupStates[s.tf] = s.state;
  // Long history on the chart's grid: provider bars up to the fresh minutes, then the minutes themselves.
  const m5Full = stitch(toIndex(cleanM5Long), m5);
  const m30Full = stitch(toIndex(cleanM30Long), resample(m1, 30));
  const matrix = buildMatrix({ m1, daily, nowMs: anchor, setupStates, series: { m5: m5Full, m30: m30Full, daily: dailyAll } });
  const align = plan ? alignRows(matrix, direction) : null;
  mark("matrix");
  // Catalyst: the whole-market sweep caches one headline per mover. A
  // name outside that cache is NOT MEASURED, never scored zero.
  const catalystRow = hasDatabase() && !opts.replayCutoffMs
    ? await queryOne<{ headline: string | null; publisher: string | null; tier: string | number | null; published_at: string | null; article_url: string | null }>(
        "select headline, publisher, tier, published_at, article_url from catalyst_news where symbol = $1", [dataSymbol]
      ).catch(() => null)
    : null;
  // Symbol news feeds (Yahoo, Google News, SEC) cover every name; the
  // refresh runs in the background so the analysis never waits on RSS.
  if (hasDatabase() && !opts.replayCutoffMs) void refreshSymbolNews(dataSymbol).catch(() => undefined);
  const feedCatalyst = hasDatabase() && !opts.replayCutoffMs ? await latestCatalyst(dataSymbol).catch(() => null) : null;
  const catalyst = catalystRow && catalystRow.headline
    ? { headline: catalystRow.headline, publisher: catalystRow.publisher, tier: Number(catalystRow.tier ?? 3) || 3, publishedAt: catalystRow.published_at, url: catalystRow.article_url }
    : feedCatalyst && feedCatalyst.headline
    ? { headline: feedCatalyst.headline, publisher: feedCatalyst.publisher, tier: feedCatalyst.tier, publishedAt: feedCatalyst.publishedAt, url: feedCatalyst.url }
    : null;
  const catalystMeasured = catalystRow !== null || (feedCatalyst?.measured ?? false);
  const triggerZone = trigger !== null ? levels.zones.find((z) => Math.abs(z.price - (trigger as number)) < atr * 0.2) ?? null : null;
  const confluence = plan
    ? scoreConfluence({
        direction, trendLabel: trend?.label ?? null, trendConfidence: trend?.confidence ?? null, choppy, rows: matrix, align,
        rvol, price, vwap, triggerStrength: triggerZone?.strength ?? null, room, machineQuality: machine?.quality ?? 0, machineState: machine?.state ?? null,
        catalyst: catalyst && catalyst.publishedAt ? { ageHours: Math.max(0, (now - Date.parse(catalyst.publishedAt)) / 3.6e6), tier: catalyst.tier } : null,
        catalystMeasured, contract: best ? { score: best.score, spreadPct: best.spreadPct, volume: best.volume, openInterest: best.openInterest } : null,
        maxSpreadPct: profile.maxSpreadPct,
      })
    : null;
  const lifecycle = lifecycleOf({ machineState: machine?.state ?? null, plan, extreme: machine?.extreme ?? null, direction, session, marketOpen, inTrade: false }).lifecycle;

  mark("catalyst+confluence");
  const shown = { m1: m1.slice(-480).map(slim), m5: m5.map(slim), daily: weekAlignedTail(dailyAll, 280).map(slim) };
  const result: OptionsAnalysis = {
    symbol, summary, stateExplain: machine ? STATE_EXPLAIN[machine.state] : null, sides, history, setups,
    connected: true, marketOpen, session, slot, asOf: new Date(now).toISOString(),
    price, changePct, prevClose, rvol, rvolBasis, atr5m: levels.atr5m, vwap, lastTradeTs, dataStale,
    // Payload diet: eight hours of 1-minute bars (the 1m view is for the
    // session at hand), rounded vwap, and the intraday timeframes do not
    // repeat the shared zone list (the client uses `zones` for those).
    bars: shown,
    warm: buildWarm({ m1All: m1, shown, m5Full, m30Full, dailyAll }),
    openInterest, badPrints,
    zones: levels.zones, keyMarks: levels.keyMarks,
    trend, trendFlips, choppy, lock: lockInfo, direction, machine, plan, room,
    indexMode: index && ratioInfo ? { proxy: index.proxy, ratio: Math.round(ratioInfo.ratio * 10000) / 10000, delayedPrice: ratioInfo.indexDelayedPrice, delayedAsOf: ratioInfo.indexAsOf, label: index.label } : null,
    contracts: contracts.slice(0, 80), best, scenarios, opportunity,
    context: { spy: ctxPct(spySnap), qqq: ctxPct(qqqSnap) },
    matrix, align, confluence, catalyst, lifecycle, timingMs: Date.now() - startedAt, stages,
    replayCutoff: opts.replayCutoffMs ? new Date(opts.replayCutoffMs).toISOString() : null,
    notes,
  };
  analysisCache.set(cacheKey, { at: Date.now(), data: result });
  if (analysisCache.size > 40) {
    for (const [k, v] of analysisCache) if (Date.now() - v.at > 60_000) analysisCache.delete(k);
  }
  return result;
}
