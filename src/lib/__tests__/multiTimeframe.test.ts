import { describe, expect, it } from "vitest";
import type { Bar } from "../bars";
import { alignmentSummary, buildTimeframeSetups, resampleWeekly, structureZones, SETUP_TFS } from "../multiTimeframe";

function session(dateUtc: string, shape: (i: number) => number, vol = 20_000): Bar[] {
  const start = Date.parse(`${dateUtc}T13:30:00Z`);
  return Array.from({ length: 390 }, (_, i) => {
    const c = shape(i);
    return { t: start + i * 60e3, o: c - 0.02, h: c + 0.06, l: c - 0.06, c, v: vol, vw: c };
  });
}

describe("weekly resample", () => {
  it("buckets daily bars by ISO week and aggregates OHLCV", () => {
    // Mon Aug 31 .. Fri Sep 11 2026 = two ISO weeks
    const days: Bar[] = [];
    const dates = ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"];
    dates.forEach((d, i) => days.push({ t: Date.parse(`${d}T20:00:00Z`), o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 1e6, vw: 100 + i }));
    const w = resampleWeekly(days);
    expect(w.length).toBe(2);
    expect(w[0].o).toBe(100);
    expect(w[0].h).toBe(105);
    expect(w[0].l).toBe(99);
    expect(w[0].c).toBe(104.5);
    expect(w[0].v).toBe(5e6);
  });
});

describe("structure zones", () => {
  it("labels swing levels support/resistance relative to price with touch-based strength", () => {
    const bars: Bar[] = Array.from({ length: 120 }, (_, i) => {
      const c = 100 + Math.sin(i / 6) * 3;
      return { t: Date.UTC(2026, 0, 1) + i * 86400e3, o: c, h: c + 0.5, l: c - 0.5, c, v: 1e6, vw: c };
    });
    const zones = structureZones(bars, 100, 120);
    expect(zones.length).toBeGreaterThan(0);
    for (const z of zones) {
      expect(z.kind).toBe(z.price >= 100 ? "resistance" : "support");
      expect(z.strength).toBeGreaterThanOrEqual(45);
      expect(z.reasons[0]).toMatch(/touches/);
    }
  });
});

describe("timeframe setups", () => {
  it("returns one entry per timeframe, each self-contained and honest about missing bars", () => {
    const minute: Bar[] = [];
    for (let d = 1; d <= 6; d++) minute.push(...session(`2026-09-0${d}`, (i) => 100 + d * 0.5 + Math.sin(i / 20) * 0.4));
    const daily: Bar[] = Array.from({ length: 300 }, (_, i) => {
      const c = 90 + i * 0.05 + Math.sin(i / 9) * 2;
      return { t: Date.UTC(2025, 8, 1) + i * 86400e3, o: c, h: c + 1, l: c - 1, c, v: 5e6, vw: c };
    });
    const price = minute[minute.length - 1].c;
    const setups = buildTimeframeSetups({
      symbol: "TEST", minuteBars: minute, dailyBars: daily,
      intradayZones: [{ price: price + 1, low: price + 0.9, high: price + 1.1, kind: "resistance", strength: 80, touches: 3, timeframes: ["5m"], sources: ["swing-high"], reasons: ["t"] },
        { price: price - 1, low: price - 1.1, high: price - 0.9, kind: "support", strength: 75, touches: 2, timeframes: ["5m"], sources: ["swing-low"], reasons: ["t"] }],
      price, rvolIntraday: 1.2, nowMs: minute[minute.length - 1].t,
    });
    expect(setups.map((s) => s.tf)).toEqual(SETUP_TFS);
    for (const s of setups) {
      expect(typeof s.bars).toBe("number");
      if (s.plan) {
        expect(s.trigger).not.toBeNull();
        expect(s.plan.targets.length).toBe(3);
        expect(s.state).not.toBeNull();
      } else {
        expect(s.note).not.toBeNull(); // says why, never silent
      }
    }
    const line = alignmentSummary(setups, "long");
    expect(line).toMatch(/Timeframes agreeing/);
  });

  it("weekly frame with too little history says so instead of guessing", () => {
    const daily: Bar[] = Array.from({ length: 40 }, (_, i) => ({ t: Date.UTC(2026, 6, 1) + i * 86400e3, o: 100, h: 101, l: 99, c: 100, v: 1e6, vw: 100 }));
    const setups = buildTimeframeSetups({ symbol: "T", minuteBars: [], dailyBars: daily, intradayZones: [], price: 100, rvolIntraday: null, nowMs: Date.UTC(2026, 7, 10) });
    const w = setups.find((s) => s.tf === "W")!;
    expect(w.plan).toBeNull();
    expect(w.note).toMatch(/not enough bars/);
  });
});
