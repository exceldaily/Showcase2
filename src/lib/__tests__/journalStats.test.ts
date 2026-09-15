import { describe, expect, it } from "vitest";
import { journalStats, rMultiple, skippedOutcome } from "../journal/stats";
import type { TradeRecord } from "../journal/types";

const mk = (over: Partial<TradeRecord>): TradeRecord => ({
  id: Math.random().toString(36).slice(2), status: "closed", symbol: "NVDA", direction: "long", side: "call", contract: "X", strike: 210, expiry: "2026-09-15",
  entryPremium: 2, qty: 1, entryAt: "2026-09-15T14:05:00Z", exitPremium: 3, exitAt: "2026-09-15T15:00:00Z", pnl: 100, riskDollars: 100, mae: null, mfe: null,
  setup: "5M BREAKOUT", lifecycle: "CONFIRMED", marketState: "BULLISH", confidence: 72, trigger: 209, invalidation: 208, targets: [211, 213, 215], snapshot: null,
  strikeTag: "BEST", aligned: true, skippedReason: null, outcome: null, reviewTags: ["FOLLOWED PLAN"], notes: null, ...over,
});

describe("journal stats", () => {
  it("computes win rate, R, profit factor and the buckets", () => {
    const trades = [
      mk({ pnl: 100 }), mk({ pnl: 200, symbol: "TSLA", setup: "5M BREAKDOWN", direction: "short", side: "put" }),
      mk({ pnl: -150, reviewTags: ["IGNORED STOP"], confidence: 40, aligned: false, strikeTag: "AGGRESSIVE", entryAt: "2026-09-16T18:30:00Z", expiry: "2026-09-18" }),
      mk({ pnl: -50, symbol: "TSLA", marketState: "CHOP" }),
      mk({ status: "open", pnl: null }),
      mk({ status: "skipped", pnl: null, outcome: "WORKED", skippedReason: "Gut feeling" }),
      mk({ status: "skipped", pnl: null, outcome: "FAILED" }),
      mk({ status: "skipped", pnl: null, outcome: "UNRESOLVED" }),
    ];
    const s = journalStats(trades);
    expect(s.closed).toBe(4);
    expect(s.open).toBe(1);
    expect(s.skipped).toBe(3);
    expect(s.winRate).toBe(50);
    expect(s.totalPnl).toBe(100);
    expect(s.profitFactor).toBe(1.5);
    expect(s.avgWinner).toBe(150);
    expect(s.avgLoser).toBe(-100);
    expect(s.avgR).toBe(0.25);
    expect(s.bestTicker?.key).toBe("TSLA");
    expect(s.worstTicker?.key).toBe("NVDA");
    expect(s.byExpiry.map((b) => b.key).sort()).toEqual(["0DTE", "later expiry"]);
    expect(s.byAlignment.find((b) => b.key === "conflict")?.pnl).toBe(-150);
    expect(s.byConfidence.find((b) => b.key === "<50%")?.trades).toBe(1);
    expect(s.behaviour.find((b) => b.tag === "IGNORED STOP")?.pnl).toBe(-150);
    expect(s.skippedOutcomes).toEqual({ worked: 1, failed: 1, unresolved: 1, wouldHaveWorkedRate: 50 });
    expect(s.byHour.length).toBeGreaterThan(0);
  });
  it("handles an empty journal and missing risk", () => {
    const s = journalStats([]);
    expect(s.winRate).toBeNull();
    expect(s.profitFactor).toBeNull();
    expect(rMultiple(mk({ pnl: 50, riskDollars: null, entryPremium: 1, qty: 2 }))).toBe(0.25);
    expect(rMultiple(mk({ pnl: null }))).toBeNull();
  });
  it("resolves skipped outcomes from the bars after the skip", () => {
    const base = { direction: "long" as const, trigger: 100, invalidation: 99, targets: [102, 103, 104], entryAt: "2026-09-15T14:00:00Z" };
    const t0 = Date.parse(base.entryAt);
    expect(skippedOutcome(base, [{ t: t0 - 60e3, h: 105, l: 95 }, { t: t0 + 60e3, h: 101, l: 100 }, { t: t0 + 120e3, h: 102.5, l: 101 }])).toBe("WORKED");
    expect(skippedOutcome(base, [{ t: t0 + 60e3, h: 101, l: 98.5 }])).toBe("FAILED");
    expect(skippedOutcome(base, [{ t: t0 + 60e3, h: 101, l: 100 }])).toBe("UNRESOLVED");
    expect(skippedOutcome({ ...base, targets: null }, [])).toBe("UNRESOLVED");
  });
});
