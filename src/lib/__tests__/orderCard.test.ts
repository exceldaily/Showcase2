import { describe, expect, it } from "vitest";
import { buildOrderCard, roundToTick } from "../sirenRules";
import type { OptionsAnalysis, RankedContract } from "../optionsTerminal";

const best: RankedContract = {
  symbol: "NVDA260908C00230000", side: "call", strike: 230, expiry: "2026-09-08", dte: 0.3,
  bid: 2.1, ask: 2.2, mid: 2.15, last: 2.15, spreadDollars: 0.1, spreadPct: 4.7, volume: 9000, openInterest: 12000,
  iv: 0.5, delta: 0.52, gamma: 0.08, theta: -0.9, vega: 0.05, greeksSource: "alpaca",
  intrinsic: 0, extrinsic: 2.15, breakEven: 232.15, moneyness: "ATM", quoteTs: Date.now(), stale: false,
  score: 78, scoreParts: [], why: [],
};
const est = (mid: number) => ({ label: "", underlying: 0, minutesAhead: 60, low: mid * 0.9, high: mid * 1.1, midEstimate: mid, perContractLow: 0, perContractHigh: 0, method: "bs-iv" as const });

const analysis = (): OptionsAnalysis => ({
  symbol: "NVDA", summary: [], stateExplain: null, history: null,
  sides: {
    call: {
      side: "call", best, alternatives: [],
      ladder: [
        { label: "Resistance 1", price: 231.5, kind: "level", est: est(3.4) },
        { label: "Wrong below", price: 229.2, kind: "wrong", est: est(1.27) },
      ],
    },
    put: { side: "put", best: null, alternatives: [], ladder: [] },
  },
  connected: true, marketOpen: true, session: "rth", slot: "morning", asOf: new Date().toISOString(),
  price: 230.4, changePct: 1, prevClose: 228, rvol: 2, atr5m: 0.4, vwap: 229.5, lastTradeTs: Date.now(), dataStale: false,
  bars: { m1: [], m5: [], m15: [], daily: [] }, vwapSeries: [], zones: [], keyMarks: [],
  trend: { label: "Bullish", confidence: 80, signals: [] }, direction: "long",
  machine: null,
  plan: { direction: "long", trigger: 230, invalidation: 229.2, targets: [231.5, 233, 234.5], riskDollars: 0.8, rewardToTargets: [] },
  room: null, contracts: [best], best, scenarios: null, opportunity: null,
  context: { spy: null, qqq: null }, replayCutoff: null, notes: [],
});

describe("order card", () => {
  it("rounds to option ticks (0.01 under $3, 0.05 at $3+)", () => {
    expect(roundToTick(1.273)).toBeCloseTo(1.27, 5);
    expect(roundToTick(3.42)).toBeCloseTo(3.4, 5);
    expect(roundToTick(3.43)).toBeCloseTo(3.45, 5);
  });

  it("builds limit / stop-limit / target from the level ladder", () => {
    const card = buildOrderCard(analysis())!;
    expect(card).not.toBeNull();
    expect(card.label).toBe("NVDA 230C exp 09-08");
    expect(card.limit).toBeCloseTo(2.2, 5);       // buy at the ask
    expect(card.stopTrigger).toBeCloseTo(1.27, 5); // est. value at invalidation
    expect(card.stopLimit).toBeLessThan(card.stopTrigger);
    expect(card.target).toBeCloseTo(3.4, 5);       // est. value at T1
    expect(card.underlyingInvalidation).toBe(229.2);
    expect(card.note).toMatch(/estimates/);
  });

  it("refuses a nonsensical card (stop above ask or target below ask)", () => {
    const a = analysis();
    a.sides.call.ladder[1].est = est(2.5); // "stop" above the ask
    expect(buildOrderCard(a)).toBeNull();
  });
});
