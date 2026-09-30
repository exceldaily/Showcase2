// ─────────────────────────────────────────────────────────
// Glue between the raw engine outputs and the setup read (pure).
// The live analysis and the history replay both go through
// assembleRead, so a replayed signal is the signal the live screen
// would have shown.
// ─────────────────────────────────────────────────────────

import type { Bar } from "../bars";
import { etStamp, resample } from "../intraday";
import { readStructure, type Structure } from "../timeframeMatrix";
import type { RoomResult, SetupDirection } from "../setupMachine";
import {
  buildRead, closedBars, momentumFacts, readBreakout, readChop, readMarket, regularBarsOf, scoreQuality, slotVolumeX, stableBias,
  type BiasSample, type BreakRead, type MarketLeg, type SetupRead,
} from "./engine";

export interface AssembleInput {
  /** ET date of the session being judged. */
  day: string;
  nowMs: number;
  session: string;
  marketOpen: boolean;
  direction: SetupDirection;
  plan: { trigger: number; invalidation: number; targets: number[]; rewardToTargets: { rr: number }[] } | null;
  /** When the level was chosen; the breakout is judged on bars from then on. */
  lockedAtMs: number | null;
  price: number | null;
  atr: number;
  vwap: number | null;
  rvol: number | null;
  /** 5-minute bars, oldest first, several sessions deep. The still-forming bar may be included; it is dropped here. */
  bars5: Bar[];
  slotBaseline: Map<number, number> | null;
  marketLegs: MarketLeg[];
  /** Timeframe matrix rows (any subset of 1m, 2m, 5m, 15m, 1h). */
  rows: { tf: string; trend: string }[];
  room: RoomResult | null;
  levelStrength: number | null;
  biasSamples: BiasSample[];
}

/** Flat facts about the moment, stored with every logged signal so results can be sliced later. */
export interface SignalFeatures {
  minutes: number;
  session: string;
  rvol: number | null;
  breakVolX: number | null;
  recentVolX: number | null;
  structure5: Structure;
  structure15: Structure;
  vwapSide: "with" | "against" | "n/a";
  vwapDistAtr: number | null;
  macdWith: boolean | null;
  rsi: number | null;
  emaWith: boolean | null;
  tfWith: number;
  tfAgainst: number;
  marketAligned: boolean | null;
  spyWith: boolean | null;
  qqqWith: boolean | null;
  sectorWith: boolean | null;
  chopScore: number;
  quality: number | null;
  qualityLabel: string | null;
  roomGrade: string | null;
  rr: number | null;
  levelStrength: number | null;
  bias: string;
  extAtr: number | null;
  via: string | null;
}

export interface Assembled {
  read: SetupRead;
  structure5: Structure;
  structure15: Structure;
  features: SignalFeatures;
}

const TF_KEYS = ["1m", "2m", "5m", "15m", "1h"];

/** Structure on the regular-hours 5-minute and 15-minute bars. */
export function structuresOf(closed5: Bar[]): { s5: Structure; s15: Structure } {
  const rth = closed5.filter((b) => { const m = etStamp(b.t).minutes; return m >= 570 && m < 960; });
  return { s5: readStructure(rth.slice(-40)).structure, s15: readStructure(resample(rth, 15).slice(-40)).structure };
}

export function assembleRead(i: AssembleInput): Assembled {
  const long = i.direction === "long";
  const closed = closedBars(i.bars5, i.nowMs);
  const { s5, s15 } = structuresOf(closed);
  const todayRth = regularBarsOf(closed, i.day);
  const chop = readChop({ bars: closed, day: i.day, atr: i.atr, rvol: i.rvol, structure: s5 });
  const market = readMarket(i.direction, i.marketLegs);
  const judged = i.lockedAtMs !== null ? todayRth.filter((b) => b.t + 300_000 > (i.lockedAtMs as number)) : todayRth;
  const breakout: BreakRead | null = i.plan
    ? readBreakout({ bars: judged, direction: i.direction, trigger: i.plan.trigger, invalidation: i.plan.invalidation, atr: i.atr, vwap: i.vwap, rvol: i.rvol, slotBaseline: i.slotBaseline, marketAligned: market.aligned })
    : null;
  const mom = momentumFacts(closed, i.direction);
  const last3 = todayRth.slice(-3).map((b) => slotVolumeX(b, i.slotBaseline)).filter((x): x is number => x !== null);
  const recentVolX = last3.length ? last3.reduce((a, b) => a + b, 0) / last3.length : null;
  const vwapDistAtr = i.price !== null && i.vwap !== null && i.atr > 0 ? ((long ? i.price - i.vwap : i.vwap - i.price) / i.atr) : null;
  const rows = i.rows.filter((r) => TF_KEYS.includes(r.tf));
  const want = long ? "BULL" : "BEAR", other = long ? "BEAR" : "BULL";
  const tfWith = rows.filter((r) => r.trend === want).length;
  const tfAgainst = rows.filter((r) => r.trend === other).length;
  const tfMeasured = rows.filter((r) => r.trend !== "N/A").length;
  const premarket = i.session === "premarket";
  const rr = i.plan?.rewardToTargets[0]?.rr ?? null;
  const quality = i.plan
    ? scoreQuality({
        direction: i.direction, structure5: s5, structure15: s15, roomGrade: i.room?.grade ?? null, rrToT1: rr, levelStrength: i.levelStrength,
        vwapDistAtr, rvol: i.rvol, recentVolX, macdWith: mom.macdWith, rsi: mom.rsi, emaWith: mom.emaWith, market, tfWith, tfAgainst, tfMeasured, chop: chop.chop, premarket,
      })
    : null;
  const bias = stableBias(i.biasSamples);
  const minutes = etStamp(i.nowMs).minutes;
  const read = buildRead({
    direction: i.direction, plan: i.plan, price: i.price, atr: i.atr, vwap: i.vwap, rvol: i.rvol, session: i.session, minutes, marketOpen: i.marketOpen,
    quality, breakout, chop, bias, market, ema9: mom.ema9, structure5: s5,
  });
  const leg = (sym: string) => market.legs.find((l) => l.symbol === sym)?.with ?? null;
  const sector = market.legs.find((l) => l.symbol !== "SPY" && l.symbol !== "QQQ");
  const features: SignalFeatures = {
    minutes, session: i.session, rvol: i.rvol, breakVolX: breakout?.breakVolX ?? null, recentVolX, structure5: s5, structure15: s15,
    vwapSide: vwapDistAtr === null ? "n/a" : vwapDistAtr >= 0 ? "with" : "against", vwapDistAtr: vwapDistAtr === null ? null : Math.round(vwapDistAtr * 100) / 100,
    macdWith: mom.macdWith, rsi: mom.rsi === null ? null : Math.round(mom.rsi), emaWith: mom.emaWith, tfWith, tfAgainst,
    marketAligned: market.aligned, spyWith: leg("SPY"), qqqWith: leg("QQQ"), sectorWith: sector ? sector.with : null,
    chopScore: chop.score, quality: quality?.score ?? null, qualityLabel: quality?.label ?? null, roomGrade: i.room?.grade ?? null, rr, levelStrength: i.levelStrength,
    bias: bias.bias, extAtr: read.chase ? Math.round(read.chase.extAtr * 100) / 100 : null, via: breakout?.via ?? null,
  };
  return { read, structure5: s5, structure15: s15, features };
}

/** Sector ETF for the market-context vote. Names without a clear sector fund are left out rather than guessed. */
const SECTOR: Record<string, string> = {
  NVDA: "SMH", AMD: "SMH", AVGO: "SMH", MU: "SMH", INTC: "SMH", QCOM: "SMH", TSM: "SMH",
  AAPL: "XLK", MSFT: "XLK", ORCL: "XLK", CRM: "XLK", ADBE: "XLK", NOW: "XLK", CSCO: "XLK", INTU: "XLK", PLTR: "XLK", IBM: "XLK",
  AMZN: "XLY", TSLA: "XLY", HD: "XLY", MCD: "XLY", NKE: "XLY", LOW: "XLY", SBUX: "XLY", BKNG: "XLY", GM: "XLY", F: "XLY",
  META: "XLC", GOOGL: "XLC", GOOG: "XLC", NFLX: "XLC", DIS: "XLC", VZ: "XLC", T: "XLC", CMCSA: "XLC",
  JPM: "XLF", BAC: "XLF", GS: "XLF", MS: "XLF", WFC: "XLF", C: "XLF", SCHW: "XLF", COF: "XLF", V: "XLF", MA: "XLF", AXP: "XLF", BRK: "XLF",
  XOM: "XLE", CVX: "XLE", COP: "XLE", SLB: "XLE", OXY: "XLE",
  WMT: "XLP", COST: "XLP", PG: "XLP", KO: "XLP", PEP: "XLP",
  BA: "XLI", CAT: "XLI", GE: "XLI", DE: "XLI", UPS: "XLI", HON: "XLI", LMT: "XLI", RTX: "XLI",
  LLY: "XLV", UNH: "XLV", JNJ: "XLV", MRK: "XLV", PFE: "XLV", ABBV: "XLV", TMO: "XLV",
};

export function sectorEtf(symbol: string): string | null {
  return SECTOR[symbol.toUpperCase()] ?? null;
}

/** Which symbols vote on market context for a name. The index funds check each other instead of themselves. */
export function marketSymbols(symbol: string): string[] {
  const s = symbol.toUpperCase();
  if (s === "SPY" || s === "SPX") return ["QQQ"];
  if (s === "QQQ") return ["SPY"];
  const sec = sectorEtf(s);
  return sec && sec !== s ? ["SPY", "QQQ", sec] : ["SPY", "QQQ"];
}

/** How long a failed breakout stays on screen before a fresh level is chosen. */
export const FAILED_HOLD_MS = 10 * 60_000;

/**
 * Whether a locked level should be let go under the quality engine:
 *   - its breakout failed, and the failure has been shown for two bars
 *   - the held bias turned the other way before price ever broke the level
 */
export function releaseReason(read: { breakout: { state: string; failedAt: number | null } | null; bias: { bias: string } }, lockDirection: SetupDirection, nowMs: number): string | null {
  const st = read.breakout?.state ?? "WATCHING";
  if (st === "FAILED BREAKOUT") return read.breakout?.failedAt != null && nowMs - read.breakout.failedAt < FAILED_HOLD_MS ? null : "failed breakout";
  const pre = st === "WATCHING" || st === "APPROACHING" || st === "TESTING";
  const biasDir = read.bias.bias === "BULLISH" ? "long" : read.bias.bias === "BEARISH" ? "short" : null;
  if (pre && biasDir !== null && biasDir !== lockDirection) return "trend changed before the break";
  return null;
}

/** Usual volume of each 5-minute slot over the sessions before `day`, keyed by minute of the ET day. */
export function slotBaselineBefore(hist5: Bar[], day: string, sessions = 20): Map<number, number> {
  const dates = Array.from(new Set(hist5.map((b) => etStamp(b.t).date))).filter((d) => d < day).sort().slice(-sessions);
  const use = new Set(dates);
  const sum = new Map<number, number>();
  for (const b of hist5) { const s = etStamp(b.t); if (use.has(s.date)) sum.set(s.minutes, (sum.get(s.minutes) ?? 0) + b.v); }
  const out = new Map<number, number>();
  for (const [k, v] of sum) out.set(k, v / Math.max(1, dates.length));
  return out;
}
