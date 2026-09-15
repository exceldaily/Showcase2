import { describe, expect, it } from "vitest";
import { plannedEntry } from "../planEntry";
import type { TradePlan } from "../setupMachine";

const plan: TradePlan = { direction: "long", trigger: 105, invalidation: 104, targets: [107, 109, 111], riskDollars: 1, rewardToTargets: [] };
const c = { side: "call" as const, strike: 105, expiry: new Date(Date.now() + 5 * 86400e3).toISOString().slice(0, 10), iv: 0.5, mid: 1.2 };

describe("planned entry", () => {
  it("prices the entry at the trigger before a break and at the mid after", () => {
    const pre = plannedEntry(c, plan, 103, "WATCHING");
    expect(pre?.estimated).toBe(true);
    expect(pre?.underlying).toBe(105);
    expect(pre!.premium).toBeGreaterThan(1.2);
    const post = plannedEntry(c, plan, 105.5, "CONFIRMED");
    expect(post).toEqual({ underlying: 105.5, premium: 1.2, estimated: false });
    expect(plannedEntry(c, null, 103, "WATCHING")?.estimated).toBe(false);
    expect(plannedEntry(c, plan, null, "WATCHING")).toBeNull();
  });
});
