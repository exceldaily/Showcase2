import { describe, expect, it } from "vitest";
import { confluence, type ConfluenceInput } from "../decision/confluence";
import type { MatrixRow } from "../timeframeMatrix";

const row = (tf: MatrixRow["tf"], trend: MatrixRow["trend"], momentum: MatrixRow["momentum"] = "BULL"): MatrixRow => ({
  tf, bars: 80, trend, momentum, vwap: "ABOVE", vwapPct: 0.3, ema: "STACKED UP", macd: "POS", structure: "HH/HL", support: 99, resistance: 102, setup: null, detail: "",
});

const base: ConfluenceInput = {
  direction: "long", trendLabel: "Bullish", trendConfidence: 80, choppy: false,
  rows: [row("1m", "BULL"), row("5m", "BULL"), row("15m", "BULL"), row("D", "BULL")],
  align: { score: 9, lean: "BULL", agree: ["1m", "5m", "15m", "D"], against: [], conflict: false },
  rvol: 1.6, price: 101, vwap: 100, triggerStrength: 85,
  room: { dollars: 2, pct: 2, atrMultiple: 2.5, nextLevel: 103, grade: "GOOD", note: "" },
  machineQuality: 0, machineState: "APPROACHING", catalyst: { ageHours: 3, tier: 1 }, catalystMeasured: true,
  contract: { score: 78, spreadPct: 3, volume: 1200, openInterest: 5000 }, maxSpreadPct: 4,
};

describe("confluence", () => {
  it("scores a strong aligned setup high with eight measured parts", () => {
    const c = confluence(base);
    expect(c.parts).toHaveLength(8);
    expect(c.max).toBe(100);
    expect(c.pct).toBeGreaterThanOrEqual(80);
    expect(c.parts.find((p) => p.key === "trend")?.score).toBe(16);
    expect(c.parts.find((p) => p.key === "momentum")?.score).toBe(15);
    expect(c.parts.find((p) => p.key === "volume")?.score).toBe(12);
    expect(c.parts.find((p) => p.key === "vwap")?.score).toBe(10);
    expect(c.parts.find((p) => p.key === "catalyst")?.score).toBe(10);
    expect(c.notMeasured).toEqual([]);
  });
  it("excludes unmeasured parts from the denominator instead of scoring them zero", () => {
    const c = confluence({ ...base, catalystMeasured: false, catalyst: null, rvol: null });
    expect(c.notMeasured).toEqual(["Volume", "Catalyst"]);
    expect(c.max).toBe(75);
    expect(c.pct).toBe(Math.round((c.total / 75) * 100));
  });
  it("penalizes against-trend, wide spreads and conflicts", () => {
    const c = confluence({
      ...base, trendLabel: "Bearish", choppy: false, rvol: 0.6,
      rows: [row("5m", "BEAR", "BEAR"), row("D", "BEAR", "BEAR")],
      align: { score: 2, lean: "BEAR", agree: [], against: ["5m", "D"], conflict: true },
      contract: { score: 90, spreadPct: 12, volume: 10, openInterest: 20 },
    });
    expect(c.parts.find((p) => p.key === "trend")?.score).toBe(0);
    expect(c.parts.find((p) => p.key === "momentum")?.score).toBe(2);
    expect(c.parts.find((p) => p.key === "volume")?.score).toBe(1);
    expect(c.parts.find((p) => p.key === "mtf")?.score).toBeLessThanOrEqual(5);
    expect(c.parts.find((p) => p.key === "options")?.score).toBe(4);
    expect(c.pct).toBeLessThan(40);
  });
  it("caps a choppy trend at 4 and documents every rule", () => {
    const c = confluence({ ...base, choppy: true, trendConfidence: 100 });
    expect(c.parts.find((p) => p.key === "trend")?.score).toBe(4);
    for (const p of c.parts) expect(p.rule.length).toBeGreaterThan(20);
  });
});
