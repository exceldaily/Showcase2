import { describe, expect, it } from "vitest";
import { confirmationList, lifecycleOf, readBias, readDecision, volumeState, vwapState, type DecisionInput } from "../decision/lifecycle";
import type { TradePlan } from "../setupMachine";

const plan: TradePlan = {
  direction: "long", trigger: 211.61, invalidation: 210.9, targets: [213.1, 214.6, 216.2], riskDollars: 0.71,
  rewardToTargets: [{ target: 213.1, reward: 1.49, rr: 2.1 }, { target: 214.6, reward: 2.99, rr: 4.2 }, { target: 216.2, reward: 4.59, rr: 6.5 }],
};

const base: DecisionInput = {
  machineState: "WATCHING", checks: [], extreme: null, plan, direction: "long", price: 210.4,
  trendLabel: "Bullish", trendConfidence: 62, choppy: false, dailyTrend: "Bullish", room: null, rvol: 1.1, vwap: 210.0,
  session: "rth", slot: "morning", marketOpen: true, inTrade: false,
};

describe("bias is separate from entry", () => {
  it("bullish chart with no break is WAIT / NO ENTRY YET", () => {
    const r = readDecision(base);
    expect(r.bias).toBe("BULLISH");
    expect(r.entry).toBe("NO ENTRY YET");
    expect(r.verdict).toBe("WAIT");
    expect(r.setup).toBe("5M BREAKOUT");
  });
  it("choppy 5m becomes NEUTRAL with the daily lean noted", () => {
    const b = readBias("Bullish", true, "Bearish");
    expect(b.bias).toBe("NEUTRAL");
    expect(b.biasNote).toMatch(/daily leans bearish/);
  });
  it("strength words map from the trend label", () => {
    expect(readBias("Strongly Bearish", false, null).biasStrength).toBe("STRONG");
    expect(readBias("Slightly Bullish", false, null).biasStrength).toBe("WEAK");
    expect(readBias("Neutral", false, null).bias).toBe("NEUTRAL");
  });
});

describe("lifecycle mapping", () => {
  it("no plan is NO SETUP and NO TRADE", () => {
    const r = readDecision({ ...base, plan: null });
    expect(r.lifecycle).toBe("NO SETUP");
    expect(r.verdict).toBe("NO TRADE");
  });
  it("FORMING shows as APPROACHING with a detail", () => {
    const l = lifecycleOf({ ...base, machineState: "FORMING" });
    expect(l.lifecycle).toBe("APPROACHING");
    expect(l.detail).toBe("pressing the level");
  });
  it("CONFIRMED is the only TRADE verdict and only after 9:45", () => {
    expect(readDecision({ ...base, machineState: "CONFIRMED" }).verdict).toBe("TRADE");
    const early = readDecision({ ...base, machineState: "CONFIRMED", slot: "open-15" });
    expect(early.verdict).toBe("WAIT");
    expect(early.needs[0]).toBe("After 9:45 ET");
  });
  it("choppy or no room downgrades a confirmed break to WAIT", () => {
    expect(readDecision({ ...base, machineState: "CONFIRMED", choppy: true }).verdict).toBe("WAIT");
    expect(readDecision({ ...base, machineState: "CONFIRMED", room: { dollars: 0.2, pct: 0.1, atrMultiple: 0.3, nextLevel: 212, grade: "POOR", note: "" } }).verdict).toBe("WAIT");
  });
  it("a recorded position turns CONFIRMED into IN TRADE / MANAGE", () => {
    const r = readDecision({ ...base, machineState: "RETESTING", inTrade: true });
    expect(r.lifecycle).toBe("IN TRADE");
    expect(r.lifecycleDetail).toBe("retesting the level");
    expect(r.verdict).toBe("MANAGE");
  });
  it("TARGET HIT when the post-break extreme reached T1", () => {
    const r = readDecision({ ...base, machineState: "CONTINUATION", extreme: 213.5 });
    expect(r.lifecycle).toBe("TARGET HIT");
    expect(r.verdict).toBe("WAIT");
  });
  it("FAILED is INVALIDATED; a post-trigger state after the close is EXPIRED", () => {
    expect(lifecycleOf({ ...base, machineState: "FAILED" }).lifecycle).toBe("INVALIDATED");
    expect(lifecycleOf({ ...base, machineState: "CONFIRMED", marketOpen: false, session: "closed" }).lifecycle).toBe("EXPIRED");
    expect(lifecycleOf({ ...base, machineState: "WATCHING", marketOpen: false, session: "closed" }).lifecycle).toBe("WATCHING");
  });
  it("TRIGGERED lists the failed checks as needs", () => {
    const r = readDecision({
      ...base, machineState: "TRIGGERED",
      checks: [
        { name: "Close beyond level", pass: true, detail: "" },
        { name: "Volume (RVOL)", pass: false, detail: "" },
        { name: "VWAP side", pass: true, detail: "" },
        { name: "Candle body", pass: false, detail: "" },
      ],
    });
    expect(r.entry).toBe("WAITING FOR CONFIRMATION");
    expect(r.needs).toEqual(["Relative volume 1.5x or more (now 1.10x)", "Full-bodied candle, not a wick"]);
  });
});

describe("helpers", () => {
  it("confirmation list ticks from the machine checks", () => {
    const c = confirmationList({ ...base, checks: [{ name: "Close beyond level", pass: true, detail: "" }] });
    expect(c[0].met).toBe(true);
    expect(c[1].met).toBe(false);
  });
  it("volume and vwap words", () => {
    expect(volumeState(2.2).label).toBe("HEAVY");
    expect(volumeState(0.5).label).toBe("LIGHT");
    expect(volumeState(null).label).toBe("UNKNOWN");
    expect(vwapState(101, 100)).toEqual({ label: "ABOVE", pct: 1 });
    expect(vwapState(100.02, 100).label).toBe("AT");
    expect(vwapState(null, 100).label).toBe("N/A");
  });
});
