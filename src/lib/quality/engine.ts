// ─────────────────────────────────────────────────────────
// Setup quality engine (pure, unit-tested).
//
// The older read answered "how many indicators point this way". MACD fed
// the trend vote, the momentum score and every timeframe row, so one
// input could be counted three times while the actual price structure
// got two votes in eight. This engine asks a different question: is the
// SETUP good, and is the ENTRY still good.
//
//   1. Six categories, one score each. Several indicators inside one
//      category can never add up to more than that category's weight.
//   2. Price action outranks indicators: structure carries the largest
//      weight, and a structure that points the other way caps the total
//      no matter what MACD, RSI or the EMAs say.
//   3. A level cross is not a breakout. Confirmation needs a closed bar
//      beyond the level, volume on that bar, and then either a
//      follow-through bar or a retest that holds.
//   4. A good setup with a bad entry says DO NOT CHASE and names what
//      would make a new entry.
//   5. Chop is called early and blocks everything.
//   6. Bias has memory: momentum can change without the trend changing.
//
// The score is a SETUP SCORE, not a probability. Nothing here claims a
// win rate; measured results live in the signal log.
// ─────────────────────────────────────────────────────────

import type { Bar } from "../bars";
import { emaSeries, macdSeries, rsiSeries } from "../indicators";
import { etStamp, sessionVwapSeries } from "../intraday";
import type { Structure } from "../timeframeMatrix";
import type { SetupDirection } from "../setupMachine";

const $ = (n: number) => `$${n.toFixed(2)}`;
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const RTH_OPEN = 9 * 60 + 30;
const RTH_CLOSE = 16 * 60;

/** Bars whose period has fully elapsed. A "5-minute close" on a bar that is still forming is not a close. */
export function closedBars(bars: Bar[], nowMs: number, barMs = 300_000): Bar[] {
  let end = bars.length;
  while (end > 0 && bars[end - 1].t + barMs > nowMs) end--;
  return end === bars.length ? bars : bars.slice(0, end);
}

export function regularBarsOf(bars: Bar[], day: string): Bar[] {
  return bars.filter((b) => {
    const s = etStamp(b.t);
    return s.date === day && s.minutes >= RTH_OPEN && s.minutes < RTH_CLOSE;
  });
}

// ── Chop ──────────────────────────────────────────────────

export interface ChopSignal { key: string; text: string; weight: number }
export interface ChopRead {
  chop: boolean;
  score: number;
  signals: ChopSignal[];
  /** False in the first half hour, when there are too few regular-hours bars to judge. */
  measured: boolean;
}

export const CHOP_THRESHOLD = 50;

/**
 * Failed breakout attempts in a run of bars: a close beyond the prior
 * twelve-bar high (or low) that is back inside within three bars.
 */
export function failedAttempts(bars: Bar[]): number {
  let n = 0;
  for (let i = 12; i < bars.length - 1; i++) {
    const prior = bars.slice(i - 12, i);
    const hi = Math.max(...prior.map((b) => b.h));
    const lo = Math.min(...prior.map((b) => b.l));
    const next = bars.slice(i + 1, i + 4);
    if (bars[i].c > hi && next.some((b) => b.c < hi)) { n++; i += 3; }
    else if (bars[i].c < lo && next.some((b) => b.c > lo)) { n++; i += 3; }
  }
  return n;
}

/**
 * `bars` are closed 5-minute bars, oldest first, and may reach back into
 * earlier sessions (the EMAs need the history). Only today's regular-hours
 * bars are judged.
 */
export function readChop(i: { bars: Bar[]; day: string; atr: number; rvol: number | null; structure: Structure }): ChopRead {
  const today = regularBarsOf(i.bars, i.day);
  if (today.length < 6 || !(i.atr > 0)) return { chop: false, score: 0, signals: [], measured: false };
  const signals: ChopSignal[] = [];
  const add = (key: string, weight: number, text: string) => signals.push({ key, text, weight });
  const last = today.slice(-12);
  const startIdx = i.bars.length - last.length;
  const usesTail = i.bars[i.bars.length - 1] === today[today.length - 1];
  const vw = sessionVwapSeries(i.bars);
  const closes = i.bars.map((b) => b.c);
  const e9 = emaSeries(closes, 9), e20 = emaSeries(closes, 20);

  if (usesTail) {
    // VWAP crossings over the last hour.
    let crosses = 0, prev = 0;
    for (let k = startIdx; k < i.bars.length; k++) {
      const v = vw[k];
      if (v === null) continue;
      const side = i.bars[k].c >= v ? 1 : -1;
      if (prev !== 0 && side !== prev) crosses++;
      prev = side;
    }
    if (crosses >= 3) add("vwap-cross", 20, `${crosses} VWAP crossings in the last hour`);
    else if (crosses === 2) add("vwap-cross", 10, "2 VWAP crossings in the last hour");
    const vNow = vw[i.bars.length - 1], vThen = vw[Math.max(startIdx, i.bars.length - 7)];
    if (vNow !== null && vThen !== null && Math.abs(vNow - vThen) < 0.1 * i.atr) add("vwap-flat", 10, "VWAP is flat");
    const a = e9[e9.length - 1], b = e20[e20.length - 1], b4 = e20[e20.length - 5];
    if (a !== null && b !== null && Math.abs(a - b) < 0.15 * i.atr) add("ema-squeeze", 12, "EMA 9 and EMA 20 are pinched together");
    if (b !== null && b4 !== null && b4 !== undefined && Math.abs(b - b4) < 0.1 * i.atr) add("ema-flat", 8, "EMA 20 is flat");
  }
  const six = last.slice(-6);
  const avgRange = six.reduce((s, b) => s + (b.h - b.l), 0) / six.length;
  if (avgRange < 0.6 * i.atr) add("small-candles", 10, "Small candles");
  const eight = last.slice(-8);
  let flips = 0;
  for (let k = 1; k < eight.length; k++) if ((eight[k].c >= eight[k].o) !== (eight[k - 1].c >= eight[k - 1].o)) flips++;
  if (eight.length >= 6 && flips >= 5) add("alternating", 10, "Candles keep alternating direction");
  if (i.rvol !== null && i.rvol < 0.8) add("low-volume", 10, `Light volume (${i.rvol.toFixed(2)}x)`);
  if (i.structure === "RANGE" || i.structure === "N/A") add("no-structure", 12, "No higher highs and higher lows, or lower highs and lower lows");
  if (last.length >= 8) {
    const span = Math.max(...last.map((b) => b.h)) - Math.min(...last.map((b) => b.l));
    if (span < 2.2 * i.atr) add("tight-range", 12, "Tight range for the last hour");
  }
  const failed = failedAttempts(today.slice(-30));
  if (failed >= 2) add("failed-breaks", 12, `${failed} failed breakout attempts today`);
  else if (failed === 1) add("failed-breaks", 6, "1 failed breakout attempt today");

  const score = signals.reduce((s, x) => s + x.weight, 0);
  return { chop: score >= CHOP_THRESHOLD, score, signals: signals.sort((a, b) => b.weight - a.weight), measured: true };
}

// ── Breakout states ───────────────────────────────────────

export type BreakState = "WATCHING" | "APPROACHING" | "TESTING" | "BREAK ATTEMPT" | "BREAKOUT CONFIRMED" | "FAILED BREAKOUT";

export interface BreakCheck { key: "close" | "volume" | "hold" | "vwap" | "market"; name: string; pass: boolean | null; detail: string }

export interface BreakConfig {
  /** A close must clear the level by this many ATRs. */
  minPenAtr: number;
  /** The break bar must trade this multiple of its slot's usual volume. */
  barVolumeMult: number;
  /** Fallback when there is no slot baseline: the day's relative volume. */
  dayRvolMin: number;
  /** Half-width of the retest zone around the level, in ATRs. */
  retestAtr: number;
  approachAtr: number;
  testAtr: number;
}

export const BREAK_CONFIG: BreakConfig = { minPenAtr: 0.15, barVolumeMult: 1.3, dayRvolMin: 1.2, retestAtr: 0.35, approachAtr: 1.0, testAtr: 0.25 };

export interface BreakInput {
  /** CLOSED 5-minute bars to judge, oldest first (today's regular session from the moment the level was chosen). */
  bars: Bar[];
  direction: SetupDirection;
  trigger: number;
  invalidation: number;
  atr: number;
  vwap: number | null;
  rvol: number | null;
  /** Usual volume of each 5-minute slot on past sessions, keyed by minute of the ET day. */
  slotBaseline?: Map<number, number> | null;
  /** True / false when the broad market is with / against the direction, null when not measured. */
  marketAligned: boolean | null;
}

export interface BreakRead {
  state: BreakState;
  /** Start time of the bar that first closed beyond the level. */
  breakAt: number | null;
  /** Close time of the bar that completed the confirmation. */
  confirmedAt: number | null;
  /** Close time of the bar that failed the break. */
  failedAt: number | null;
  via: "follow-through" | "retest" | null;
  checks: BreakCheck[];
  /** Break bar volume over its usual volume. */
  breakVolX: number | null;
  /** Best price since the break. */
  extreme: number | null;
  /** Closed bars since the break. */
  barsSinceBreak: number;
}

/** Volume of a bar over what its 5-minute slot normally trades. */
export function slotVolumeX(bar: Bar, baseline: Map<number, number> | null | undefined): number | null {
  if (!baseline) return null;
  const base = baseline.get(etStamp(bar.t).minutes);
  return base && base > 0 ? bar.v / base : null;
}

export function readBreakout(i: BreakInput, cfg: BreakConfig = BREAK_CONFIG): BreakRead {
  const long = i.direction === "long";
  const beyond = (p: number, by = 0) => (long ? p > i.trigger + by : p < i.trigger - by);
  const gap = (p: number) => (long ? i.trigger - p : p - i.trigger) / Math.max(1e-9, i.atr);
  const zoneEdge = long ? i.trigger + cfg.retestAtr * i.atr : i.trigger - cfg.retestAtr * i.atr;
  let state: BreakState = "WATCHING";
  let breakIdx = -1, confirmedAt: number | null = null, failedAt: number | null = null, via: BreakRead["via"] = null;
  let extreme: number | null = null, retested = false, breakVolX: number | null = null, volOk: boolean | null = null;

  for (let k = 0; k < i.bars.length; k++) {
    const b = i.bars[k];
    if (state === "FAILED BREAKOUT") break;
    if (breakIdx < 0) {
      if (beyond(b.c)) {
        breakIdx = k;
        state = "BREAK ATTEMPT";
        extreme = long ? b.h : b.l;
        breakVolX = slotVolumeX(b, i.slotBaseline);
        volOk = breakVolX !== null ? breakVolX >= cfg.barVolumeMult : i.rvol !== null ? i.rvol >= cfg.dayRvolMin : null;
      } else {
        const wick = long ? b.h > i.trigger : b.l < i.trigger;
        const g = gap(b.c);
        state = wick || g <= cfg.testAtr ? "TESTING" : g <= cfg.approachAtr ? "APPROACHING" : "WATCHING";
      }
      continue;
    }
    extreme = long ? Math.max(extreme as number, b.h) : Math.min(extreme as number, b.l);
    if (state === "BREAKOUT CONFIRMED") {
      if (long ? b.c < i.invalidation : b.c > i.invalidation) { state = "FAILED BREAKOUT"; failedAt = b.t + 300_000; }
      continue;
    }
    // BREAK ATTEMPT: a close back through the level ends it.
    if (!beyond(b.c)) { state = "FAILED BREAKOUT"; failedAt = b.t + 300_000; continue; }
    // A later bar can supply the volume the break bar lacked.
    if (volOk === false) { const x = slotVolumeX(b, i.slotBaseline); if (x !== null && x >= cfg.barVolumeMult) { volOk = true; breakVolX = Math.max(breakVolX ?? 0, x); } }
    const brk = i.bars[breakIdx];
    const touched = long ? b.l <= zoneEdge : b.h >= zoneEdge;
    if (touched) retested = true;
    const held = beyond(b.c, cfg.minPenAtr * i.atr);
    const follow = held && (long ? b.c > brk.c || b.h > brk.h : b.c < brk.c || b.l < brk.l) && (long ? b.c >= b.o : b.c <= b.o);
    const retestHold = retested && held && (long ? b.c > zoneEdge : b.c < zoneEdge) && (long ? b.c >= b.o : b.c <= b.o);
    const vwapOk = i.vwap === null ? null : long ? b.c > i.vwap : b.c < i.vwap;
    if ((follow || retestHold) && volOk !== false && vwapOk !== false && i.marketAligned !== false) {
      state = "BREAKOUT CONFIRMED";
      confirmedAt = b.t + 300_000;
      via = retestHold && !follow ? "retest" : follow ? "follow-through" : "retest";
    }
  }

  const last = i.bars[i.bars.length - 1];
  const lastBeyond = last ? beyond(last.c, cfg.minPenAtr * i.atr) : false;
  const vwapNow = i.vwap === null || !last ? null : long ? last.c > i.vwap : last.c < i.vwap;
  const checks: BreakCheck[] = [
    { key: "close", name: `5-minute close ${long ? "above" : "below"} ${$(i.trigger)}`, pass: breakIdx >= 0 ? lastBeyond || state === "BREAKOUT CONFIRMED" : false, detail: breakIdx >= 0 ? "closed beyond the level" : "no close beyond the level yet" },
    { key: "volume", name: `Volume on the break (${cfg.barVolumeMult}x its usual)`, pass: breakIdx >= 0 ? volOk : null, detail: breakVolX !== null ? `break bar ${breakVolX.toFixed(2)}x its usual volume` : i.rvol !== null ? `day volume ${i.rvol.toFixed(2)}x` : "volume not measured" },
    { key: "hold", name: "Follow-through candle, or a retest that holds", pass: state === "BREAKOUT CONFIRMED" ? true : breakIdx >= 0 ? false : null, detail: via ? `held by ${via}` : breakIdx >= 0 ? "waiting for the next candle to hold" : "comes after the break" },
    { key: "vwap", name: `Price ${long ? "above" : "below"} VWAP`, pass: vwapNow, detail: i.vwap !== null ? `VWAP ${$(i.vwap)}` : "no session VWAP" },
    { key: "market", name: "Broad market not against it", pass: i.marketAligned === null ? null : i.marketAligned, detail: i.marketAligned === null ? "market not measured" : i.marketAligned ? "market is with it" : "market is against it" },
  ];
  return { state, breakAt: breakIdx >= 0 ? i.bars[breakIdx].t : null, confirmedAt, failedAt, via, checks, breakVolX, extreme, barsSinceBreak: breakIdx >= 0 ? i.bars.length - 1 - breakIdx : 0 };
}

// ── Don't chase ───────────────────────────────────────────

export interface ChaseRead {
  chase: boolean;
  /** How far price is past the level, in 5-minute ATRs. */
  extAtr: number;
  /** Share of the way from the level to target 1 already travelled. */
  progress: number;
  reason: string | null;
  reentry: string[];
}

export const CHASE_MAX_ATR = 1.5;
export const CHASE_MAX_PROGRESS = 0.5;

export function readChase(i: { direction: SetupDirection; price: number; trigger: number; atr: number; target1: number | null; ema9: number | null; vwap: number | null }): ChaseRead {
  const long = i.direction === "long";
  const past = long ? i.price - i.trigger : i.trigger - i.price;
  const extAtr = past / Math.max(1e-9, i.atr);
  const span = i.target1 !== null ? Math.abs(i.target1 - i.trigger) : 0;
  const progress = span > 0 ? Math.max(0, past) / span : 0;
  const tooFar = extAtr > CHASE_MAX_ATR;
  const mostlyDone = progress > CHASE_MAX_PROGRESS;
  if (!tooFar && !mostlyDone) return { chase: false, extAtr, progress, reason: null, reentry: [] };
  const reentry: string[] = [`Wait for a pullback toward ${$(i.trigger)} and a hold (retest of the ${long ? "breakout" : "breakdown"} level)`];
  const ma = i.ema9 !== null && (long ? i.ema9 > i.trigger && i.ema9 < i.price : i.ema9 < i.trigger && i.ema9 > i.price) ? i.ema9 : null;
  if (ma !== null) reentry.push(`Or a new ${long ? "higher low" : "lower high"} near the 5-minute EMA 9 (${$(ma)})`);
  else reentry.push(`Or a new ${long ? "higher low" : "lower high"} that holds ${long ? "above" : "below"} ${$(i.trigger)}`);
  const reason = mostlyDone
    ? `${Math.round(progress * 100)}% of the way to target 1 is already gone`
    : `price is ${extAtr.toFixed(1)} ATR past the level`;
  return { chase: true, extAtr, progress, reason, reentry };
}

// ── Bias with memory ──────────────────────────────────────

export type BiasSide = "BULLISH" | "BEARISH" | "NEUTRAL";
export interface BiasSample { label: string | null; structure: Structure }
export interface BiasRead {
  bias: BiasSide;
  /** The latest read on its own, before memory is applied. */
  momentum: BiasSide;
  /** Set when momentum and the held bias disagree. */
  note: string | null;
  /** Bias changes across the samples; two or more in the window is unstable. */
  changes: number;
}

const sideOf = (label: string | null): { side: BiasSide; firm: boolean } => {
  if (!label) return { side: "NEUTRAL", firm: false };
  const side: BiasSide = /Bull/i.test(label) ? "BULLISH" : /Bear/i.test(label) ? "BEARISH" : "NEUTRAL";
  return { side, firm: side !== "NEUTRAL" && !/Slight/i.test(label) };
};
const structureSide = (s: Structure): BiasSide => (s === "HH/HL" || s === "BREAKOUT" ? "BULLISH" : s === "LH/LL" || s === "BREAKDOWN" ? "BEARISH" : "NEUTRAL");

/**
 * Folds a run of 5-minute reads (oldest first) into a bias that does not
 * flip on one candle. A change of side needs three firm reads in a row,
 * or two when the price structure has already turned. Momentum turning
 * while the structure holds is reported as a note, not as a new trend.
 */
export function stableBias(samples: BiasSample[]): BiasRead {
  let bias: BiasSide = "NEUTRAL";
  let run: BiasSide = "NEUTRAL", runLen = 0, neutralRun = 0, changes = 0;
  for (const s of samples) {
    const { side, firm } = sideOf(s.label);
    const st = structureSide(s.structure);
    if (side === "NEUTRAL" || !firm) { neutralRun++; if (side !== run) { run = "NEUTRAL"; runLen = 0; } }
    else {
      neutralRun = 0;
      if (side === run) runLen++; else { run = side; runLen = 1; }
    }
    if (run !== "NEUTRAL" && run !== bias) {
      const need = bias === "NEUTRAL" ? 2 : st === run ? 2 : 3;
      // A structure still pointing the old way vetoes the flip entirely.
      const vetoed = bias !== "NEUTRAL" && st === bias;
      if (runLen >= need && !vetoed) { if (bias !== "NEUTRAL") changes++; bias = run; }
    }
    if (bias !== "NEUTRAL" && neutralRun >= 6 && st !== bias) { bias = "NEUTRAL"; changes++; }
  }
  const lastSample = samples[samples.length - 1];
  const momentum = lastSample ? sideOf(lastSample.label).side : "NEUTRAL";
  const st = lastSample ? structureSide(lastSample.structure) : "NEUTRAL";
  let note: string | null = null;
  if (bias !== "NEUTRAL" && momentum !== "NEUTRAL" && momentum !== bias) {
    note = `${momentum === "BULLISH" ? "Bullish" : "Bearish"} momentum is building, but the ${bias.toLowerCase()} ${st === bias ? "structure" : "trend"} has not broken`;
  } else if (bias !== "NEUTRAL" && momentum === "NEUTRAL") {
    note = `Momentum has cooled; the ${bias.toLowerCase()} trend still stands`;
  } else if (bias === "NEUTRAL" && momentum !== "NEUTRAL") {
    note = `${momentum === "BULLISH" ? "Bullish" : "Bearish"} momentum, not yet a trend`;
  }
  return { bias, momentum, note, changes };
}

// ── Market context ────────────────────────────────────────

export interface MarketLeg { symbol: string; aboveVwap: boolean | null; changePct: number | null }
export interface MarketRead {
  /** True with, false against, null when nothing could be measured. */
  aligned: boolean | null;
  score: number | null;
  legs: { symbol: string; with: boolean | null; detail: string }[];
}

/** One vote per leg: on the right side of its own VWAP (or, failing that, green/red on the day). */
export function readMarket(direction: SetupDirection, legs: MarketLeg[]): MarketRead {
  const long = direction === "long";
  const out = legs.map((l) => {
    const up = l.aboveVwap !== null ? l.aboveVwap : l.changePct !== null ? l.changePct >= 0 : null;
    const w = up === null ? null : long ? up : !up;
    const detail = l.aboveVwap !== null ? `${l.aboveVwap ? "above" : "below"} its VWAP${l.changePct !== null ? `, ${l.changePct >= 0 ? "+" : ""}${l.changePct.toFixed(2)}%` : ""}` : l.changePct !== null ? `${l.changePct >= 0 ? "+" : ""}${l.changePct.toFixed(2)}% on the day` : "not measured";
    return { symbol: l.symbol, with: w, detail };
  });
  const measured = out.filter((l) => l.with !== null);
  if (measured.length === 0) return { aligned: null, score: null, legs: out };
  const withN = measured.filter((l) => l.with).length;
  const score = Math.round((withN / measured.length) * 100);
  // Against only when every measured leg disagrees; a split market is not "against".
  return { aligned: withN === 0 ? false : withN === measured.length ? true : null, score, legs: out };
}

// ── Quality score ─────────────────────────────────────────

export type CategoryKey = "structure" | "location" | "participation" | "momentum" | "market" | "timeframes";
export interface Category { key: CategoryKey; name: string; weight: number; score: number | null; detail: string }
export type QualityLabel = "Strong" | "Moderate" | "Weak";

export interface QualityRead {
  /** 0 to 100. A setup score, not a probability. */
  score: number;
  label: QualityLabel;
  categories: Category[];
  /** Ceilings that were applied, in plain words. */
  caps: string[];
  /** True when the 5-minute price structure points against the setup. */
  structureAgainst: boolean;
}

export const CATEGORY_WEIGHTS: Record<CategoryKey, number> = { structure: 30, location: 20, participation: 20, market: 10, timeframes: 10, momentum: 10 };
/** Premarket volume this far above its usual lifts the premarket ceiling on the score. */
export const PREMARKET_STRONG_RVOL = 2;
export const QUALITY_STRONG = 70;
export const QUALITY_MODERATE = 50;

export interface QualityInput {
  direction: SetupDirection;
  structure5: Structure;
  structure15: Structure;
  roomGrade: string | null;
  rrToT1: number | null;
  levelStrength: number | null;
  /** Distance from VWAP on the setup's side, in 5-minute ATRs (negative when on the wrong side). */
  vwapDistAtr: number | null;
  rvol: number | null;
  /** Average of the last three closed bars over their usual volume. */
  recentVolX: number | null;
  macdWith: boolean | null;
  rsi: number | null;
  emaWith: boolean | null;
  market: MarketRead;
  /** Timeframe rows (1m, 2m, 5m, 15m, 1h): how many lean with, against, and were measured. */
  tfWith: number;
  tfAgainst: number;
  tfMeasured: number;
  chop: boolean;
  premarket: boolean;
}

const structureScore = (s: Structure, long: boolean): number | null => {
  if (s === "N/A") return null;
  const withIt = long ? s === "HH/HL" || s === "BREAKOUT" : s === "LH/LL" || s === "BREAKDOWN";
  const against = long ? s === "LH/LL" || s === "BREAKDOWN" : s === "HH/HL" || s === "BREAKOUT";
  return withIt ? 100 : against ? 0 : 45;
};
const structureWords: Record<Structure, string> = { "HH/HL": "higher highs and higher lows", "LH/LL": "lower highs and lower lows", RANGE: "range", BREAKOUT: "new highs", BREAKDOWN: "new lows", "N/A": "not enough bars" };
const avg = (xs: (number | null)[]): number | null => { const v = xs.filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

export function scoreQuality(i: QualityInput): QualityRead {
  const long = i.direction === "long";
  const cats: Category[] = [];
  const add = (key: CategoryKey, name: string, score: number | null, detail: string) => cats.push({ key, name, weight: CATEGORY_WEIGHTS[key], score: score === null ? null : Math.round(clamp(score)), detail });

  const s5 = structureScore(i.structure5, long), s15 = structureScore(i.structure15, long);
  const structure = s5 === null ? s15 : s15 === null ? s5 : 0.65 * s5 + 0.35 * s15;
  add("structure", "Structure", structure, `5m ${structureWords[i.structure5]}, 15m ${structureWords[i.structure15]}`);

  const room = i.roomGrade ? ({ OPEN: 100, GOOD: 100, OK: 70, TIGHT: 30, POOR: 0 } as Record<string, number>)[i.roomGrade] ?? null : null;
  const rr = i.rrToT1 === null ? null : i.rrToT1 >= 2.5 ? 100 : i.rrToT1 >= 2 ? 85 : i.rrToT1 >= 1.5 ? 60 : i.rrToT1 >= 1 ? 30 : 0;
  const ext = i.vwapDistAtr === null ? null : i.vwapDistAtr < 0 ? 30 : i.vwapDistAtr <= 2 ? 100 : i.vwapDistAtr <= 3 ? 60 : 20;
  add("location", "Location", avg([room, rr, ext, i.levelStrength]), `room ${i.roomGrade ?? "n/a"}, ${i.rrToT1 !== null ? `${i.rrToT1.toFixed(1)}R to target 1` : "no target"}${i.vwapDistAtr !== null ? `, ${i.vwapDistAtr < 0 ? "wrong side of VWAP" : `${i.vwapDistAtr.toFixed(1)} ATR from VWAP`}` : ""}`);

  const band = (x: number | null) => (x === null ? null : x >= 1.5 ? 100 : x >= 1.2 ? 80 : x >= 1.0 ? 60 : x >= 0.8 ? 35 : x >= 0.7 ? 15 : 0);
  const day = band(i.rvol), recent = band(i.recentVolX);
  add("participation", "Participation", day === null ? recent : recent === null ? day : 0.6 * day + 0.4 * recent, `${i.rvol !== null ? `day volume ${i.rvol.toFixed(2)}x` : "day volume n/a"}${i.recentVolX !== null ? `, last three bars ${i.recentVolX.toFixed(2)}x` : ""}`);

  const rsiWith = i.rsi === null ? null : long ? (i.rsi > 78 ? 0.5 : i.rsi > 50 ? 1 : 0) : i.rsi < 22 ? 0.5 : i.rsi < 50 ? 1 : 0;
  const mom = avg([i.macdWith === null ? null : i.macdWith ? 1 : 0, rsiWith, i.emaWith === null ? null : i.emaWith ? 1 : 0]);
  add("momentum", "Momentum", mom === null ? null : mom * 100, `MACD ${i.macdWith === null ? "n/a" : i.macdWith ? "with" : "against"}, RSI ${i.rsi !== null ? Math.round(i.rsi) : "n/a"}, EMAs ${i.emaWith === null ? "n/a" : i.emaWith ? "with" : "against"}`);

  add("market", "Market context", i.market.score, i.market.legs.map((l) => `${l.symbol} ${l.with === null ? "n/a" : l.with ? "with" : "against"}`).join(", ") || "not measured");

  const tf = i.tfMeasured > 0 ? ((i.tfWith - 0.5 * i.tfAgainst) / i.tfMeasured) * 100 : null;
  add("timeframes", "Timeframe alignment", tf, i.tfMeasured > 0 ? `${i.tfWith} of ${i.tfMeasured} timeframes agree${i.tfAgainst ? `, ${i.tfAgainst} against` : ""}` : "not measured");

  const measured = cats.filter((c) => c.score !== null);
  const wsum = measured.reduce((a, c) => a + c.weight, 0);
  let score = wsum > 0 ? measured.reduce((a, c) => a + (c.score as number) * c.weight, 0) / wsum : 0;
  const caps: string[] = [];
  const cap = (max: number, why: string) => { if (score > max) { score = max; caps.push(why); } };
  const structureAgainst = s5 === 0;
  if (structureAgainst) cap(45, `5-minute structure is ${structureWords[i.structure5]}, against the setup`);
  if (i.chop) cap(35, "choppy tape");
  if (i.premarket) cap(i.rvol !== null && i.rvol >= PREMARKET_STRONG_RVOL ? 65 : 55, "premarket: thin liquidity");
  if (i.rvol !== null && i.rvol < 0.8) cap(60, `light volume (${i.rvol.toFixed(2)}x)`);
  if (i.market.aligned === false) cap(60, "broad market is against it");
  score = Math.round(score);
  return { score, label: score >= QUALITY_STRONG ? "Strong" : score >= QUALITY_MODERATE ? "Moderate" : "Weak", categories: cats, caps, structureAgainst };
}

/** MACD, RSI and EMA facts for the momentum category, from closed 5-minute bars. */
export function momentumFacts(bars: Bar[], direction: SetupDirection): { macdWith: boolean | null; rsi: number | null; emaWith: boolean | null; ema9: number | null } {
  const long = direction === "long";
  const closes = bars.map((b) => b.c);
  if (closes.length < 35) return { macdWith: null, rsi: null, emaWith: null, ema9: null };
  const m = macdSeries(closes);
  const h = m.histogram[m.histogram.length - 1];
  const r = rsiSeries(closes, 14);
  const rsi = r[r.length - 1];
  const e9 = emaSeries(closes, 9), e20 = emaSeries(closes, 20);
  const a = e9[e9.length - 1], b = e20[e20.length - 1];
  return { macdWith: h === null ? null : long ? h > 0 : h < 0, rsi, emaWith: a === null || b === null ? null : long ? a > b : a < b, ema9: a };
}

// ── The read the trader sees ──────────────────────────────

export type Call = "CALL" | "PUT" | "WAIT" | "NO TRADE" | "DO NOT CHASE";
export type ReadState = BreakState | "NO SETUP" | "TARGET REACHED" | "SESSION OVER";

export interface WhyLine { ok: boolean | null; text: string }

export interface SetupRead {
  call: Call;
  /** One short line under the call. */
  reason: string;
  setup: string;
  quality: QualityRead | null;
  state: ReadState;
  stateDetail: string | null;
  why: WhyLine[];
  waitingFor: string[];
  warnings: string[];
  bias: BiasRead;
  chop: ChopRead;
  chase: ChaseRead | null;
  breakout: BreakRead | null;
  market: MarketRead;
  premarket: boolean;
}

export interface ReadInput {
  direction: SetupDirection;
  plan: { trigger: number; invalidation: number; targets: number[] } | null;
  price: number | null;
  atr: number;
  vwap: number | null;
  rvol: number | null;
  session: string;
  /** Minutes of the ET day. */
  minutes: number;
  marketOpen: boolean;
  quality: QualityRead | null;
  breakout: BreakRead | null;
  chop: ChopRead;
  bias: BiasRead;
  market: MarketRead;
  ema9: number | null;
  structure5: Structure;
}

export function buildRead(i: ReadInput): SetupRead {
  const long = i.direction === "long";
  const premarket = i.session === "premarket";
  const opening = i.session === "rth" && i.minutes < RTH_OPEN + 15;
  const sessionOver = !i.marketOpen && (i.session === "afterhours" || i.session === "closed");
  const side = long ? "CALL" : "PUT";
  const word = long ? "breakout" : "breakdown";
  const base = { quality: i.quality, bias: i.bias, chop: i.chop, breakout: i.breakout, market: i.market, premarket };
  const warnings: string[] = [];
  if (premarket) warnings.push(i.rvol !== null && i.rvol >= PREMARKET_STRONG_RVOL
    ? `Premarket, with unusually strong volume (${i.rvol.toFixed(2)}x). Still thinner than regular hours; the setup is re-read at 9:30 ET.`
    : "Premarket: lower confidence. Liquidity is thin and spreads are wide; the setup is re-read at 9:30 ET.");
  if (opening) warnings.push("First 15 minutes: watch only, the opening range is still forming.");
  if (i.chop.chop) warnings.push(`Choppy tape: ${i.chop.signals.slice(0, 3).map((s) => s.text.toLowerCase()).join(", ")}.`);
  if (i.market.aligned === false) warnings.push(`The broad market is working against this (${i.market.legs.filter((l) => l.with === false).map((l) => l.symbol).join(", ")}).`);
  if (i.rvol !== null && i.rvol < 0.8) warnings.push(`Volume is light (${i.rvol.toFixed(2)}x). Light volume makes breaks less trustworthy.`);
  if (i.bias.changes >= 2) warnings.push("The trend read has changed sides more than once recently.");

  // WHY: one line per category, price action first.
  const why: WhyLine[] = [];
  const q = i.quality;
  if (q) {
    const st = q.categories.find((c) => c.key === "structure");
    if (st && st.score !== null) why.push({ ok: st.score >= 65 ? true : st.score <= 20 ? false : null, text: `5m ${structureWords[i.structure5]}` });
    if (i.vwap !== null && i.price !== null) { const onSide = long ? i.price > i.vwap : i.price < i.vwap; why.push({ ok: onSide, text: `${onSide ? (long ? "Above" : "Below") : long ? "Below" : "Above"} VWAP (${$(i.vwap)})` }); }
    const loc = q.categories.find((c) => c.key === "location");
    if (loc && loc.score !== null && i.plan) {
      const testing = i.breakout?.state === "TESTING";
      why.push({ ok: loc.score >= 65 ? true : loc.score < 40 ? false : null, text: testing ? `${long ? "Resistance" : "Support"} ${$(i.plan.trigger)} is being tested` : loc.detail.charAt(0).toUpperCase() + loc.detail.slice(1) });
    }
    if (i.market.aligned !== null || i.market.score !== null) why.push({ ok: i.market.aligned, text: i.market.aligned === true ? `${i.market.legs.filter((l) => l.with).map((l) => l.symbol).join(" and ")} aligned` : i.market.aligned === false ? `${i.market.legs.filter((l) => l.with === false).map((l) => l.symbol).join(" and ")} against` : `Market split (${i.market.legs.map((l) => `${l.symbol} ${l.with ? "with" : l.with === false ? "against" : "n/a"}`).join(", ")})` });
    if (i.rvol !== null) why.push({ ok: i.rvol >= 1 ? true : i.rvol < 0.8 ? false : null, text: `Volume ${i.rvol.toFixed(2)}x ${i.rvol >= 1.5 ? "(heavy)" : i.rvol >= 1 ? "(normal or better)" : i.rvol >= 0.8 ? "(a little light)" : "(light)"}` });
    const tf = q.categories.find((c) => c.key === "timeframes");
    if (tf && tf.score !== null) why.push({ ok: tf.score >= 65 ? true : tf.score < 35 ? false : null, text: tf.detail.charAt(0).toUpperCase() + tf.detail.slice(1) });
    const mo = q.categories.find((c) => c.key === "momentum");
    if (mo && mo.score !== null) why.push({ ok: mo.score >= 65 ? true : mo.score < 35 ? false : null, text: q.structureAgainst && mo.score >= 65 ? `${long ? "Bullish" : "Bearish"} momentum improving, but ${long ? "bearish" : "bullish"} structure remains` : `Momentum ${mo.score >= 65 ? "with" : mo.score < 35 ? "against" : "mixed for"} the setup` });
  }

  if (!i.plan || i.price === null) {
    return { ...base, call: "NO TRADE", reason: sessionOver ? "market closed" : i.chop.chop ? "chop, and no clean level" : "no clean level to trade against", setup: "No setup", state: sessionOver ? "SESSION OVER" : "NO SETUP", stateDetail: null, why, waitingFor: sessionOver ? [] : ["A clear level in the direction of the bias"], warnings, chase: null };
  }
  const trig = $(i.plan.trigger);
  const b = i.breakout;
  const state: BreakState = b?.state ?? "WATCHING";
  const t1 = i.plan.targets[0] ?? null;
  const reached = b?.extreme != null && t1 !== null && state === "BREAKOUT CONFIRMED" && (long ? b.extreme >= t1 : b.extreme <= t1);
  const chase = state === "BREAKOUT CONFIRMED" || state === "BREAK ATTEMPT" ? readChase({ direction: i.direction, price: i.price, trigger: i.plan.trigger, atr: i.atr, target1: t1, ema9: i.ema9, vwap: i.vwap }) : null;
  const setup = `${long ? "Bullish" : "Bearish"} ${word}`;
  const waitingFor: string[] = [];
  const need = (s: string) => { if (!waitingFor.includes(s)) waitingFor.push(s); };

  let call: Call = "WAIT";
  let reason = "";
  let readState: ReadState = state;
  let stateDetail: string | null = null;

  if (sessionOver) { call = "NO TRADE"; reason = "market closed"; readState = "SESSION OVER"; }
  else if (state === "FAILED BREAKOUT") { call = "NO TRADE"; reason = `failed ${word}: closed back through ${trig}`; need("A fresh level. This one is done for now."); }
  else if (i.chop.chop && state !== "BREAKOUT CONFIRMED") { call = "NO TRADE"; reason = "chop"; need("A clean move out of the range on volume"); need(`Then a 5m close ${long ? "above" : "below"} ${trig}`); }
  else if (reached) { call = "DO NOT CHASE"; reason = "target 1 already reached"; readState = "TARGET REACHED"; for (const r of readChase({ direction: i.direction, price: i.price, trigger: i.plan.trigger, atr: i.atr, target1: t1, ema9: i.ema9, vwap: i.vwap }).reentry) need(r); }
  else if (state === "BREAKOUT CONFIRMED") {
    stateDetail = b?.via === "retest" ? "retest held" : "follow-through held";
    if (chase?.chase) { call = "DO NOT CHASE"; reason = `${long ? "bullish" : "bearish"}, entry missed: ${chase.reason}`; for (const r of chase.reentry) need(r); }
    else if (premarket || opening) { call = "WAIT"; reason = premarket ? "premarket" : "before 9:45 ET"; need("After 9:45 ET"); }
    // Back on the wrong side of the level after confirming: a retest is under way, and an entry here sits on top of the stop.
    else if (long ? i.price <= i.plan.trigger : i.price >= i.plan.trigger) { call = "WAIT"; reason = `confirmed earlier, now back at ${trig}: retest in progress`; stateDetail = "retesting the level"; need(`A 5m close back ${long ? "above" : "below"} ${trig} that holds`); }
    else if (i.chop.chop) { call = "NO TRADE"; reason = "chop"; need("A clean move out of the range on volume"); }
    else if (q && q.score < QUALITY_MODERATE) { call = "WAIT"; reason = `confirmed, but the setup is weak (${q.score})`; for (const c of q.caps) need(`Fix: ${c}`); }
    else if (i.market.aligned === false) { call = "WAIT"; reason = "confirmed, but the market is against it"; need("SPY and QQQ to stop working against it"); }
    else { call = side; reason = `${word} confirmed, ${b?.via === "retest" ? "retest held" : "follow-through held"}`; }
  } else {
    // Before confirmation.
    if (premarket || opening) need("After 9:45 ET");
    if (state === "BREAK ATTEMPT") {
      reason = `through ${trig}, not confirmed`;
      for (const c of b?.checks ?? []) if (c.pass === false) need(c.key === "hold" ? `The next 5m candle to hold ${long ? "above" : "below"} ${trig}, or a retest that holds` : c.key === "volume" ? `Volume on the break (${c.detail})` : c.key === "market" ? "SPY and QQQ to stop working against it" : c.name);
      if (waitingFor.length === 0) need(`The next 5m candle to hold ${long ? "above" : "below"} ${trig}`);
    } else {
      reason = state === "TESTING" ? `testing ${trig}, no close beyond it` : state === "APPROACHING" ? `approaching ${trig}, do not buy the approach` : "price is not at the level";
      need(`5m close ${long ? "above" : "below"} ${trig}`);
      need("Volume on that candle (1.3x its usual)");
      need("Then a follow-through candle, or a retest that holds");
    }
    if (premarket) reason = `premarket, lower confidence: ${reason}`;
    if (i.rvol !== null && i.rvol < 0.8) need(`RVOL above 0.8x (now ${i.rvol.toFixed(2)}x)`);
    if (i.market.aligned === false) need("SPY and QQQ to stop working against it");
  }
  if (chase?.chase && call !== "DO NOT CHASE" && state === "BREAK ATTEMPT") warnings.push(`Already ${chase.extAtr.toFixed(1)} ATR past the level. If it confirms from here the entry is a chase.`);
  return { ...base, call, reason, setup, state: readState, stateDetail, why, waitingFor, warnings, chase };
}
