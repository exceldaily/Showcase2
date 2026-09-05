import { describe, expect, it } from "vitest";
import { plainSummary, STATE_EXPLAIN } from "../plainEnglish";
import { activityScore, SP100, MEGACAPS } from "../optionsScan";

const plan = {
  direction: "long" as const, trigger: 230, invalidation: 228.5, targets: [232, 234, 236],
  riskDollars: 1.5, rewardToTargets: [{ target: 232, reward: 2, rr: 1.33 }],
};

describe("plainSummary", () => {
  it("narrates trend, level, distance, targets, invalidation and status in plain words", () => {
    const lines = plainSummary({
      symbol: "NVDA", price: 229.5,
      trend: { label: "Bullish", confidence: 80, signals: [] },
      direction: "long", state: "APPROACHING", plan,
      room: { dollars: 2, pct: 0.9, atrMultiple: 2.1, nextLevel: 232, grade: "GOOD", note: "" },
      rvol: 1.6, marketOpen: true,
    });
    const text = lines.join(" ");
    expect(text).toMatch(/clearly bullish/);
    expect(text).toMatch(/\$230\.00 resistance/);
    expect(text).toMatch(/\$0\.50/);            // distance to trigger
    expect(text).toMatch(/\$232\.00, then \$234\.00, then \$236\.00/);
    expect(text).toMatch(/wrong if price closes below \$228\.50/);
    expect(text).toMatch(/APPROACHING/);
    expect(text).toMatch(/real room/);
    expect(text).not.toMatch(/will go up|guaranteed/);
  });

  it("flips wording for the short side and warns on poor room and closed market", () => {
    const lines = plainSummary({
      symbol: "MU", price: 1000,
      trend: { label: "Bearish", confidence: 50, signals: [] },
      direction: "short", state: "WATCHING",
      plan: { ...plan, direction: "short", trigger: 995, invalidation: 1001, targets: [990, 985, 980] },
      room: { dollars: 0.3, pct: 0.03, atrMultiple: 0.2, nextLevel: 994.7, grade: "POOR", note: "" },
      rvol: 0.5, marketOpen: false,
    });
    const text = lines.join(" ");
    expect(text).toMatch(/support/);
    expect(text).toMatch(/breakdown for puts/);
    expect(text).toMatch(/Light volume/);
    expect(text).toMatch(/Warning: a major level/);
    expect(text).toMatch(/market is closed/);
  });

  it("every setup state has a plain explanation", () => {
    for (const v of Object.values(STATE_EXPLAIN)) expect(v.length).toBeGreaterThan(20);
  });
});

describe("options scan ranking", () => {
  it("ranks bigger moves on heavier participation first", () => {
    expect(activityScore(3, 2)).toBeGreaterThan(activityScore(3, 0.8));
    expect(activityScore(-4, 1)).toBeGreaterThan(activityScore(1, 1)); // direction-agnostic
    expect(activityScore(null, null)).toBe(0);
  });
  it("universes are clean symbol lists", () => {
    for (const s of [...SP100, ...MEGACAPS]) expect(s).toMatch(/^[A-Z.]{1,6}$/);
    expect(new Set(SP100).size).toBe(SP100.length);
  });
});
