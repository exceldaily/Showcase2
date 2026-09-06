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
  buildLevels, daySlot, etStamp, intradayTrend, resample, sessionOf, sessionVwapSeries,
  timeAdjustedRvol, type LevelZone, type TrendResult,
} from "./intraday";
import {
  blackScholes, dte as dteOf, extrinsicValue, impliedVol, intrinsicValue, isQuoteStale,
  mid as midOf, parseOcc, scenarioPrice, spreadDollars, spreadPct, yearsToExpiry,
  breakEvenAtExpiry, type ScenarioPoint,
} from "./optionsMath";
import { SCORE_PROFILES, scoreContract, whyContract, type ContractFacts, type ContractScore } from "./optionsScore";
import {
  buildTradePlan, opportunityScore, roomToMove, runMachine, sessionPenalty,
  DEFAULT_BREAKOUT_CONFIG, type MachineState, type SetupDirection, type TradePlan,
} from "./setupMachine";
import { plainSummary, STATE_EXPLAIN } from "./plainEnglish";
import { getCachedHistory, rvolFromProfile, type SymbolHistory } from "./historyStats";
import { alignmentSummary, buildTimeframeSetups, type TfSetup } from "./multiTimeframe";

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
  atr5m: number | null;
  vwap: number | null;
  lastTradeTs: number | null;
  dataStale: boolean;
  /** 1m (last ~1200), 5m (all fetched), daily (~280). 15m/30m/1h/W are resampled client-side. */
  bars: { m1: Bar[]; m5: Bar[]; daily: Bar[] };
  zones: LevelZone[];
  keyMarks: { label: string; price: number }[];
  trend: TrendResult | null;
  direction: SetupDirection;
  machine: MachineState | null;
  plan: TradePlan | null;
  room: ReturnType<typeof roomToMove> | null;
  contracts: RankedContract[];
  best: RankedContract | null;
  scenarios: { contract: string; points: ScenarioPoint[] } | null;
  opportunity: ReturnType<typeof opportunityScore> | null;
  context: { spy: number | null; qqq: number | null };
  replayCutoff: string | null;
  notes: string[];
}

const analysisCache = new Map<string, { at: number; data: OptionsAnalysis }>();

function toBar(b: { t: string; o: number; h: number; l: number; c: number; v: number; vw?: number }): Bar {
  return { t: Date.parse(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, vw: b.vw ?? b.c };
}

/** Indexes are not tradeable on Alpaca; map to the ETF that tracks them. */
export const INDEX_ALIASES: Record<string, { etf: string; note: string }> = {
  SPX: { etf: "SPY", note: "SPX is an index (not tradeable here). Showing SPY, the ETF that tracks it; SPY options run about 1/10th the price of SPX options." },
  SPXW: { etf: "SPY", note: "SPXW is an index option series. Showing SPY instead." },
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
  const symbol = alias ? alias.etf : requested;
  const profileName = SCORE_PROFILES[opts.profile ?? ""] ? (opts.profile as string) : "BALANCED";
  const cacheKey = `${symbol}:${profileName}:${opts.replayCutoffMs ?? "live"}`;
  const hit = analysisCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 4_000) return hit.data;

  const notes: string[] = [];
  if (alias) notes.push(alias.note);
  const emptySide = (side: "call" | "put"): SideView => ({ side, best: null, alternatives: [], ladder: [] });
  const empty: OptionsAnalysis = {
    symbol, summary: [], stateExplain: null, sides: { call: emptySide("call"), put: emptySide("put") }, history: null, setups: [],
    connected: hasAlpacaKeys(), marketOpen: false, session: "closed", slot: "closed",
    asOf: new Date().toISOString(), price: null, changePct: null, prevClose: null, rvol: null,
    atr5m: null, vwap: null, lastTradeTs: null, dataStale: true,
    bars: { m1: [], m5: [], daily: [] }, zones: [], keyMarks: [],
    trend: null, direction: "long", machine: null, plan: null, room: null,
    contracts: [], best: null, scenarios: null, opportunity: null,
    context: { spy: null, qqq: null }, replayCutoff: opts.replayCutoffMs ? new Date(opts.replayCutoffMs).toISOString() : null,
    notes,
  };
  if (!hasAlpacaKeys()) {
    notes.push("Alpaca keys are not configured — no market data connection.");
    return empty;
  }

  const now = opts.replayCutoffMs ?? Date.now();
  const clock = await getClock().catch(() => null);
  const marketOpen = clock?.is_open ?? false;

  // 7 calendar days of minute bars + 130 daily bars.
  const startMin = new Date(now - 7 * 86400e3).toISOString();
  const startDay = new Date(now - 420 * 86400e3).toISOString(); // ~60 weekly bars for the W frame
  const endIso = opts.replayCutoffMs ? new Date(opts.replayCutoffMs).toISOString() : undefined;
  // Snapshot first: it is a single fast call and gives the price the
  // chain window needs, so the chain can load alongside the bars.
  const snaps = opts.replayCutoffMs ? {} : await getStockSnapshots([symbol, "SPY", "QQQ"]).catch(() => ({}));
  const preSnap = (snaps as Record<string, { latestTrade?: { p: number } }>)[symbol];
  const prePrice = preSnap?.latestTrade?.p ?? null;
  const expLtePre = new Date(now + 15 * 86400e3).toISOString().slice(0, 10);
  const chainEarly = prePrice
    ? Promise.all([
        getOptionChain(symbol, { strikeGte: prePrice * 0.94, strikeLte: prePrice * 1.06, expirationLte: expLtePre }).catch((e: unknown) => {
          notes.push(`Option chain unavailable: ${e instanceof Error ? e.message : "error"}`);
          return {} as Record<string, OptionSnapshot>;
        }),
        getOptionContracts(symbol, { expirationLte: expLtePre, strikeGte: prePrice * 0.94, strikeLte: prePrice * 1.06 }).catch(() => []),
      ])
    : null;
  const [m1raw, dailyRaw] = await Promise.all([
    getStockBars(symbol, "1Min", startMin, endIso),
    getStockBars(symbol, "1Day", startDay, endIso, 300_000),
  ]);
  let m1 = m1raw.map(toBar);
  const daily = dailyRaw.map(toBar);
  if (opts.replayCutoffMs) m1 = m1.filter((b) => b.t <= opts.replayCutoffMs!);
  if (m1.length < 30) {
    notes.push(`No recent trading data for ${symbol}. Check the ticker: it may have changed (for example BK became BNY), been delisted, or be an index rather than a stock.`);
    return { ...empty, connected: true, marketOpen };
  }

  const snap = (snaps as Record<string, { latestTrade?: { p: number; t: string }; prevDailyBar?: { c: number }; dailyBar?: { v: number } }>)[symbol];
  const lastBar = m1[m1.length - 1];
  // When the market is closed (weekend/overnight) the analysis anchors
  // to the most recent session instead of an empty calendar day.
  const anchor = Math.min(now, lastBar.t);
  const lastTradeTs = snap?.latestTrade ? Date.parse(snap.latestTrade.t) : lastBar.t;
  const price = snap?.latestTrade?.p ?? lastBar.c;
  const prevDaily = daily.filter((d) => etStamp(d.t).date < etStamp(Math.min(now, m1[m1.length - 1].t)).date);
  const prevClose = snap?.prevDailyBar?.c ?? prevDaily[prevDaily.length - 1]?.c ?? null;
  const changePct = prevClose ? Math.round(((price - prevClose) / prevClose) * 10000) / 100 : null;

  // RVOL: today's cumulative volume vs 20-day average, time adjusted.
  const today = etStamp(anchor).date;
  const todayVol = m1.filter((b) => etStamp(b.t).date === today).reduce((a, b) => a + b.v, 0);
  const avgDaily = prevDaily.slice(-20).reduce((a, b) => a + b.v, 0) / Math.max(1, Math.min(20, prevDaily.length));
  // RVOL against THIS symbol's own time-of-day volume profile when the
  // history cache has one (computed from Alpaca minute history);
  // otherwise the documented generic curve.
  const history = await getCachedHistory(symbol).catch(() => null);
  const rvol = history?.volumeProfile
    ? rvolFromProfile(todayVol, avgDaily, history.volumeProfile, anchor)
    : timeAdjustedRvol(todayVol, avgDaily, anchor);

  const levels = buildLevels({ minuteBars: m1, dailyBars: daily, nowMs: anchor });
  const trend = intradayTrend(m1, { rvol });
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

  // Direction from trend; neutral defaults to the long side with a note.
  const direction: SetupDirection = trend && /Bearish/.test(trend.label) ? "short" : "long";
  if (!trend || trend.label === "Neutral") notes.push("Trend is neutral — setup shown for the long side with low conviction.");

  // Trigger: nearest meaningful opposing zone in the setup direction.
  const opposing = levels.zones
    .filter((z) => z.strength >= 60)
    .filter((z) => (direction === "long" ? z.price > price * 1.0002 : z.price < price * 0.9998))
    .sort((a, b) => (direction === "long" ? a.price - b.price : b.price - a.price));
  const trigger = opposing[0]?.price ?? null;

  let machine: MachineState | null = null;
  let plan: TradePlan | null = null;
  let room: ReturnType<typeof roomToMove> | null = null;
  const atr = levels.atr5m ?? price * 0.004;
  // Daily ATR for target synthesis when intraday structure runs out.
  const dailyTr = prevDaily.slice(-15).map((d, i, arr) => (i === 0 ? d.h - d.l : Math.max(d.h - d.l, Math.abs(d.h - arr[i - 1].c), Math.abs(d.l - arr[i - 1].c))));
  const dailyAtr = dailyTr.length ? dailyTr.reduce((a, b) => a + b, 0) / dailyTr.length : price * 0.02;
  if (trigger !== null) {
    plan = buildTradePlan(direction, trigger, levels.zones, atr, DEFAULT_BREAKOUT_CONFIG, 60, dailyAtr);
    const todays5 = m5.filter((b) => etStamp(b.t).date === today && sessionOf(b.t) !== "closed");
    machine = runMachine(todays5, {
      direction, trigger, invalidation: plan.invalidation, atr, vwap, rvol,
    }, DEFAULT_BREAKOUT_CONFIG);
    room = roomToMove(price, direction, levels.zones.filter((z) => Math.abs(z.price - trigger) > atr * 0.2), atr);
  } else {
    notes.push("No meaningful level found in the trend direction — WATCHING only.");
  }

  // ── Option chain: 2 nearest expiries, strikes within ±6% ──
  const wantSide = direction === "long" ? "call" : "put";
  const expLte = new Date(now + 15 * 86400e3).toISOString().slice(0, 10);
  const [chain, contractMeta] = chainEarly
    ? await chainEarly
    : await Promise.all([
        getOptionChain(symbol, {
          strikeGte: price * 0.94,
          strikeLte: price * 1.06,
          expirationLte: expLte,
        }).catch((e) => {
          notes.push(`Option chain unavailable: ${e instanceof Error ? e.message : "error"}`);
          return {} as Record<string, OptionSnapshot>;
        }),
        getOptionContracts(symbol, {
          expirationLte: expLte, strikeGte: price * 0.94, strikeLte: price * 1.06,
        }).catch(() => []),
      ]);
  const oiBySymbol = new Map(contractMeta.map((c) => [c.symbol, Number(c.open_interest ?? 0)]));

  const expectedMove = plan ? Math.abs(plan.targets[0] - price) : null;
  const profile = SCORE_PROFILES[profileName];
  const contracts: RankedContract[] = [];
  for (const [occ, s] of Object.entries(chain)) {
    const p = parseOcc(occ);
    if (!p) continue;
    const q = s.latestQuote;
    if (!q || (q.bp <= 0 && q.ap <= 0)) continue;
    const quoteTs = q.t ? Date.parse(q.t) : null;
    const stale = isQuoteStale(quoteTs, Date.now(), marketOpen && !opts.replayCutoffMs);
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
      volume: s.dailyBar?.v ?? 0, openInterest: oiBySymbol.get(occ) ?? 0,
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
      volume: s.dailyBar?.v ?? 0, openInterest: oiBySymbol.get(occ) ?? 0,
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
    });
  }
  contracts.sort((a, b) => b.score - a.score);

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

  const spySnap = (snaps as Record<string, { latestTrade?: { p: number }; prevDailyBar?: { c: number } }>)["SPY"];
  const qqqSnap = (snaps as Record<string, { latestTrade?: { p: number }; prevDailyBar?: { c: number } }>)["QQQ"];
  const ctxPct = (s?: { latestTrade?: { p: number }; prevDailyBar?: { c: number } }) =>
    s?.latestTrade && s.prevDailyBar?.c ? Math.round(((s.latestTrade.p - s.prevDailyBar.c) / s.prevDailyBar.c) * 10000) / 100 : null;

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
    return { side, best: bestC, alternatives: list.slice(1, 4), ladder };
  };
  const sides = { call: buildSide("call"), put: buildSide("put") };

  const summary = plainSummary({
    symbol, price, trend, direction, state: machine?.state ?? null, plan, room, rvol, marketOpen,
  });
  if (profileName === "DAY") {
    const fav = direction === "long" ? sides.call.best : sides.put.best;
    if (fav && fav.theta !== null && fav.mid > 0) {
      // Theta is per calendar day; spread over the 6.5-hour session it
      // is a documented approximation of the hourly cost of waiting.
      const perHour = (Math.abs(fav.theta) * 100) / 6.5;
      summary.push(
        `You trade same-day expiries: the ${fav.strike}${fav.side === "call" ? "C" : "P"} loses roughly $${perHour.toFixed(0)} per contract per hour if ${symbol} sits still, so the move has to come soon or the trade bleeds.`
      );
    }
  }

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

  const result: OptionsAnalysis = {
    symbol, summary, stateExplain: machine ? STATE_EXPLAIN[machine.state] : null, sides, history, setups,
    connected: true, marketOpen, session, slot, asOf: new Date(now).toISOString(),
    price, changePct, prevClose, rvol, atr5m: levels.atr5m, vwap, lastTradeTs, dataStale,
    bars: { m1: m1.slice(-1200), m5, daily: daily.slice(-280) }, // enough daily for a ~1-year weekly chart
    zones: levels.zones, keyMarks: levels.keyMarks,
    trend, direction, machine, plan, room,
    contracts: contracts.slice(0, 80), best, scenarios, opportunity,
    context: { spy: ctxPct(spySnap), qqq: ctxPct(qqqSnap) },
    replayCutoff: opts.replayCutoffMs ? new Date(opts.replayCutoffMs).toISOString() : null,
    notes,
  };
  analysisCache.set(cacheKey, { at: Date.now(), data: result });
  if (analysisCache.size > 40) {
    for (const [k, v] of analysisCache) if (Date.now() - v.at > 60_000) analysisCache.delete(k);
  }
  return result;
}
