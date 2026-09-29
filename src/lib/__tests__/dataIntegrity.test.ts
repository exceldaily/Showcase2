import { describe, expect, it } from "vitest";
import type { Bar } from "../bars";
import { bucketStartMs, etMidnightMs, referenceClose, regularHoursShare, resample, sameTimeRvol, sessionVwapSeries } from "../intraday";
import { liveCandle } from "../liveCandle";
import { dte, expiryMs, impliedVol, scenarioPrice, yearsToExpiry } from "../optionsMath";
import { sanitizeBars } from "../barSanity";
import { afterWarmup, emaSeries, macdSeries } from "../indicators";
import { buildWarm, closesBefore, stitch, warmForSlice } from "../chartWarm";
import { dayRatios, indexDailyBars, overlayRealMinutes, scaleIntradayByDay } from "../indexMode";
import { weekAlignedTail, weekKey } from "../multiTimeframe";
import { readRow } from "../timeframeMatrix";
import { openInterestMap, parseCboeDaily, parseCboeMinutes } from "@/providers/cboe";

// 2026-09-29 is a Tuesday in daylight time (ET = UTC-4).
const et = (h: number, m: number, date = "2026-09-29") => Date.parse(`${date}T${String(h + 4).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
const bar = (t: number, c: number, v = 100, o = c, h = c, l = c, vw = c): Bar => ({ t, o, h, l, c, v, vw });
const minutes = (fromH: number, fromM: number, count: number, price: (i: number) => number, v: (i: number) => number = () => 100): Bar[] =>
  Array.from({ length: count }, (_, i) => { const p = price(i); return { t: et(fromH, fromM) + i * 60_000, o: p, h: p + 0.05, l: p - 0.05, c: p, v: v(i), vw: p }; });

describe("session-anchored bars", () => {
  it("anchors hourly bars at 9:30 and keeps premarket out of the first regular bar", () => {
    expect(bucketStartMs(et(9, 45), 60)).toBe(et(9, 30));
    expect(bucketStartMs(et(10, 29), 60)).toBe(et(9, 30));
    expect(bucketStartMs(et(10, 30), 60)).toBe(et(10, 30));
    expect(bucketStartMs(et(9, 15), 60)).toBe(et(9, 0)); // premarket grid runs from 4:00
    expect(bucketStartMs(et(16, 5), 60)).toBe(et(16, 0)); // after-hours grid runs from 16:00
    const m1 = minutes(9, 0, 150, (i) => 100 + i * 0.01); // 9:00 to 11:29
    const h1 = resample(m1, 60);
    expect(h1.map((b) => b.t)).toEqual([et(9, 0), et(9, 30), et(10, 30)]);
    expect(h1[0].c).toBeCloseTo(100.29, 2); // premarket bar closes at 9:29
    expect(h1[1].o).toBeCloseTo(100.3, 2); // regular bar opens at 9:30
  });
  it("leaves 5, 15 and 30 minute bars on the clock grid and stamps the bucket start", () => {
    const m1 = minutes(9, 32, 40, (i) => 50 + i * 0.1);
    expect(resample(m1, 5)[0].t).toBe(et(9, 30));
    expect(resample(m1, 15).map((b) => b.t)).toEqual([et(9, 30), et(9, 45), et(10, 0)]);
    expect(resample(m1, 30).map((b) => b.t)).toEqual([et(9, 30), et(10, 0)]);
  });
  it("gives the same session VWAP on every timeframe", () => {
    const m1 = minutes(9, 30, 120, (i) => 200 + Math.sin(i / 7) * 2, (i) => 100 + ((i * 37) % 900));
    const truth = sessionVwapSeries(m1).at(-1) as number;
    for (const n of [2, 5, 15, 30, 60]) {
      expect(sessionVwapSeries(resample(m1, n)).at(-1) as number).toBeCloseTo(truth, 6);
    }
  });
  it("opens live hourly candles on the 9:30 grid", () => {
    const bars = [bar(et(9, 30), 100), bar(et(10, 30), 101)];
    expect(liveCandle(bars, { t: et(11, 10), price: 102 }, 3600e3)!.t).toBe(et(10, 30));
    expect(liveCandle(bars, { t: et(11, 31), price: 103 }, 3600e3)!.t).toBe(et(11, 30));
    // A regular-hours print never extends a premarket bar.
    const pre = [bar(et(9, 0), 99)];
    expect(liveCandle(pre, { t: et(9, 31), price: 100 }, 3600e3)!.t).toBe(et(9, 30));
  });
});

describe("expiry clock", () => {
  it("expires at 16:00 Eastern in summer and winter", () => {
    expect(new Date(expiryMs("2026-09-29")).toISOString()).toBe("2026-09-29T20:00:00.000Z");
    expect(new Date(expiryMs("2026-01-16")).toISOString()).toBe("2026-01-16T21:00:00.000Z");
  });
  it("counts a same-day contract's life to the close, not half an hour past it", () => {
    expect(dte("2026-09-29", et(15, 30)) * 24 * 60).toBeCloseTo(30, 5);
    expect(dte("2026-09-29", et(16, 0))).toBe(0);
    expect(yearsToExpiry("2026-09-29", et(10, 0)) * 365 * 24).toBeCloseTo(6, 5);
  });
  it("calibrates scenarios to the quote on the screen", () => {
    const now = et(10, 0);
    const input = { side: "call" as const, strike: 765, expiry: "2026-09-29", iv: 0.4, currentMid: 1.5, underlyingNow: 765, now };
    const same = scenarioPrice(input, 765, 0, "now");
    expect(same.method).toBe("bs-implied-from-mid");
    expect(same.midEstimate).toBeCloseTo(1.5, 2); // reproduces the current mid
    const later = scenarioPrice(input, 765, 60, "1h");
    expect(later.midEstimate).toBeLessThan(1.5); // an hour of decay
    expect(later.midEstimate).toBeGreaterThan(1.2);
    const solved = impliedVol("call", 765, 765, yearsToExpiry("2026-09-29", now), 1.5) as number;
    expect(solved).toBeGreaterThan(0.1);
    expect(solved).toBeLessThan(0.3); // nowhere near the provider's 0.4
    expect(scenarioPrice({ ...input, currentMid: null }, 770, 30).method).toBe("bs-iv");
  });
});

describe("bad-print filter", () => {
  const daily = (i: number, o: number, h: number, l: number, c: number): Bar => ({ t: etMidnightMs("2026-01-05") + i * 86400e3, o, h, l, c, v: 1e6, vw: c });
  it("pulls an impossible low back to the bar's own open/close and reports it", () => {
    const bars = Array.from({ length: 30 }, (_, i) => daily(i, 690 + i * 0.2, 694 + i * 0.2, 688 + i * 0.2, 692 + i * 0.2));
    bars[15] = daily(15, 689.58, 696.93, 69.005, 695.41);
    const r = sanitizeBars(bars, { minPct: 0.03 });
    expect(r.fixes).toEqual([{ t: bars[15].t, field: "l", from: 69.005, to: 689.58 }]);
    expect(r.bars[15].l).toBe(689.58);
    expect(r.bars[15].h).toBe(696.93);
    expect(r.bars[14]).toBe(bars[14]);
  });
  it("leaves real volatility alone", () => {
    const bars = Array.from({ length: 30 }, (_, i) => daily(i, 100 + i, 103 + i, 98 + i, 101 + i));
    bars[10] = daily(10, 110, 116, 104, 105); // wide but real range day
    const r = sanitizeBars(bars, { minPct: 0.03 });
    expect(r.fixes).toHaveLength(0);
    expect(r.bars).toBe(bars);
  });
  it("catches a one-minute spike no neighbour confirms", () => {
    const m1 = minutes(10, 0, 40, (i) => 230 + i * 0.01);
    m1[20] = { ...m1[20], h: 252 };
    const r = sanitizeBars(m1, { minPct: 0.012 });
    expect(r.fixes).toHaveLength(1);
    expect(r.bars[20].h).toBe(Math.max(m1[20].o, m1[20].c));
  });
});

describe("indicator warm-up", () => {
  const walk = (n: number) => Array.from({ length: n }, (_, i) => 100 + Math.sin(i / 9) * 4 + i * 0.01);
  it("matches a full-history EMA once the history is in front of the window", () => {
    const all = walk(1200);
    const window = all.slice(-280);
    const truth = emaSeries(all, 200).at(-1) as number;
    const cold = emaSeries(window, 200).at(-1) as number;
    const warmed = afterWarmup(emaSeries([...all.slice(-880, -280), ...window], 200), 600);
    expect(warmed).toHaveLength(280);
    expect(warmed[0]).not.toBeNull(); // the line starts on the first visible bar
    expect(Math.abs((warmed.at(-1) as number) - truth)).toBeLessThan(0.01);
    expect(Math.abs(cold - truth)).toBeGreaterThan(0.02); // the window alone is visibly off
  });
  it("keeps four decimals so a small MACD does not round to zero", () => {
    const cheap = Array.from({ length: 80 }, (_, i) => 4 + Math.sin(i / 5) * 0.02);
    const m = macdSeries(cheap);
    expect(m.macd.filter((v) => v !== null && v !== 0).length).toBeGreaterThan(30);
    expect(String(emaSeries(cheap, 9).at(-1)).split(".")[1]?.length ?? 0).toBeGreaterThan(2);
  });
  it("collects the closes that precede each timeframe's first bar", () => {
    const m1All = minutes(9, 30, 300, (i) => 100 + i * 0.01);
    const shownM1 = m1All.slice(-100);
    const m5 = resample(m1All, 5);
    const shown = { m1: shownM1, m5: m5.slice(-30), daily: [] as Bar[] };
    const w = buildWarm({ m1All, shown, m5Full: m5, m30Full: resample(m1All, 30), dailyAll: [] });
    expect(w["1m"]).toHaveLength(200);
    expect(w["1m"]!.at(-1)).toBeCloseTo(m1All[199].c, 4);
    expect(w["5m"]).toHaveLength(m5.length - 30);
    expect(w.D).toEqual([]);
    expect(closesBefore(m5, [], 600)).toEqual([]);
    // A shorter slice of the same window gets the dropped bars appended.
    const slice = shown.m5.slice(-10);
    const ws = warmForSlice(w["5m"], shown.m5, slice);
    expect(ws).toHaveLength(m5.length - 10);
    expect(ws.at(-1)).toBeCloseTo(shown.m5[19].c, 4);
  });
  it("stitches long history to fresh bars without trusting a partial first bucket", () => {
    const long = [bar(1000, 1), bar(2000, 2), bar(3000, 3), bar(4000, 4)];
    const fresh = [bar(3000, 3.5), bar(4000, 4.1), bar(5000, 5)];
    expect(stitch(long, fresh).map((b) => [b.t, b.c])).toEqual([[1000, 1], [2000, 2], [3000, 3], [4000, 4.1], [5000, 5]]);
    expect(stitch([], fresh)).toBe(fresh);
    const far = [bar(10 * 86400e3, 9), bar(10 * 86400e3 + 1000, 9.1)];
    expect(stitch(long, far)).toBe(far); // history that stops days earlier is not trusted
    expect(stitch(long, [])).toBe(long);
  });
  it("reads matrix indicators from the full series and structure from the window", () => {
    const full = Array.from({ length: 400 }, (_, i) => bar(et(9, 30) + i * 300e3, 100 + Math.sin(i / 15) * 5 + i * 0.02));
    const window = full.slice(-30);
    const cold = readRow("5m", window, null, null);
    const warm = readRow("5m", window, null, null, full);
    expect(warm.bars).toBe(30);
    expect(warm.ema).not.toBe("N/A");
    expect(warm.macd).not.toBe("N/A"); // 30 bars alone cannot produce a MACD; the history can
    expect(cold.macd).toBe("N/A");
    expect(cold.detail).not.toBe(warm.detail); // EMA values differ once history is in front
  });
  it("opens the daily window on the first session of a week", () => {
    // 2026-09-14 is a Monday.
    const days = Array.from({ length: 15 }, (_, i) => i).filter((i) => i % 7 < 5).map((i) => bar(etMidnightMs("2026-09-14") + i * 86400e3, 100 + i));
    const tail = weekAlignedTail(days, 8);
    expect(new Date(tail[0].t + 12 * 3600e3).getUTCDay()).toBe(1);
    expect(weekKey(tail[0].t)).not.toBe(weekKey(days[days.indexOf(tail[0]) - 1].t));
  });
});

describe("previous close", () => {
  const snap = { dailyBar: { t: "2026-09-28T04:00:00Z", c: 765.61 }, prevDailyBar: { c: 771.2 } };
  it("measures premarket change against the last completed session", () => {
    expect(referenceClose(snap, et(8, 0))).toBe(765.61);
  });
  it("uses the previous bar once today's bar exists", () => {
    expect(referenceClose({ dailyBar: { t: "2026-09-29T04:00:00Z", c: 764.8 }, prevDailyBar: { c: 765.61 } }, et(10, 15))).toBe(765.61);
  });
  it("shows the last session's own change overnight and on weekends", () => {
    expect(referenceClose(snap, et(2, 0))).toBe(771.2); // 02:00 ET, market closed
    expect(referenceClose(undefined, et(10, 0))).toBeNull();
  });
});

describe("real index bars", () => {
  const spyDay = (date: string, c: number): Bar => ({ t: etMidnightMs(date), o: c - 1, h: c + 1, l: c - 2, c, v: 5e7, vw: c });
  const idx = [{ date: "2026-09-25", o: 7709.86, h: 7752.07, l: 7693.08, c: 7743.41 }, { date: "2026-09-28", o: 7721.7, h: 7724.15, l: 7666.6, c: 7683.69 }];
  const spy = [spyDay("2026-09-25", 771.2), spyDay("2026-09-28", 765.61), spyDay("2026-09-29", 764.8)];
  it("fits one ratio per session", () => {
    const r = dayRatios(idx, spy);
    expect(r.get("2026-09-25")).toBeCloseTo(7743.41 / 771.2, 8);
    expect(r.get("2026-09-28")).toBeCloseTo(7683.69 / 765.61, 8);
    expect(r.has("2026-09-29")).toBe(false);
  });
  it("scales each day's minutes by that day's ratio and premarket by the prior session's", () => {
    const r = dayRatios(idx, spy);
    const bars = [bar(et(15, 59, "2026-09-25"), 771.2), bar(et(8, 0, "2026-09-28"), 770), bar(et(15, 59, "2026-09-28"), 765.61), bar(et(8, 0), 765), bar(et(10, 0), 764)];
    const out = scaleIntradayByDay(bars, r, "2026-09-29", 10.04);
    expect(out[0].c).toBeCloseTo(7743.41, 1);
    expect(out[1].c).toBeCloseTo(770 * (7743.41 / 771.2), 1);
    expect(out[2].c).toBeCloseTo(7683.69, 1);
    expect(out[3].c).toBeCloseTo(765 * (7683.69 / 765.61), 1);
    expect(out[4].c).toBeCloseTo(7670.56, 1);
  });
  it("uses the real daily bar where the index file has one", () => {
    const out = indexDailyBars(idx, spy, 10.04);
    expect([out[1].o, out[1].h, out[1].l, out[1].c]).toEqual([7721.7, 7724.15, 7666.6, 7683.69]);
    expect(out[1].v).toBe(5e7);
    expect(out[2].c).toBeCloseTo(764.8 * 10.04, 1); // today: scaled until the real close exists
  });
  it("lays real minutes over the estimate and keeps the ETF volume", () => {
    const scaled = [bar(et(9, 30), 7699, 900), bar(et(9, 31), 7690, 800)];
    const out = overlayRealMinutes(scaled, [{ t: et(9, 30), o: 7699.6, h: 7699.6, l: 7690, c: 7690.05 }]);
    expect(out[0].c).toBe(7690.05);
    expect(out[0].v).toBe(900);
    expect(out[0].vw).toBeLessThanOrEqual(out[0].h);
    expect(out[1]).toBe(scaled[1]);
  });
  it("reads CBOE minute stamps as the END of the minute", () => {
    const rows = parseCboeMinutes([{ datetime: "2026-09-29T09:31:00", price: { open: 7699.6001, high: 7699.6001, low: 7690, close: 7690.0498 } }]);
    expect(rows[0].t).toBe(et(9, 30));
    expect(rows[0].c).toBeCloseTo(7690.05, 2);
  });
  it("parses the daily history and the open-interest map", () => {
    const d = parseCboeDaily([{ date: "1975-01-02", open: "0.000000", high: "70.92", low: "68.65", close: "70.23" }, { date: "2026-09-28", open: "7721.70", high: "7724.15", low: "7666.60", close: "7683.69" }, { date: "bad", open: "1", high: "1", low: "1", close: "1" }]);
    expect(d).toHaveLength(2);
    expect(d[0].o).toBe(70.23); // a missing open falls back to the close
    expect(d[1].c).toBe(7683.69);
    const m = openInterestMap([{ option: "SPY260929C00765000", open_interest: 4437 }, { option: "SPY260929P00765000", open_interest: 6324 }]);
    expect(m.get("SPY260929C00765000")).toBe(4437);
    expect(m.size).toBe(2);
  });
});

describe("relative volume", () => {
  // Ten past sessions of 5-minute bars, 1,000 shares per bar in regular hours,
  // plus a 50,000 share closing auction print in the 16:00 bar.
  const dates = ["2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-28"];
  const history: Bar[] = dates.flatMap((d) => [
    ...Array.from({ length: 78 }, (_, i) => bar(et(9, 30, d) + i * 300e3, 100, 1000)),
    bar(et(16, 0, d), 100, 50_000),
  ]);
  const todayMinutes = (perMinute: number, count: number) => Array.from({ length: count }, (_, i) => bar(et(9, 30) + i * 60_000, 100, perMinute));
  it("reads 1.0 when today matches the same window on past sessions", () => {
    const r = sameTimeRvol(todayMinutes(200, 90), history, "2026-09-29", 570, 660, 5)!; // 9:30 to 11:00
    expect(r.sessions).toBe(10);
    expect(r.averageVolume).toBe(18_000);
    expect(r.todayVolume).toBe(18_000);
    expect(r.rvol).toBe(1);
  });
  it("is not dragged down by the closing auction the way a daily-volume comparison is", () => {
    const r = sameTimeRvol(todayMinutes(300, 90), history, "2026-09-29", 570, 660, 5)!;
    expect(r.rvol).toBe(1.5);
    const dailyBars = dates.map((d) => bar(etMidnightMs(d), 100, 78_000 + 50_000));
    expect(regularHoursShare(history, dailyBars, "2026-09-29")).toBeCloseTo(78 / 128, 6);
  });
  it("counts only the part of a history bar inside the window and ignores the unfinished minute", () => {
    const r = sameTimeRvol(todayMinutes(200, 95), history, "2026-09-29", 570, 662, 5)!; // to 11:02
    expect(r.averageVolume).toBeCloseTo(18_000 + 1000 * 0.4, 6);
    expect(r.todayVolume).toBe(92 * 200);
  });
  it("declines to answer without enough sessions or window", () => {
    expect(sameTimeRvol(todayMinutes(200, 90), history.slice(0, 79 * 3), "2026-09-29", 570, 660, 5)).toBeNull();
    expect(sameTimeRvol(todayMinutes(200, 1), history, "2026-09-29", 570, 571, 5)).toBeNull();
  });
});
