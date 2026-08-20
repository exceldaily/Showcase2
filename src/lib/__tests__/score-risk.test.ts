import { describe, expect, it } from "vitest";
import { scoreSetup } from "../setupScore";
import { calculateRisk } from "../risk";
import { computeMetricsFromBars } from "../polygon";
import type { Bar } from "../bars";

function bars(closes: number[], vol = 2_000_000): Bar[] {
  return closes.map((c, i) => ({ o: c * 0.998, h: c * 1.01, l: c * 0.99, c, v: vol, vw: c, t: i * 86400000 }));
}
const strongTrend = bars(Array.from({ length: 120 }, (_, i) => 50 + i * 0.6));

describe("setup score transparency", () => {
  const caps = { intraday: false, floatData: false, news: false };

  it("every point is attributable to a named component within its max", () => {
    const m = computeMetricsFromBars("T", strongTrend);
    const s = scoreSetup({ metrics: m, bars: strongTrend, caps });
    expect(s.components.length).toBeGreaterThan(3);
    for (const c of s.components) {
      expect(c.points).toBeLessThanOrEqual(c.max);
      expect(c.points).toBeGreaterThanOrEqual(0);
      expect(c.evidence.length).toBeGreaterThan(0);
      expect(c.reason.length).toBeGreaterThan(0);
    }
  });

  it("scores 0-100 and assigns a grade", () => {
    const m = computeMetricsFromBars("T", strongTrend);
    const s = scoreSetup({ metrics: m, bars: strongTrend, caps });
    expect(s.total).toBeGreaterThanOrEqual(0);
    expect(s.total).toBeLessThanOrEqual(100);
    expect(["A", "B", "C", "D"]).toContain(s.grade);
  });

  it("rates an aligned uptrend above a broken downtrend", () => {
    const down = bars(Array.from({ length: 120 }, (_, i) => 120 - i * 0.5));
    const up = scoreSetup({ metrics: computeMetricsFromBars("U", strongTrend), bars: strongTrend, caps });
    const dn = scoreSetup({ metrics: computeMetricsFromBars("D", down), bars: down, caps });
    expect(up.total).toBeGreaterThan(dn.total);
  });

  it("reports unmeasurable inputs instead of silently scoring them zero", () => {
    const s = scoreSetup({ metrics: computeMetricsFromBars("T", strongTrend), bars: strongTrend, caps });
    expect(s.notMeasured.join(" ")).toMatch(/intraday|float|catalyst/i);
    expect(s.components.find((c) => c.key === "float")).toBeUndefined();
  });

  it("includes float and catalyst when the feed supports them", () => {
    const s = scoreSetup({
      metrics: computeMetricsFromBars("T", strongTrend),
      bars: strongTrend,
      caps: { intraday: true, floatData: true, news: true },
      floatShares: 8_000_000,
      catalystFound: true,
    });
    expect(s.components.find((c) => c.key === "float")).toBeDefined();
    expect(s.components.find((c) => c.key === "catalyst")).toBeDefined();
  });

  it("penalizes a parabolic move and shows it separately", () => {
    const spiky = bars([...Array.from({ length: 60 }, () => 100), 115, 135, 160, 195, 240]);
    const s = scoreSetup({ metrics: computeMetricsFromBars("P", spiky), bars: spiky, caps });
    expect(s.penalties.length).toBeGreaterThan(0);
    expect(s.penalties[0].points).toBeLessThan(0);
  });

  it("produces a WHY narrative", () => {
    const s = scoreSetup({ metrics: computeMetricsFromBars("T", strongTrend), bars: strongTrend, caps });
    expect(s.why.length).toBeGreaterThan(2);
    expect(s.why[0]).toMatch(/\w+:/);
  });
});

describe("risk calculator", () => {
  it("computes the documented example: $3.20 entry, $3.05 stop, $150 budget", () => {
    const r = calculateRisk({ accountSize: 30000, maxRiskDollars: 150, entry: 3.2, stop: 3.05 });
    expect(r.valid).toBe(true);
    expect(r.riskPerShare).toBe(0.15);
    expect(r.shares).toBe(1000);
    expect(r.maxLoss).toBe(150);
  });

  it("derives the budget from a risk percentage", () => {
    const r = calculateRisk({ accountSize: 25000, maxRiskPct: 0.5, entry: 10, stop: 9.5 });
    expect(r.riskBudget).toBe(125); // 0.5% of 25k
    expect(r.shares).toBe(250);
  });

  it("takes the smaller of dollar cap and percentage cap", () => {
    const r = calculateRisk({ accountSize: 10000, maxRiskDollars: 500, maxRiskPct: 0.25, entry: 20, stop: 19 });
    expect(r.riskBudget).toBe(25); // 0.25% of 10k beats the $500 cap
  });

  it("caps position size so one idea cannot dominate the account", () => {
    const r = calculateRisk({ accountSize: 10000, maxRiskDollars: 200, entry: 50, stop: 49.9, maxPositionPct: 25 });
    expect(r.positionValue).toBeLessThanOrEqual(2500);
    expect(r.warnings.join(" ")).toMatch(/max position cap/i);
  });

  it("computes reward-to-risk when a target is supplied", () => {
    const r = calculateRisk({ accountSize: 50000, maxRiskDollars: 300, entry: 100, stop: 97, target: 109 });
    expect(r.riskReward).toBe(3);
    expect(r.potentialGain).toBe(r.shares * 9);
  });

  it("detects short direction from stop placement", () => {
    expect(calculateRisk({ accountSize: 20000, maxRiskDollars: 200, entry: 50, stop: 52 }).direction).toBe("Short");
  });

  it("rejects invalid inputs instead of returning nonsense", () => {
    expect(calculateRisk({ accountSize: 10000, maxRiskDollars: 100, entry: 10, stop: 10 }).error).toBeTruthy();
    expect(calculateRisk({ accountSize: 0, maxRiskDollars: 100, entry: 10, stop: 9 }).error).toBeTruthy();
    expect(calculateRisk({ accountSize: 10000, maxRiskDollars: 1, entry: 100, stop: 90 }).error).toMatch(/single share/i);
  });

  it("warns on stops inside daily noise and on weak R/R", () => {
    const tight = calculateRisk({ accountSize: 50000, maxRiskDollars: 250, entry: 100, stop: 99.5 });
    expect(tight.warnings.join(" ")).toMatch(/noise/i);
    const weak = calculateRisk({ accountSize: 50000, maxRiskDollars: 250, entry: 100, stop: 95, target: 103 });
    expect(weak.warnings.join(" ")).toMatch(/reward-to-risk/i);
  });
});
