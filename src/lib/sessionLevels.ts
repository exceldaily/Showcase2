// Session reference levels (pure). Previous-day high/low from daily
// bars, premarket and overnight high/low and the opening range from
// today's minute bars. Nothing is estimated: a level is null until
// the bars that define it exist.

import type { Bar } from "./bars";
import { etStamp, openingRange, sessionOf } from "./intraday";

export interface SessionLevels {
  day: string | null;
  prevHigh: number | null;
  prevLow: number | null;
  prevClose: number | null;
  premarketHigh: number | null;
  premarketLow: number | null;
  /** Overnight = yesterday's after-hours plus today's premarket. */
  overnightHigh: number | null;
  overnightLow: number | null;
  openingRangeHigh: number | null;
  openingRangeLow: number | null;
  openingRangeComplete: boolean;
  todayHigh: number | null;
  todayLow: number | null;
  todayOpen: number | null;
}

const EMPTY: SessionLevels = {
  day: null, prevHigh: null, prevLow: null, prevClose: null, premarketHigh: null, premarketLow: null,
  overnightHigh: null, overnightLow: null, openingRangeHigh: null, openingRangeLow: null, openingRangeComplete: false,
  todayHigh: null, todayLow: null, todayOpen: null,
};

export function sessionLevels(m1: Bar[], daily: Bar[], nowMs: number, orMinutes = 15): SessionLevels {
  if (m1.length === 0) return EMPTY;
  const today = etStamp(Math.min(nowMs, m1[m1.length - 1].t)).date;
  const prevDaily = daily.filter((d) => etStamp(d.t).date < today);
  const prev = prevDaily[prevDaily.length - 1] ?? null;
  const prevDay = prev ? etStamp(prev.t).date : null;

  let pmH = -Infinity, pmL = Infinity, onH = -Infinity, onL = Infinity, tdH = -Infinity, tdL = Infinity;
  let tdOpen: number | null = null;
  for (const b of m1) {
    const s = etStamp(b.t);
    const sess = sessionOf(b.t);
    if (s.date === today) {
      if (sess === "premarket") { pmH = Math.max(pmH, b.h); pmL = Math.min(pmL, b.l); onH = Math.max(onH, b.h); onL = Math.min(onL, b.l); }
      if (sess === "rth") { tdH = Math.max(tdH, b.h); tdL = Math.min(tdL, b.l); if (tdOpen === null) tdOpen = b.o; }
    } else if (prevDay && s.date === prevDay && sess === "afterhours") {
      onH = Math.max(onH, b.h); onL = Math.min(onL, b.l);
    }
  }
  const or = openingRange(m1, orMinutes, today);
  const fin = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
  return {
    day: today,
    prevHigh: prev ? prev.h : null,
    prevLow: prev ? prev.l : null,
    prevClose: prev ? prev.c : null,
    premarketHigh: fin(pmH), premarketLow: fin(pmL),
    overnightHigh: fin(onH), overnightLow: fin(onL),
    openingRangeHigh: or ? Math.round(or.high * 100) / 100 : null,
    openingRangeLow: or ? Math.round(or.low * 100) / 100 : null,
    openingRangeComplete: or?.complete ?? false,
    todayHigh: fin(tdH), todayLow: fin(tdL), todayOpen: tdOpen,
  };
}
