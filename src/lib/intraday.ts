// ─────────────────────────────────────────────────────────
// Intraday structure engine (pure, unit-tested).
// Sessions, resampling, session VWAP, opening ranges, time-of-day
// RVOL, the level engine (candidates -> ATR clustering -> scored
// zones with reasons), multi-timeframe confluence, and the 7-state
// intraday trend read. Everything operates on plain bar arrays so
// the same code runs on live data and historical replay slices
// without any possibility of lookahead.
// ─────────────────────────────────────────────────────────

import type { Bar } from "./bars";
import { emaSeries, atrSeries, macdSeries } from "./indicators";

export type IntradayBar = Bar;

// ── Eastern-time session helpers ──

const etFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hour12: false,
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});

export interface EtStamp {
  date: string;
  hm: string;
  minutes: number; // minutes since midnight ET
}

export function etStamp(ms: number): EtStamp {
  const p = Object.fromEntries(etFmt.formatToParts(ms).map((x) => [x.type, x.value]));
  const minutes = parseInt(p.hour, 10) * 60 + parseInt(p.minute, 10);
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, minutes };
}

export type Session = "premarket" | "rth" | "afterhours" | "closed";

export function sessionOf(ms: number): Session {
  const { minutes } = etStamp(ms);
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return "premarket";
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return "rth";
  if (minutes >= 16 * 60 && minutes < 20 * 60) return "afterhours";
  return "closed";
}

export type DaySlot =
  | "premarket" | "open-5" | "open-15" | "open-30" | "morning"
  | "midday" | "power-hour" | "close-5" | "afterhours" | "closed";

export function daySlot(ms: number): DaySlot {
  const { minutes } = etStamp(ms);
  const open = 9 * 60 + 30;
  if (minutes >= 4 * 60 && minutes < open) return "premarket";
  if (minutes >= open && minutes < open + 5) return "open-5";
  if (minutes < open + 15) return minutes >= open ? "open-15" : "closed";
  if (minutes >= open && minutes < open + 30) return "open-30";
  if (minutes >= open && minutes < 11 * 60 + 30) return "morning";
  if (minutes >= 11 * 60 + 30 && minutes < 15 * 60) return "midday";
  if (minutes >= 15 * 60 && minutes < 15 * 60 + 55) return "power-hour";
  if (minutes >= 15 * 60 + 55 && minutes < 16 * 60) return "close-5";
  if (minutes >= 16 * 60 && minutes < 20 * 60) return "afterhours";
  return "closed";
}

/** Resample 1-minute bars into n-minute bars (ET-bucketed). */
export function resample(bars: IntradayBar[], n: number): IntradayBar[] {
  if (n <= 1) return bars;
  const out: IntradayBar[] = [];
  let cur: IntradayBar | null = null;
  let bucket = "";
  for (const b of bars) {
    const { date, minutes } = etStamp(b.t);
    const id = `${date}:${Math.floor(minutes / n)}`;
    if (cur === null || id !== bucket) {
      if (cur) out.push(cur);
      cur = { ...b };
      bucket = id;
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
      cur.vw = b.vw; // final minute's vw; session VWAP is computed separately
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Session VWAP series over 1-minute bars. Anchors at the RTH open by
 * default (platform convention); includePremarket anchors at 4:00 ET.
 * Resets each ET date.
 */
export function sessionVwapSeries(bars: IntradayBar[], includePremarket = false): (number | null)[] {
  const out: (number | null)[] = [];
  let pv = 0;
  let vv = 0;
  let day = "";
  for (const b of bars) {
    const s = etStamp(b.t);
    if (s.date !== day) {
      day = s.date;
      pv = 0;
      vv = 0;
    }
    const inAnchor = includePremarket
      ? s.minutes >= 4 * 60 && s.minutes < 16 * 60
      : s.minutes >= 9 * 60 + 30 && s.minutes < 16 * 60;
    if (inAnchor) {
      const typ = b.vw && b.vw > 0 ? b.vw : (b.h + b.l + b.c) / 3;
      pv += typ * b.v;
      vv += b.v;
    }
    out.push(vv > 0 ? pv / vv : null);
  }
  return out;
}

export interface OpeningRange {
  minutes: number;
  high: number;
  low: number;
  complete: boolean;
}

/** Opening range over the first `minutes` of today's RTH session. */
export function openingRange(bars: IntradayBar[], minutes: number, date: string): OpeningRange | null {
  const open = 9 * 60 + 30;
  let high = -Infinity;
  let low = Infinity;
  let sawAny = false;
  let sawEnd = false;
  for (const b of bars) {
    const s = etStamp(b.t);
    if (s.date !== date) continue;
    if (s.minutes >= open && s.minutes < open + minutes) {
      sawAny = true;
      high = Math.max(high, b.h);
      low = Math.min(low, b.l);
    }
    if (s.minutes >= open + minutes) sawEnd = true;
  }
  return sawAny ? { minutes, high, low, complete: sawEnd } : null;
}

// ── Time-of-day relative volume ──

/**
 * Documented cumulative intraday volume curve (fraction of a full
 * day's volume typically traded by minute-of-session). U-shaped:
 * heavy open, quiet midday, heavy close. An approximation — labeled
 * as such in the UI — refined later with per-symbol history.
 */
export const CUM_VOLUME_CURVE: [number, number][] = [
  [0, 0], [5, 0.05], [15, 0.10], [30, 0.16], [60, 0.25], [90, 0.32],
  [120, 0.38], [180, 0.48], [240, 0.57], [300, 0.68], [330, 0.75],
  [360, 0.85], [385, 0.96], [390, 1],
];

export function expectedVolumeFraction(minutesIntoRth: number): number {
  const m = Math.max(0, Math.min(390, minutesIntoRth));
  for (let i = 1; i < CUM_VOLUME_CURVE.length; i++) {
    const [m1, f1] = CUM_VOLUME_CURVE[i - 1];
    const [m2, f2] = CUM_VOLUME_CURVE[i];
    if (m <= m2) return f1 + ((m - m1) / (m2 - m1)) * (f2 - f1);
  }
  return 1;
}

/**
 * Time-of-day adjusted RVOL: today's cumulative volume vs what an
 * average day would have traded BY THIS TIME. Premarket volume is
 * compared against ~5% of a normal day (documented approximation).
 */
export function timeAdjustedRvol(
  todayCumVolume: number,
  avgDailyVolume: number,
  nowMs: number
): number | null {
  if (avgDailyVolume <= 0) return null;
  const s = etStamp(nowMs);
  const open = 9 * 60 + 30;
  let expected: number;
  if (s.minutes < open) {
    const pmFrac = Math.max(0.005, ((s.minutes - 4 * 60) / (5.5 * 60)) * 0.05);
    expected = avgDailyVolume * pmFrac;
  } else {
    expected = avgDailyVolume * Math.max(0.02, expectedVolumeFraction(s.minutes - open));
  }
  return Math.round((todayCumVolume / expected) * 100) / 100;
}

// ── Level engine ──

export type LevelSource =
  | "pm-high" | "pm-low" | "prev-high" | "prev-low" | "prev-close" | "open"
  | "or1-high" | "or1-low" | "or5-high" | "or5-low" | "or15-high" | "or15-low"
  | "hod" | "lod" | "swing-high" | "swing-low" | "round" | "half"
  | "gap-fill" | "vwap" | "ema" | "daily-level";

export interface LevelCandidate {
  price: number;
  source: LevelSource;
  timeframe: "1m" | "5m" | "15m" | "1h" | "day";
  touches: number;
  /** Total volume traded in bars whose range covered this price. */
  volume: number;
  lastTouchMs: number;
}

export interface LevelZone {
  price: number;
  low: number;
  high: number;
  kind: "support" | "resistance";
  strength: number;
  touches: number;
  timeframes: string[];
  sources: LevelSource[];
  reasons: string[];
}

/** One centralized, documented weight table (surfaced in settings). */
export const LEVEL_WEIGHTS = {
  perTouch: 7,          // each distinct touch, capped
  touchCap: 5,
  perTimeframe: 8,      // each extra timeframe agreeing, capped at 3
  keySession: 14,       // PM high/low, prev day high/low/close, HOD/LOD
  openingRange: 8,
  vwapConfluence: 8,
  emaConfluence: 6,
  roundNumber: 6,
  gapFill: 8,
  recencyHalfLifeMin: 120, // touch recency decay
  recencyMax: 12,
  volumeMax: 10,        // share of session volume near the level
  polarityFlip: 8,      // broke through then respected from other side
};

export const LEVEL_BANDS = [
  { min: 90, label: "major" },
  { min: 80, label: "strong" },
  { min: 65, label: "meaningful" },
  { min: 50, label: "minor" },
  { min: 0, label: "noise" },
] as const;

export function levelBand(strength: number): string {
  return LEVEL_BANDS.find((b) => strength >= b.min)?.label ?? "noise";
}

function swingPivots(bars: IntradayBar[], span = 2): { highs: LevelCandidate[]; lows: LevelCandidate[] } {
  const highs: LevelCandidate[] = [];
  const lows: LevelCandidate[] = [];
  for (let i = span; i < bars.length - span; i++) {
    const hs = bars.slice(i - span, i + span + 1).map((b) => b.h);
    const ls = bars.slice(i - span, i + span + 1).map((b) => b.l);
    if (bars[i].h === Math.max(...hs)) {
      highs.push({ price: bars[i].h, source: "swing-high", timeframe: "5m", touches: 1, volume: bars[i].v, lastTouchMs: bars[i].t });
    }
    if (bars[i].l === Math.min(...ls)) {
      lows.push({ price: bars[i].l, source: "swing-low", timeframe: "5m", touches: 1, volume: bars[i].v, lastTouchMs: bars[i].t });
    }
  }
  return { highs, lows };
}

export interface LevelEngineInput {
  /** Today's (and optionally prior days') 1-minute bars, oldest first. */
  minuteBars: IntradayBar[];
  /** Daily bars for prior-day levels + daily swings, oldest first. */
  dailyBars: Bar[];
  /** Evaluation moment (defaults to last minute bar). */
  nowMs?: number;
}

export interface LevelEngineResult {
  zones: LevelZone[];
  atr5m: number | null;
  vwap: number | null;
  price: number;
  keyMarks: { label: string; price: number }[];
}

/**
 * Candidate levels from every structural source, clustered into zones
 * with an ATR-aware tolerance so five nearly identical lines become
 * one zone, then scored 0-100 with explicit reasons.
 */
export function buildLevels(input: LevelEngineInput): LevelEngineResult | null {
  const bars = input.minuteBars;
  if (bars.length < 10) return null;
  const nowMs = input.nowMs ?? bars[bars.length - 1].t;
  const today = etStamp(nowMs).date;
  const price = bars[bars.length - 1].c;

  const bars5 = resample(bars, 5);
  const bars15 = resample(bars, 15);
  const bars60 = resample(bars, 60);
  const atr5arr = atrSeries(bars5, 14);
  const atr5 = atr5arr[atr5arr.length - 1] ?? null;
  const tol = Math.max(price * 0.0008, (atr5 ?? price * 0.004) * 0.3);

  const vwapArr = sessionVwapSeries(bars);
  const vwap = vwapArr[vwapArr.length - 1];

  const cands: LevelCandidate[] = [];
  const mark = (price_: number, source: LevelSource, timeframe: LevelCandidate["timeframe"], ms = nowMs) => {
    if (Number.isFinite(price_) && price_ > 0) {
      cands.push({ price: price_, source, timeframe, touches: 1, volume: 0, lastTouchMs: ms });
    }
  };

  // Session levels for today
  let pmHigh = -Infinity, pmLow = Infinity, rthHigh = -Infinity, rthLow = Infinity;
  let openPrice: number | null = null;
  for (const b of bars) {
    const s = etStamp(b.t);
    if (s.date !== today) continue;
    const sess = sessionOf(b.t);
    if (sess === "premarket") {
      pmHigh = Math.max(pmHigh, b.h);
      pmLow = Math.min(pmLow, b.l);
    } else if (sess === "rth") {
      if (openPrice === null) openPrice = b.o;
      rthHigh = Math.max(rthHigh, b.h);
      rthLow = Math.min(rthLow, b.l);
    }
  }
  if (pmHigh > 0 && Number.isFinite(pmHigh)) mark(pmHigh, "pm-high", "1m");
  if (Number.isFinite(pmLow) && pmLow < Infinity) mark(pmLow, "pm-low", "1m");
  if (Number.isFinite(rthHigh) && rthHigh > 0) mark(rthHigh, "hod", "1m");
  if (Number.isFinite(rthLow) && rthLow < Infinity) mark(rthLow, "lod", "1m");
  if (openPrice !== null) mark(openPrice, "open", "1m");

  // Previous day levels + gap fill
  const prevDaily = input.dailyBars.filter((d) => etStamp(d.t).date < today);
  const prev = prevDaily[prevDaily.length - 1];
  if (prev) {
    mark(prev.h, "prev-high", "day", prev.t);
    mark(prev.l, "prev-low", "day", prev.t);
    mark(prev.c, "prev-close", "day", prev.t);
    if (openPrice !== null && Math.abs(openPrice - prev.c) / prev.c > 0.005) mark(prev.c, "gap-fill", "day", prev.t);
  }
  // Daily swing levels (last ~60 sessions)
  const dwin = prevDaily.slice(-60);
  for (let i = 2; i < dwin.length - 2; i++) {
    const hs = dwin.slice(i - 2, i + 3).map((b) => b.h);
    const ls = dwin.slice(i - 2, i + 3).map((b) => b.l);
    if (dwin[i].h === Math.max(...hs)) mark(dwin[i].h, "daily-level", "day", dwin[i].t);
    if (dwin[i].l === Math.min(...ls)) mark(dwin[i].l, "daily-level", "day", dwin[i].t);
  }

  // Opening ranges
  for (const [mins, hs, ls] of [[1, "or1-high", "or1-low"], [5, "or5-high", "or5-low"], [15, "or15-high", "or15-low"]] as const) {
    const or = openingRange(bars, mins, today);
    if (or) {
      mark(or.high, hs, "1m");
      mark(or.low, ls, "1m");
    }
  }

  // Swing pivots on 5m / 15m / 60m
  for (const [tfBars, tf] of [[bars5, "5m"], [bars15, "15m"], [bars60, "1h"]] as const) {
    const { highs, lows } = swingPivots(tfBars);
    for (const c of [...highs, ...lows]) cands.push({ ...c, timeframe: tf });
  }

  // Round / half dollars within ~2.5 ATR of price
  const span = (atr5 ?? price * 0.01) * 2.5;
  const step = price < 50 ? 0.5 : 1;
  for (let lv = Math.ceil((price - span) / step) * step; lv <= price + span; lv += step) {
    const rounded = Math.round(lv * 100) / 100;
    mark(rounded, Number.isInteger(rounded) ? "round" : "half", "day");
  }

  // Cluster into zones
  const sorted = [...cands].sort((a, b) => a.price - b.price);
  const clusters: LevelCandidate[][] = [];
  for (const c of sorted) {
    const cur = clusters[clusters.length - 1];
    if (cur && Math.abs(c.price - cur[cur.length - 1].price) <= tol) cur.push(c);
    else clusters.push([c]);
  }

  // Volume traded near each zone (today's bars whose range covers it)
  const todayBars = bars.filter((b) => etStamp(b.t).date === today);
  const totalVol = todayBars.reduce((a, b) => a + b.v, 0) || 1;

  const W = LEVEL_WEIGHTS;
  const zones: LevelZone[] = [];
  for (const cl of clusters) {
    // Structural anchor required: a cluster of only round numbers or
    // only EMAs is not a level by itself.
    const structural = cl.filter((c) => c.source !== "round" && c.source !== "half");
    if (structural.length === 0) continue;
    const zPrice = structural.reduce((a, c) => a + c.price, 0) / structural.length;

    const touches = todayBars.filter((b) => b.l <= zPrice + tol && b.h >= zPrice - tol).length;
    const volNear = todayBars.filter((b) => b.l <= zPrice + tol && b.h >= zPrice - tol).reduce((a, b) => a + b.v, 0);
    const tfs = Array.from(new Set(cl.map((c) => c.timeframe)));
    const srcs = Array.from(new Set(cl.map((c) => c.source)));
    const reasons: string[] = [];
    let s = 0;

    const touchScore = Math.min(W.touchCap, Math.ceil(touches / 3)) * W.perTouch;
    if (touchScore > 0) { s += touchScore; reasons.push(`${touches} bar touches today`); }
    if (tfs.length > 1) { s += Math.min(3, tfs.length - 1) * W.perTimeframe; reasons.push(`${tfs.length} timeframes agree (${tfs.join(", ")})`); }
    const keySrc = srcs.filter((x) => ["pm-high", "pm-low", "prev-high", "prev-low", "prev-close", "hod", "lod"].includes(x));
    for (const k of keySrc) { s += W.keySession; reasons.push(k.replace(/-/g, " ")); }
    if (srcs.some((x) => x.startsWith("or"))) { s += W.openingRange; reasons.push("opening range level"); }
    if (vwap !== null && Math.abs(vwap - zPrice) <= tol) { s += W.vwapConfluence; reasons.push("VWAP confluence"); }
    if (srcs.includes("round")) { s += W.roundNumber; reasons.push("whole-dollar level"); }
    else if (srcs.includes("half")) { s += Math.round(W.roundNumber / 2); reasons.push("half-dollar level"); }
    if (srcs.includes("gap-fill")) { s += W.gapFill; reasons.push("gap-fill level"); }
    if (srcs.includes("daily-level")) { s += W.keySession; reasons.push("daily swing level"); }
    const swingCount = cl.filter((c) => c.source === "swing-high" || c.source === "swing-low").length;
    if (swingCount >= 2) { s += Math.min(3, swingCount - 1) * W.perTouch; reasons.push(`${swingCount} swing rejections`); }
    // Recency decay on the newest touch
    const newest = Math.max(...cl.map((c) => c.lastTouchMs));
    const ageMin = (nowMs - newest) / 60e3;
    const rec = W.recencyMax * Math.exp((-Math.LN2 * ageMin) / W.recencyHalfLifeMin);
    s += rec;
    // Volume share near the level
    const volScore = Math.min(W.volumeMax, (volNear / totalVol) * 40);
    if (volScore >= 3) reasons.push("high volume traded at level");
    s += volScore;
    // Polarity flip: price traded meaningfully on both sides today
    const above = todayBars.some((b) => b.c > zPrice + tol * 2);
    const below = todayBars.some((b) => b.c < zPrice - tol * 2);
    if (above && below && touches >= 2) { s += W.polarityFlip; reasons.push("changed polarity (broken then respected)"); }

    // Every zone must explain itself, even weak ones: fall back to a
    // plain description of where it came from.
    if (reasons.length === 0) {
      reasons.push(...srcs.slice(0, 3).map((x) => `${x.replace(/-/g, " ")} (${tfs.join("/")})`));
    }

    zones.push({
      price: Math.round(zPrice * 100) / 100,
      low: Math.round((zPrice - tol) * 100) / 100,
      high: Math.round((zPrice + tol) * 100) / 100,
      kind: zPrice >= price ? "resistance" : "support",
      // Soft cap: raw points saturate toward 100 instead of piling up
      // at it, so "100" stays rare and strengths remain comparable.
      strength: Math.round(100 * (1 - Math.exp(-Math.max(0, s) / 70))),
      touches,
      timeframes: tfs,
      sources: srcs,
      reasons,
    });
  }

  zones.sort((a, b) => b.strength - a.strength);
  // Merge overlapping zones keeping the stronger
  const kept: LevelZone[] = [];
  for (const z of zones) {
    if (!kept.some((k) => Math.abs(k.price - z.price) <= tol * 1.5)) kept.push(z);
  }
  kept.sort((a, b) => a.price - b.price);

  const keyMarks: { label: string; price: number }[] = [];
  if (Number.isFinite(pmHigh) && pmHigh > 0) keyMarks.push({ label: "PM High", price: pmHigh });
  if (Number.isFinite(pmLow) && pmLow < Infinity) keyMarks.push({ label: "PM Low", price: pmLow });
  if (prev) keyMarks.push({ label: "Prev Close", price: prev.c }, { label: "Prev High", price: prev.h }, { label: "Prev Low", price: prev.l });
  if (openPrice !== null) keyMarks.push({ label: "Open", price: openPrice });

  return { zones: kept, atr5m: atr5, vwap: vwap ?? null, price, keyMarks };
}

// ── Intraday trend (7 states + confidence) ──

export type IntradayTrend =
  | "Strongly Bullish" | "Bullish" | "Slightly Bullish" | "Neutral"
  | "Slightly Bearish" | "Bearish" | "Strongly Bearish";

export interface TrendResult {
  label: IntradayTrend;
  confidence: number; // 0-100
  signals: { name: string; dir: "bull" | "bear" | "flat"; detail: string }[];
}

export function intradayTrend(
  minuteBars: IntradayBar[],
  opts: { rvol?: number | null } = {}
): TrendResult | null {
  if (minuteBars.length < 30) return null;
  const bars5 = resample(minuteBars, 5);
  if (bars5.length < 10) return null;
  const closes5 = bars5.map((b) => b.c);
  const price = closes5[closes5.length - 1];
  const signals: TrendResult["signals"] = [];
  let bull = 0;
  let bear = 0;
  let total = 0;
  const vote = (name: string, dir: "bull" | "bear" | "flat", detail: string, weight = 1) => {
    signals.push({ name, dir, detail });
    total += weight;
    if (dir === "bull") bull += weight;
    if (dir === "bear") bear += weight;
  };

  const vwapArr = sessionVwapSeries(minuteBars);
  const vwap = vwapArr[vwapArr.length - 1];
  if (vwap !== null) {
    const d = ((price - vwap) / vwap) * 100;
    vote("VWAP", Math.abs(d) < 0.05 ? "flat" : d > 0 ? "bull" : "bear", `${d >= 0 ? "+" : ""}${d.toFixed(2)}% vs session VWAP`, 2);
  }
  const e9 = emaSeries(closes5, 9);
  const e20 = emaSeries(closes5, 20);
  const l9 = e9[e9.length - 1];
  const l20 = e20[e20.length - 1];
  if (l9 !== null && l20 !== null) {
    vote("Price vs EMA9", price > l9 ? "bull" : "bear", price > l9 ? "above 5m EMA9" : "below 5m EMA9");
    vote("EMA9 vs EMA20", l9 > l20 ? "bull" : "bear", l9 > l20 ? "EMA9 > EMA20" : "EMA9 < EMA20");
    const b20 = e20[e20.length - 4];
    if (b20 !== null && b20 > 0) {
      const slope = ((l20 - b20) / b20) * 100;
      vote("EMA20 slope", slope > 0.03 ? "bull" : slope < -0.03 ? "bear" : "flat", `${slope.toFixed(2)}%/3 bars`);
    }
  }
  // Swing structure on 5m
  const win = bars5.slice(-40);
  const hs: number[] = [];
  const ls: number[] = [];
  for (let i = 2; i < win.length - 2; i++) {
    const hh = win.slice(i - 2, i + 3).map((b) => b.h);
    const ll = win.slice(i - 2, i + 3).map((b) => b.l);
    if (win[i].h === Math.max(...hh)) hs.push(win[i].h);
    if (win[i].l === Math.min(...ll)) ls.push(win[i].l);
  }
  if (hs.length >= 2 && ls.length >= 2) {
    const hh = hs[hs.length - 1] > hs[hs.length - 2];
    const hl = ls[ls.length - 1] > ls[ls.length - 2];
    if (hh && hl) vote("Structure", "bull", "higher highs and higher lows", 2);
    else if (!hh && !hl) vote("Structure", "bear", "lower highs and lower lows", 2);
    else vote("Structure", "flat", "mixed swings");
  }
  const macd = macdSeries(closes5);
  const h0 = macd.histogram[macd.histogram.length - 1];
  if (h0 !== null && Math.abs(h0) >= price * 0.0004) {
    vote("MACD", h0 > 0 ? "bull" : "bear", h0 > 0 ? "histogram positive" : "histogram negative");
  }
  if (opts.rvol != null) {
    // Volume is a CONFIRMATION multiplier, not a direction.
    vote("RVOL", "flat", `${opts.rvol.toFixed(2)}x time-adjusted`, 0);
  }

  const net = bull - bear;
  const denom = Math.max(1, total);
  const conviction = Math.abs(net) / denom;
  const volBoost = opts.rvol != null && opts.rvol >= 1.5 ? 1.1 : 1;
  const confidence = Math.round(Math.min(100, conviction * 100 * volBoost));
  const dirSign = net > 0 ? 1 : net < 0 ? -1 : 0;

  let label: IntradayTrend = "Neutral";
  if (dirSign > 0) label = conviction >= 0.75 && (opts.rvol ?? 1) >= 1.3 ? "Strongly Bullish" : conviction >= 0.45 ? "Bullish" : conviction >= 0.2 ? "Slightly Bullish" : "Neutral";
  if (dirSign < 0) label = conviction >= 0.75 && (opts.rvol ?? 1) >= 1.3 ? "Strongly Bearish" : conviction >= 0.45 ? "Bearish" : conviction >= 0.2 ? "Slightly Bearish" : "Neutral";

  return { label, confidence, signals };
}
