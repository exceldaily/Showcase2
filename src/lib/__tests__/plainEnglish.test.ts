import { describe, expect, it } from "vitest";
import { actionLine, plainSummary, STATE_EXPLAIN } from "../plainEnglish";
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
    expect(text).toMatch(/wrong if price closes back below \$228\.50/);
    expect(text).toMatch(/Until the break, that line means nothing/); // APPROACHING = not in a trade yet
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

describe("actionLine", () => {
  it("tells a call buyer what to do in each state, without promising outcomes", () => {
    expect(actionLine("WATCHING", "long", 230, 232)).toMatch(/Wait\. Nothing to buy yet/);
    expect(actionLine("CONFIRMED", "long", 230, 232)).toMatch(/Calls are on the table; first target \$232\.00/);
    expect(actionLine("FAILED", "long", 230, 232)).toMatch(/Stand down/);
    expect(actionLine("RETESTING", "short", 225, 221)).toMatch(/If it holds here/);
    expect(actionLine("CONFIRMED", "short", 225, 221)).toMatch(/Puts are on the table/);
    for (const s of ["WATCHING", "APPROACHING", "FORMING", "TRIGGERED", "CONFIRMING", "CONFIRMED", "RETESTING", "CONTINUATION", "FAILED", "INVALIDATED"] as const) {
      expect(actionLine(s, "long", 100, 101)).not.toMatch(/will go up|guaranteed|profit is/);
    }
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

describe("choppy reads", () => {
  it("says no clear trend instead of a weak bullish/bearish call, and never doubles the grade word", () => {
    const base = {
      symbol: "NOW", price: 138.28, direction: "long" as const, state: "FAILED" as const, plan: null, room: null, rvol: 0.21, marketOpen: false,
    };
    const weak = plainSummary({ ...base, trend: { label: "Slightly Bullish", confidence: 20, signals: [] }, choppy: true, trendFlips: 3 });
    expect(weak[0]).toMatch(/no clear trend/);
    expect(weak[0]).toMatch(/flipped between bullish and bearish 3 times/);
    expect(weak.join(" ")).not.toMatch(/slightly slightly/);
    const graded = plainSummary({ ...base, trend: { label: "Slightly Bullish", confidence: 32, signals: [] }, choppy: false });
    expect(graded[0]).toBe("NOW is slightly bullish on the 5-minute chart (confidence 32/100).");
  });
});
