import { describe, expect, it } from "vitest";
import { computeMetricsFromBars } from "../polygon";
import { buildPlan, detectLongSetup, detectShortSetup, swingHighs, swingLows } from "../setups";
import type { Bar } from "../bars";

function bars(closes: number[], volume = 2_000_000): Bar[] {
  return closes.map((c, i) => ({ o: c * 0.995, h: c * 1.01, l: c * 0.99, c, v: volume, vw: c, t: i }));
}

// Uptrend, tight base, then a volume breakout above the base high.
function breakoutSeries(): Bar[] {
  const trend = Array.from({ length: 60 }, (_, i) => 100 + i * 0.8);
  const base = Array.from({ length: 20 }, () => 148 + Math.sin(0) * 0); // flat base at 148
  const arr = bars([...trend, ...base]);
  const breakout = 152; // above base highs (~149.5)
  arr.push({ o: 149, h: breakout * 1.005, l: 148.5, c: breakout, v: 6_000_000, vw: 151, t: 999 });
  return arr;
}

// Downtrend, flat shelf, then a volume breakdown below support.
function breakdownSeries(): Bar[] {
  const trend = Array.from({ length: 60 }, (_, i) => 200 - i * 1.0);
  const shelf = Array.from({ length: 20 }, () => 141);
  const arr = bars([...trend, ...shelf]);
  arr.push({ o: 140.5, h: 141, l: 136.5, c: 137, v: 6_000_000, vw: 138, t: 999 });
  return arr;
}

describe("swing structure", () => {
  it("finds swing highs and lows in an oscillating series", () => {
    const zigzag = bars([100, 105, 100, 106, 100, 107, 100, 108, 100]);
    expect(swingHighs(zigzag).length).toBeGreaterThan(1);
    expect(swingLows(zigzag).length).toBeGreaterThan(1);
  });
});

describe("long detection", () => {
  it("detects a volume breakout above a tight base", () => {
    const series = breakoutSeries();
    const m = computeMetricsFromBars("T", series);
    const det = detectLongSetup(m, series, false);
    expect(det?.type).toBe("Breakout");
    expect(det?.direction).toBe("Long");
  });
  it("stays silent on a quiet drifting series", () => {
    const series = bars(Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5)));
    const m = computeMetricsFromBars("T", series);
    expect(detectLongSetup(m, series, false)).toBeNull();
  });
});

describe("short detection", () => {
  it("detects a support breakdown in a downtrend", () => {
    const series = breakdownSeries();
    const m = computeMetricsFromBars("T", series);
    const det = detectShortSetup(m, series);
    expect(det?.type).toBe("Support Breakdown");
    expect(det?.direction).toBe("Short");
  });
});

describe("plans", () => {
  it("long plan: stop below entry, ordered rising targets, documented methods", () => {
    const series = breakoutSeries();
    const m = computeMetricsFromBars("T", series);
    const det = detectLongSetup(m, series, false)!;
    const plan = buildPlan(m, series, det)!;
    expect(plan.stopLoss).toBeLessThan(plan.entryConservative);
    expect(plan.targets[0].price).toBeLessThan(plan.targets[1].price);
    expect(plan.targets[1].price).toBeLessThan(plan.targets[2].price);
    for (const t of plan.targets) {
      expect(t.method.length).toBeGreaterThan(0);
      expect(t.evidence.length).toBeGreaterThan(0);
    }
  });

  it("short plan: stop above entry, falling targets, positive R/R", () => {
    const series = breakdownSeries();
    const m = computeMetricsFromBars("T", series);
    const det = detectShortSetup(m, series)!;
    const plan = buildPlan(m, series, det)!;
    expect(plan.stopLoss).toBeGreaterThan(plan.entryConservative);
    expect(plan.targets[0].price).toBeGreaterThan(plan.targets[1].price);
    expect(plan.targets[1].price).toBeGreaterThan(plan.targets[2].price);
    expect(plan.riskReward).toBeGreaterThan(0);
  });
});
