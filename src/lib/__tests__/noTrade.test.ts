import { describe, expect, it } from "vitest";
import { hasHard, noTradeRules, type NoTradeInput } from "../decision/noTrade";
import type { TradePlan } from "../setupMachine";

const plan: TradePlan = {
  direction: "long", trigger: 100, invalidation: 99.2, targets: [101.8, 103, 104.5], riskDollars: 0.8,
  rewardToTargets: [{ target: 101.8, reward: 1.8, rr: 2.25 }, { target: 103, reward: 3, rr: 3.75 }, { target: 104.5, reward: 4.5, rr: 5.6 }],
};
const ok: NoTradeInput = {
  plan, price: 99.9, rvol: 1.4, choppy: false, align: { score: 8, lean: "BULL", agree: ["5m", "15m"], against: [], conflict: false },
  room: { dollars: 1.8, pct: 1.8, atrMultiple: 2, nextLevel: 101.8, grade: "GOOD", note: "" },
  contract: { score: 72, spreadPct: 3, volume: 800, openInterest: 3000, iv: 0.5 }, maxSpreadPct: 4,
  minutesToEvent: null, eventBufferMinutes: 15, riskLimitBreached: null, marketOpen: true,
};

describe("no-trade rules", () => {
  it("passes a clean setup", () => {
    expect(noTradeRules(ok)).toEqual([]);
  });
  it("hard rules: closed market, no level, wide spread, thin chain, weak contract, risk limit", () => {
    const r = noTradeRules({ ...ok, marketOpen: false, plan: null, contract: null, riskLimitBreached: "Position exceeds 1% max risk" });
    expect(r.map((x) => x.key)).toEqual(["closed", "no-level", "risk"]);
    expect(hasHard(r)).toBe(true);
    const c = noTradeRules({ ...ok, contract: { score: 40, spreadPct: 9, volume: 10, openInterest: 10, iv: 2.5 } });
    expect(c.map((x) => x.key)).toEqual(["spread", "liquidity", "chain-quality", "iv"]);
  });
  it("soft rules: poor R/R, between levels, light volume, choppy, conflict, no room, event window", () => {
    const r = noTradeRules({
      ...ok,
      plan: { ...plan, rewardToTargets: [{ target: 101, reward: 1, rr: 1.2 }] }, price: 101.2,
      rvol: 0.5, choppy: true, align: { ...ok.align!, conflict: true, against: ["D"] },
      room: { ...ok.room!, grade: "POOR" }, minutesToEvent: 9,
    });
    expect(r.map((x) => x.key)).toEqual(["poor-rr", "between-levels", "volume", "choppy", "conflict", "room", "event"]);
    expect(hasHard(r)).toBe(false);
    expect(r.find((x) => x.key === "event")?.reason).toMatch(/9 minutes/);
  });
  it("an event outside the buffer does not block", () => {
    expect(noTradeRules({ ...ok, minutesToEvent: 40 })).toEqual([]);
  });
});
