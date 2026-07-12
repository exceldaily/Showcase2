import { describe, expect, it } from "vitest";
import {
  computeAlphaForgeScore,
  computeAlphaForgeScoreV1,
  computeConfidence,
  computePositionSizing,
  computeRiskReward,
  computeSmartMoneyScore,
  deriveDecision,
  MIN_RISK_REWARD,
} from "../scoring";

describe("computeRiskReward", () => {
  it("computes reward/risk from entry, stop and T2", () => {
    // risk = 100 - 95 = 5; reward = 116 - 100 = 16 => 3.2
    expect(computeRiskReward({ entryConservative: 100, stopLoss: 95, target2: 116 })).toBe(3.2);
  });
  it("returns 0 when the stop is at or above entry (invalid structure)", () => {
    expect(computeRiskReward({ entryConservative: 100, stopLoss: 100, target2: 120 })).toBe(0);
    expect(computeRiskReward({ entryConservative: 100, stopLoss: 105, target2: 120 })).toBe(0);
  });
});

describe("position sizing", () => {
  it("derives shares and dollar risk from the $100 example", () => {
    const s = computePositionSizing(100, 20, 18, 26.4);
    expect(s.shares).toBe(5); // floor(100/20)
    expect(s.dollarRisk).toBe(10); // (20-18) * 5
    expect(s.expectedGain).toBe(32); // (26.4-20) * 5
  });
});

describe("weighted scores", () => {
  it("full model matches the documented pillar weights", () => {
    const score = computeAlphaForgeScore({
      catalyst: 100,
      smartMoney: 0,
      technical: 0,
      sectorStrength: 0,
      marketRegime: 0,
    });
    expect(score).toBe(30); // catalyst is 30%
  });
  it("v1 model weights technical at 40%", () => {
    const score = computeAlphaForgeScoreV1({
      technical: 100,
      sectorStrength: 0,
      momentum: 0,
      marketRegime: 0,
    });
    expect(score).toBe(40);
  });
  it("confidence drops when pillars disagree", () => {
    const agree = computeConfidence({
      catalyst: 80, smartMoney: 80, technical: 80, sectorStrength: 80, marketRegime: 80,
    });
    const disagree = computeConfidence({
      catalyst: 100, smartMoney: 20, technical: 90, sectorStrength: 30, marketRegime: 80,
    });
    expect(agree).toBeGreaterThan(disagree);
  });
});

describe("smart money score", () => {
  it("sums sub-components and clamps to 100", () => {
    const s = computeSmartMoneyScore({
      institutionalAccumulation: 25,
      revenueGrowth: 20,
      earningsGrowth: 15,
      relativeVolume: 15,
      insiderBuying: 10,
      newsCatalyst: 10,
      sectorStrength: 5,
    });
    expect(s.total).toBe(100);
  });
});

describe("decision gate", () => {
  const plan = {
    entryZoneLow: 99, entryZoneHigh: 101, entryAggressive: 101, entryConservative: 100,
    stopLoss: 95, stopBasis: "test", target1: 110, target2: 116, target3: 125,
    expectedPctMove: 16, expectedHoldDays: 10, riskReward: 3.2,
  };
  it("rejects anything below the minimum R/R", () => {
    expect(MIN_RISK_REWARD).toBe(3);
    expect(deriveDecision(90, { ...plan, riskReward: 2.9 }, 100)).toBe("Avoid");
  });
  it("keeps sub-80 scores off the buy list", () => {
    expect(deriveDecision(79, plan, 100)).toBe("Watchlist Only");
  });
  it("buys only inside the entry zone", () => {
    expect(deriveDecision(85, plan, 100)).toBe("Buy Now");
    expect(deriveDecision(85, plan, 95)).toBe("Wait For Pullback");
  });
});
