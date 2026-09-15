// ─────────────────────────────────────────────────────────
// Multi-timeframe matrix (pure, unit-tested). One compact row per
// timeframe so the whole picture reads in a second:
//
//   TF   TREND    MOMENTUM   VWAP    EMA        MACD  STRUCTURE
//   5m   BEAR     BEAR       BELOW   STACKED DN NEG   BREAKDOWN
//
// Every cell comes from a documented rule on that timeframe's own
// bars. Nothing is estimated: a cell is N/A when the bars cannot
// support it (too few bars, no session VWAP on daily bars).
// ─────────────────────────────────────────────────────────

import type { Bar } from "./bars";
import { emaSeries, macdSeries } from "./indicators";
import { etStamp, resample, sessionOf, sessionVwapSeries } from "./intraday";
import type { SetupDirection } from "./setupMachine";

export type MatrixTf = "1m" | "2m" | "5m" | "15m" | "30m" | "1h" | "D";
export const MATRIX_TFS: MatrixTf[] = ["1m", "2m", "5m", "15m", "30m", "1h", "D"];

export type Lean = "BULL" | "BEAR" | "NEUTRAL" | "CHOP" | "N/A";
export type Momentum = "BULL" | "BEAR" | "IMPROVING" | "FADING" | "FLAT" | "N/A";
export type VwapSide = "ABOVE" | "BELOW" | "AT" | "N/A";
export type EmaStack = "STACKED UP" | "STACKED DOWN" | "MIXED" | "N/A";
export type MacdState = "POS" | "NEG" | "FLAT" | "N/A";
export type Structure = "HH/HL" | "LH/LL" | "RANGE" | "BREAKOUT" | "BREAKDOWN" | "N/A";

export interface MatrixRow {
  tf: MatrixTf;
  bars: number;
  trend: Lean;
  momentum: Momentum;
  vwap: VwapSide;
  /** Percent from VWAP, signed. */
  vwapPct: number | null;
  ema: EmaStack;
  macd: MacdState;
  structure: Structure;
  /** Nearest swing support / resistance on this timeframe. */
  support: number | null;
  resistance: number | null;
  /** Setup machine state on this timeframe when the engine ran one. */
  setup: string | null;
  /** One-line detail for a tooltip. */
  detail: string;
}

export interface Alignment {
  /** 0-10: how much of the intraday stack (and the daily) leans the plan's way. */
  score: number;
  lean: Lean;
  agree: MatrixTf[];
  against: MatrixTf[];
  /** True when the daily leans against the intraday direction, or intraday rows split evenly. */
  conflict: boolean;
}

const lastOf = <T>(a: (T | null)[]): T | null => (a.length ? a[a.length - 1] : null);

/** Swing highs/lows with a 2-bar lookback on each side. */
export function swings(bars: Bar[]): { highs: { i: number; p: number }[]; lows: { i: number; p: number }[] } {
  const highs: { i: number; p: number }[] = [];
  const lows: { i: number; p: number }[] = [];
  for (let i = 2; i < bars.length - 2; i++) {
    const win = bars.slice(i - 2, i + 3);
    if (bars[i].h === Math.max(...win.map((b) => b.h))) highs.push({ i, p: bars[i].h });
    if (bars[i].l === Math.min(...win.map((b) => b.l))) lows.push({ i, p: bars[i].l });
  }
  return { highs, lows };
}

export function readStructure(bars: Bar[]): { structure: Structure; support: number | null; resistance: number | null } {
  if (bars.length < 12) return { structure: "N/A", support: null, resistance: null };
  const win = bars.slice(-40);
  const { highs, lows } = swings(win);
  const price = win[win.length - 1].c;
  const support = [...lows].reverse().find((l) => l.p < price)?.p ?? null;
  const resistance = [...highs].reverse().find((h) => h.p > price)?.p ?? null;
  // Breakout / breakdown: the last close cleared every high (low) of the
  // 20 bars before it.
  const prior = win.slice(-21, -1);
  if (prior.length >= 10) {
    if (price > Math.max(...prior.map((b) => b.h))) return { structure: "BREAKOUT", support, resistance };
    if (price < Math.min(...prior.map((b) => b.l))) return { structure: "BREAKDOWN", support, resistance };
  }
  if (highs.length >= 2 && lows.length >= 2) {
    const hh = highs[highs.length - 1].p > highs[highs.length - 2].p;
    const hl = lows[lows.length - 1].p > lows[lows.length - 2].p;
    if (hh && hl) return { structure: "HH/HL", support, resistance };
    if (!hh && !hl) return { structure: "LH/LL", support, resistance };
  }
  return { structure: "RANGE", support, resistance };
}

/** Number of times the close crossed the EMA20 over the last `n` bars: chop fuel. */
export function emaCrosses(closes: number[], ema: (number | null)[], n = 12): number {
  let crosses = 0;
  let prev: 1 | -1 | 0 = 0;
  for (let i = Math.max(0, closes.length - n); i < closes.length; i++) {
    const e = ema[i];
    if (e === null) continue;
    const side: 1 | -1 = closes[i] >= e ? 1 : -1;
    if (prev !== 0 && side !== prev) crosses++;
    prev = side;
  }
  return crosses;
}

export function readRow(tf: MatrixTf, bars: Bar[], vwap: number | null, setup: string | null): MatrixRow {
  const base: MatrixRow = { tf, bars: bars.length, trend: "N/A", momentum: "N/A", vwap: "N/A", vwapPct: null, ema: "N/A", macd: "N/A", structure: "N/A", support: null, resistance: null, setup, detail: "not enough bars" };
  if (bars.length < 22) return base;
  const closes = bars.map((b) => b.c);
  const price = closes[closes.length - 1];
  const e9 = emaSeries(closes, 9), e20 = emaSeries(closes, 20), e50 = emaSeries(closes, 50);
  const l9 = lastOf(e9), l20 = lastOf(e20), l50 = lastOf(e50);
  // EMA stack: 9 over 20 over 50 (50 optional when the frame is short).
  let ema: EmaStack = "N/A";
  if (l9 !== null && l20 !== null) {
    const up = price > l9 && l9 > l20 && (l50 === null || l20 > l50);
    const down = price < l9 && l9 < l20 && (l50 === null || l20 < l50);
    ema = up ? "STACKED UP" : down ? "STACKED DOWN" : "MIXED";
  }
  // MACD histogram: sign plus whether it is rising or falling over 3 bars.
  const m = bars.length >= 35 ? macdSeries(closes) : null;
  const h0 = m ? lastOf(m.histogram) : null;
  const h3 = m && m.histogram.length > 3 ? m.histogram[m.histogram.length - 4] : null;
  const gate = price * 0.0003;
  const macd: MacdState = h0 === null ? "N/A" : Math.abs(h0) < gate ? "FLAT" : h0 > 0 ? "POS" : "NEG";
  let momentum: Momentum = "N/A";
  if (h0 !== null) {
    const rising = h3 !== null ? h0 > h3 : false;
    const falling = h3 !== null ? h0 < h3 : false;
    momentum = Math.abs(h0) < gate ? "FLAT" : h0 > 0 ? (falling ? "FADING" : "BULL") : rising ? "IMPROVING" : "BEAR";
  }
  const vwapPct = vwap !== null && vwap > 0 ? Math.round(((price - vwap) / vwap) * 10000) / 100 : null;
  const vwapSide: VwapSide = vwapPct === null ? "N/A" : Math.abs(vwapPct) < 0.05 ? "AT" : vwapPct > 0 ? "ABOVE" : "BELOW";
  const st = readStructure(bars);
  // Trend: EMA stack and structure vote; frequent EMA20 crosses = chop.
  const crosses = emaCrosses(closes, e20);
  let trend: Lean = "NEUTRAL";
  const bullVotes = (ema === "STACKED UP" ? 1 : 0) + (st.structure === "HH/HL" || st.structure === "BREAKOUT" ? 1 : 0) + (macd === "POS" ? 1 : 0);
  const bearVotes = (ema === "STACKED DOWN" ? 1 : 0) + (st.structure === "LH/LL" || st.structure === "BREAKDOWN" ? 1 : 0) + (macd === "NEG" ? 1 : 0);
  if (crosses >= 3 && Math.abs(bullVotes - bearVotes) <= 1) trend = "CHOP";
  else if (bullVotes >= 2 && bearVotes === 0) trend = "BULL";
  else if (bearVotes >= 2 && bullVotes === 0) trend = "BEAR";
  else if (bullVotes - bearVotes >= 2) trend = "BULL";
  else if (bearVotes - bullVotes >= 2) trend = "BEAR";
  const detail = `${ema}${l9 !== null && l20 !== null ? ` (9 ${l9.toFixed(2)} / 20 ${l20.toFixed(2)})` : ""} · MACD ${macd}${h0 !== null ? ` ${h0.toFixed(3)}` : ""} · ${st.structure} · EMA20 crosses ${crosses}/12`;
  return { ...base, trend, momentum, vwap: vwapSide, vwapPct, ema, macd, structure: st.structure, support: st.support, resistance: st.resistance, detail };
}

export interface MatrixInput {
  m1: Bar[];
  daily: Bar[];
  nowMs: number;
  /** Setup machine state per timeframe from the engine (1m/5m/15m/1h/D), when available. */
  setupStates?: Partial<Record<MatrixTf, string | null>>;
}

/** Builds all seven rows. Intraday rows use regular-hours bars; VWAP is the session VWAP from the minute bars. */
export function buildMatrix(i: MatrixInput): MatrixRow[] {
  const rth = i.m1.filter((b) => sessionOf(b.t) === "rth" || sessionOf(b.t) === "premarket");
  const vwapArr = sessionVwapSeries(i.m1);
  const vwap = vwapArr.length ? vwapArr[vwapArr.length - 1] : null;
  const today = etStamp(i.nowMs).date;
  const todays = rth.filter((b) => etStamp(b.t).date === today);
  const s = i.setupStates ?? {};
  // 1m/2m read today's session only (yesterday's minute noise is not today's trend).
  const rows: MatrixRow[] = [
    readRow("1m", todays.slice(-120), vwap, s["1m"] ?? null),
    readRow("2m", resample(todays, 2).slice(-90), vwap, s["2m"] ?? null),
    readRow("5m", resample(rth, 5).slice(-80), vwap, s["5m"] ?? null),
    readRow("15m", resample(rth, 15).slice(-80), vwap, s["15m"] ?? null),
    readRow("30m", resample(rth, 30).slice(-80), vwap, s["30m"] ?? null),
    readRow("1h", resample(rth, 60).slice(-80), vwap, s["1h"] ?? null),
    readRow("D", i.daily.slice(-120), null, s["D"] ?? null),
  ];
  return rows;
}

/** How the stack lines up with a plan direction. Daily counts double; 1m counts half. */
export function alignment(rows: MatrixRow[], direction: SetupDirection): Alignment {
  const want: Lean = direction === "long" ? "BULL" : "BEAR";
  const other: Lean = direction === "long" ? "BEAR" : "BULL";
  const weight = (tf: MatrixTf) => (tf === "D" ? 2 : tf === "1m" ? 0.5 : 1);
  let forW = 0, againstW = 0, totalW = 0;
  const agree: MatrixTf[] = [], against: MatrixTf[] = [];
  for (const r of rows) {
    if (r.trend === "N/A") continue;
    const w = weight(r.tf);
    totalW += w;
    if (r.trend === want) { forW += w; agree.push(r.tf); }
    else if (r.trend === other) { againstW += w; against.push(r.tf); }
  }
  const daily = rows.find((r) => r.tf === "D");
  const dailyAgainst = daily ? daily.trend === other : false;
  const score = totalW > 0 ? Math.round(Math.max(0, (forW - againstW * 0.5) / totalW) * 10) : 0;
  const intraday = rows.filter((r) => r.tf !== "D" && r.trend !== "N/A");
  const split = intraday.length >= 4 && Math.abs(intraday.filter((r) => r.trend === want).length - intraday.filter((r) => r.trend === other).length) <= 1 && intraday.some((r) => r.trend === other);
  const lean: Lean = totalW === 0 ? "N/A" : forW > againstW * 1.5 ? want : againstW > forW * 1.5 ? other : rows.filter((r) => r.trend === "CHOP").length >= 3 ? "CHOP" : "NEUTRAL";
  return { score, lean, agree, against, conflict: dailyAgainst || split };
}
