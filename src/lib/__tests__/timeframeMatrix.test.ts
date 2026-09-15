import { describe, expect, it } from "vitest";
import { alignment, buildMatrix, emaCrosses, readRow, readStructure } from "../timeframeMatrix";
import type { Bar } from "../bars";

// 2026-09-15 is a Tuesday; ET = UTC-4.
const et = (h: number, m: number) => Date.UTC(2026, 8, 15, h + 4, m);
const mk = (t: number, c: number, spread = 0.05): Bar => ({ t, o: c - 0.1, h: c + spread, l: c - spread, c, v: 1000, vw: c });
const series = (n: number, f: (i: number) => number, stepMin = 1, startH = 9, startM = 30) => Array.from({ length: n }, (_, i) => mk(et(startH, startM) + i * stepMin * 60e3, f(i)));

describe("timeframe matrix", () => {
  it("reads a clean uptrend as BULL with stacked EMAs and HH/HL or breakout", () => {
    const bars = series(80, (i) => 100 + i * 0.2 + Math.sin(i / 3) * 0.2);
    const r = readRow("5m", bars, 100, null);
    expect(r.trend).toBe("BULL");
    expect(r.ema).toBe("STACKED UP");
    expect(["HH/HL", "BREAKOUT"]).toContain(r.structure);
    expect(r.vwap).toBe("ABOVE");
  });
  it("reads a clean downtrend as BEAR", () => {
    const bars = series(80, (i) => 120 - i * 0.2 + Math.sin(i / 3) * 0.2);
    const r = readRow("15m", bars, 130, null);
    expect(r.trend).toBe("BEAR");
    expect(r.ema).toBe("STACKED DOWN");
    expect(["LH/LL", "BREAKDOWN"]).toContain(r.structure);
    expect(r.vwap).toBe("BELOW");
  });
  it("marks a whipsaw as CHOP and too few bars as N/A", () => {
    const bars = series(80, (i) => 100 + Math.sin(i * 1.3) * 0.8);
    const r = readRow("1m", bars, null, null);
    expect(["CHOP", "NEUTRAL"]).toContain(r.trend);
    expect(r.vwap).toBe("N/A");
    expect(readRow("D", series(10, (i) => 100 + i), null, null).trend).toBe("N/A");
  });
  it("counts EMA20 crosses and reads structure", () => {
    const closes = [1, 3, 1, 3, 1, 3, 1, 3];
    const ema = closes.map(() => 2);
    expect(emaCrosses(closes, ema, 8)).toBe(7);
    expect(emaCrosses(closes, ema, 4)).toBe(3);
    const up = series(40, (i) => 100 + i * 0.5);
    expect(readStructure(up).structure).toBe("BREAKOUT");
    expect(readStructure(series(5, (i) => 100 + i)).structure).toBe("N/A");
  });
  it("builds seven rows from minute and daily bars and aligns them", () => {
    const m1 = series(390, (i) => 100 + i * 0.03);
    const daily = Array.from({ length: 60 }, (_, i) => mk(Date.UTC(2026, 6, 1 + i, 20), 80 + i * 0.4, 0.1));
    const rows = buildMatrix({ m1, daily, nowMs: et(16, 0), setupStates: { "5m": "CONFIRMED" } });
    expect(rows.map((r) => r.tf)).toEqual(["1m", "2m", "5m", "15m", "30m", "1h", "D"]);
    expect(rows.find((r) => r.tf === "5m")?.setup).toBe("CONFIRMED");
    expect(rows.find((r) => r.tf === "D")?.vwap).toBe("N/A");
    const a = alignment(rows, "long");
    expect(a.lean).toBe("BULL");
    expect(a.score).toBeGreaterThanOrEqual(7);
    expect(a.conflict).toBe(false);
    const b = alignment(rows, "short");
    expect(b.against.length).toBeGreaterThan(0);
    expect(b.conflict).toBe(true);
  });
});
