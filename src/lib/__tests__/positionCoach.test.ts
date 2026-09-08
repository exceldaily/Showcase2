import { describe, expect, it } from "vitest";
import { positionRead } from "../positionCoach";
import { lockDecision } from "../setupLock";

const NOW = Date.parse("2026-09-08T14:32:00Z"); // 10:32 ET
const plan = { direction: "long" as const, trigger: 365.11, invalidation: 364.08, targets: [368.74, 376.16, 383.58], riskDollars: 1.03, rewardToTargets: [] };
const trade = { contract: "TSLA260909C00372500", side: "call" as const, strike: 372.5, expiry: "2026-09-09", entry: 1.2, qty: 1 };

describe("positionRead", () => {
  it("turns stock levels into option dollars for the held contract and says what to do before the break", () => {
    const r = positionRead({ trade, price: 363.88, mid: 1.59, iv: 0.6, plan, state: "APPROACHING", direction: "long", now: NOW });
    expect(r.pnlDollars).toBeCloseTo(39, 0);
    expect(r.pnlPct).toBeCloseTo(32.5, 0);
    expect(r.breakEven).toBeCloseTo(373.7, 2);
    expect(r.atTarget1!.value).toBeGreaterThan(1.59);
    expect(r.atTarget1Expiry!.value).toBe(0); // 368.74 < 372.5 at expiry
    expect(r.thetaPerHour).toBeGreaterThan(0);
    expect(r.headline).toMatch(/1x 372.5C: \+\$39/);
    expect(r.steps[0]).toMatch(/Hold only if a 5-minute candle closes above \$365\.11/);
    expect(r.steps.join(" ")).toMatch(/sell-into-the-move contract, not a hold/);
  });
  it("tells a confirmed holder where to take profit, and a failed holder to sell", () => {
    const ok = positionRead({ trade, price: 366, mid: 2.2, iv: 0.6, plan, state: "CONFIRMED", direction: "long", now: NOW });
    expect(ok.steps[0]).toMatch(/Sell it at \$368\.74/); // one contract cannot be split
    const two = positionRead({ trade: { ...trade, qty: 2 }, price: 366, mid: 2.2, iv: 0.6, plan, state: "CONFIRMED", direction: "long", now: NOW });
    expect(two.steps[0]).toMatch(/Sell 1 of 2 at \$368\.74/);
    const bad = positionRead({ trade, price: 363, mid: 1.1, iv: 0.6, plan, state: "FAILED", direction: "long", now: NOW });
    expect(bad.steps[0]).toMatch(/failed\. Sell\./);
  });
  it("warns when the contract fights the chart", () => {
    const r = positionRead({ trade, price: 363.88, mid: 1.59, iv: 0.6, plan: { ...plan, direction: "short" }, state: "WATCHING", direction: "short", now: NOW });
    expect(r.headline).toMatch(/leans the other way/);
    expect(r.steps[0]).toMatch(/fighting the current read/);
  });
});

describe("lockDecision", () => {
  it("keeps a lock through a live trade, releases on failure or a pre-break trend flip", () => {
    expect(lockDecision({ direction: "long" }, "APPROACHING", "long").keep).toBe(true);
    expect(lockDecision({ direction: "long" }, "CONFIRMED", "short").keep).toBe(true); // never flip mid-trade
    expect(lockDecision({ direction: "long" }, "FAILED", "long")).toEqual({ keep: false, reason: "failed" });
    expect(lockDecision({ direction: "long" }, "WATCHING", "short").keep).toBe(false);
    expect(lockDecision({ direction: "long" }, null, "long").keep).toBe(true);
  });
});
