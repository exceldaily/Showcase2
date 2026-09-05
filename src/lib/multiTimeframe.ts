// ─────────────────────────────────────────────────────────
// Multi-timeframe setups (pure, unit-tested).
// The same trend read + level pick + state machine + plan, evaluated
// independently on 1m / 5m / 15m / 1h / daily / weekly bars, so a
// trader can see whether the 5-minute break is happening inside a
// bullish hour and week, or against them. Intraday timeframes share
// the intraday zone engine; daily/weekly derive zones from their own
// swing structure. No lookahead: every timeframe only sees its own
// closed bars up to "now".
// ─────────────────────────────────────────────────────────

import type { Bar } from "./bars";
import { atrSeries, findLevels } from "./indicators";
import { etStamp, resample, sessionOf, sessionVwapSeries, type LevelZone } from "./intraday";
import { readTrend, type PulseRegime } from "./marketPulse";
import {
  buildTradePlan, roomToMove, runMachine, DEFAULT_BREAKOUT_CONFIG,
  type MachineState, type SetupDirection, type TradePlan, type RoomResult,
} from "./setupMachine";

export type SetupTf = "1m" | "5m" | "15m" | "1h" | "D" | "W";
export const SETUP_TFS: SetupTf[] = ["1m", "5m", "15m", "1h", "D", "W"];

export interface TfSetup {
  tf: SetupTf;
  bars: number;
  trend: PulseRegime | null;
  trendBull: number;
  trendBear: number;
  direction: SetupDirection;
  trigger: number | null;
  state: MachineState["state"] | null;
  quality: number;
  plan: TradePlan | null;
  room: RoomResult | null;
  atr: number | null;
  rvol: number | null;
  zones: LevelZone[];
  note: string | null;
}

/** ISO-week bucketed weekly bars from daily bars (Mon..Fri sessions). */
export function resampleWeekly(daily: Bar[]): Bar[] {
  const out: Bar[] = [];
  let cur: Bar | null = null;
  let key = "";
  for (const b of daily) {
    const d = new Date(b.t);
    // ISO week key: Thursday of the same week identifies the week/year.
    const day = (d.getUTCDay() + 6) % 7; // Mon=0
    const thu = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
    const k = `${thu.getUTCFullYear()}-${Math.ceil(((thu.getTime() - Date.UTC(thu.getUTCFullYear(), 0, 1)) / 86400e3 + 1) / 7)}`;
    if (!cur || k !== key) {
      if (cur) out.push(cur);
      cur = { ...b };
      key = k;
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
      cur.vw = b.vw;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Swing-structure zones for daily/weekly bars via the shared level finder. */
export function structureZones(bars: Bar[], price: number, lookback: number): LevelZone[] {
  const levels = findLevels(bars, lookback, 0.012);
  return levels.map((l) => {
    const strength = Math.min(100, 45 + l.touches * 12);
    return {
      price: Math.round(l.price * 100) / 100,
      low: Math.round(l.price * 0.995 * 100) / 100,
      high: Math.round(l.price * 1.005 * 100) / 100,
      kind: l.price >= price ? "resistance" : "support",
      strength,
      touches: l.touches,
      timeframes: [],
      sources: ["swing-high"],
      reasons: [`${l.touches} touches on this timeframe's swings`],
    } as LevelZone;
  });
}

export interface MtfInput {
  symbol: string;
  minuteBars: Bar[];
  dailyBars: Bar[];
  intradayZones: LevelZone[];
  price: number;
  rvolIntraday: number | null;
  nowMs: number;
}

function pickTrigger(direction: SetupDirection, price: number, zones: LevelZone[], minStrength = 60): number | null {
  const opposing = zones
    .filter((z) => z.strength >= minStrength)
    .filter((z) => (direction === "long" ? z.price > price * 1.0002 : z.price < price * 0.9998))
    .sort((a, b) => (direction === "long" ? a.price - b.price : b.price - a.price));
  return opposing[0]?.price ?? null;
}

function evaluateTf(
  tf: SetupTf,
  bars: Bar[],
  machineBars: Bar[],
  zones: LevelZone[],
  price: number,
  rvol: number | null,
  vwap: number | null,
  synthUnit: number,
  symbol: string
): TfSetup {
  const base: TfSetup = {
    tf, bars: bars.length, trend: null, trendBull: 0, trendBear: 0, direction: "long", trigger: null,
    state: null, quality: 0, plan: null, room: null, atr: null, rvol, zones, note: null,
  };
  if (bars.length < 30) return { ...base, note: "not enough bars" };
  const tr = readTrend(symbol, bars);
  if (!tr) return { ...base, note: "trend unavailable" };
  const direction: SetupDirection = /Bearish/.test(tr.label) ? "short" : "long";
  const atrArr = atrSeries(bars, 14);
  const atr = atrArr[atrArr.length - 1] ?? null;
  const trigger = pickTrigger(direction, price, zones);
  const out: TfSetup = { ...base, trend: tr.label, trendBull: tr.bull, trendBear: tr.bear, direction, atr };
  if (trigger === null || atr === null) return { ...out, note: `no meaningful ${direction === "long" ? "resistance above" : "support below"} on this timeframe` };
  const plan = buildTradePlan(direction, trigger, zones, atr, DEFAULT_BREAKOUT_CONFIG, 60, synthUnit);
  const ms = machineBars.length ? runMachine(machineBars, { direction, trigger, invalidation: plan.invalidation, atr, vwap, rvol }, DEFAULT_BREAKOUT_CONFIG) : null;
  const room = roomToMove(price, direction, zones.filter((z) => Math.abs(z.price - trigger) > atr * 0.2), atr);
  return { ...out, trigger, plan, state: ms?.state ?? "WATCHING", quality: ms?.quality ?? 0, room };
}

/**
 * Evaluate all six timeframes. Intraday frames use the shared intraday
 * zones and session VWAP; daily/weekly use their own swing zones.
 */
export function buildTimeframeSetups(i: MtfInput): TfSetup[] {
  const today = etStamp(i.nowMs).date;
  const rth = i.minuteBars.filter((b) => sessionOf(b.t) === "rth" || sessionOf(b.t) === "premarket");
  const todays = i.minuteBars.filter((b) => etStamp(b.t).date === today && sessionOf(b.t) === "rth");
  const vwapArr = sessionVwapSeries(i.minuteBars);
  const vwap = vwapArr[vwapArr.length - 1] ?? null;

  const daily = i.dailyBars;
  const dtr = daily.slice(-15).map((d, k, arr) => (k === 0 ? d.h - d.l : Math.max(d.h - d.l, Math.abs(d.h - arr[k - 1].c), Math.abs(d.l - arr[k - 1].c))));
  const dailyAtr = dtr.length ? dtr.reduce((a, b) => a + b, 0) / dtr.length : i.price * 0.02;
  const weekly = resampleWeekly(daily);

  const avgDailyVol = daily.slice(-21, -1).reduce((a, b) => a + b.v, 0) / Math.max(1, Math.min(20, daily.length - 1));
  const dailyRvol = avgDailyVol > 0 && daily.length ? Math.round((daily[daily.length - 1].v / avgDailyVol) * 100) / 100 : null;
  const avgWeeklyVol = weekly.slice(-13, -1).reduce((a, b) => a + b.v, 0) / Math.max(1, Math.min(12, weekly.length - 1));
  const weeklyRvol = avgWeeklyVol > 0 && weekly.length ? Math.round((weekly[weekly.length - 1].v / avgWeeklyVol) * 100) / 100 : null;

  const m5 = resample(rth, 5);
  const m15 = resample(rth, 15);
  const h1 = resample(rth, 60);
  const t5 = resample(todays, 5);
  const t15 = resample(todays, 15);
  const lastTwoSessions = Array.from(new Set(rth.map((b) => etStamp(b.t).date))).slice(-2);
  const h1recent = h1.filter((b) => lastTwoSessions.includes(etStamp(b.t).date));

  const dailyZones = structureZones(daily.slice(-160), i.price, 150);
  const weeklyZones = structureZones(weekly.slice(-104), i.price, 100);

  return [
    evaluateTf("1m", rth.slice(-240), todays.slice(-120), i.intradayZones, i.price, i.rvolIntraday, vwap, dailyAtr, i.symbol),
    evaluateTf("5m", m5, t5, i.intradayZones, i.price, i.rvolIntraday, vwap, dailyAtr, i.symbol),
    evaluateTf("15m", m15, t15, i.intradayZones, i.price, i.rvolIntraday, vwap, dailyAtr, i.symbol),
    evaluateTf("1h", h1, h1recent, i.intradayZones, i.price, i.rvolIntraday, vwap, dailyAtr, i.symbol),
    evaluateTf("D", daily, daily.slice(-60), dailyZones, i.price, dailyRvol, null, dailyAtr * 3, i.symbol),
    evaluateTf("W", weekly, weekly.slice(-40), weeklyZones, i.price, weeklyRvol, null, dailyAtr * 6, i.symbol),
  ];
}

/** Plain-English alignment line: how many frames agree with the primary direction. */
export function alignmentSummary(setups: TfSetup[], primary: SetupDirection): string {
  const want = primary === "long" ? /Bullish/ : /Bearish/;
  const with_ = setups.filter((s) => s.trend && want.test(s.trend)).map((s) => s.tf);
  const against = setups.filter((s) => s.trend && (primary === "long" ? /Bearish/ : /Bullish/).test(s.trend)).map((s) => s.tf);
  const parts = [`Timeframes agreeing with the ${primary === "long" ? "bullish" : "bearish"} read: ${with_.length ? with_.join(", ") : "none"}.`];
  if (against.length) parts.push(`Against it: ${against.join(", ")}.`);
  if (against.some((t) => t === "D" || t === "W")) parts.push("A daily or weekly frame leaning the other way means this is a counter-trend idea; keep size and expectations small.");
  return parts.join(" ");
}
