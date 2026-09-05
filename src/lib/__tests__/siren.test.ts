import { describe, expect, it } from "vitest";
import { evaluateSiren } from "../sirenRules";
import type { OptionsAnalysis, RankedContract } from "../optionsTerminal";

const contract = (over: Partial<RankedContract> = {}): RankedContract => ({
  symbol: "NVDA260908C00230000", side: "call", strike: 230, expiry: "2026-09-08", dte: 0.3,
  bid: 2.1, ask: 2.2, mid: 2.15, last: 2.15, spreadDollars: 0.1, spreadPct: 4.7, volume: 9000, openInterest: 12000,
  iv: 0.5, delta: 0.52, gamma: 0.08, theta: -0.9, vega: 0.05, greeksSource: "alpaca",
  intrinsic: 0, extrinsic: 2.15, breakEven: 232.15, moneyness: "ATM", quoteTs: Date.now(), stale: false,
  score: 78, scoreParts: [], why: [], ...over,
});

function analysis(over: Partial<OptionsAnalysis> = {}): OptionsAnalysis {
  const best = contract();
  return {
    symbol: "NVDA", summary: [], stateExplain: null, history: null, setups: [],
    sides: { call: { side: "call", best, alternatives: [], ladder: [] }, put: { side: "put", best: null, alternatives: [], ladder: [] } },
    connected: true, marketOpen: true, session: "rth", slot: "morning", asOf: new Date().toISOString(),
    price: 230.4, changePct: 1.2, prevClose: 227.7, rvol: 2.1, atr5m: 0.4, vwap: 229.5, lastTradeTs: Date.now(), dataStale: false,
    bars: { m1: [], m5: [], m15: [], daily: [] }, vwapSeries: [], zones: [], keyMarks: [],
    trend: { label: "Bullish", confidence: 82, signals: [] }, direction: "long",
    machine: { state: "CONFIRMED", sinceIndex: 3, quality: 83, checks: [], extreme: 230.6, retestZone: null, transitions: [] },
    plan: { direction: "long", trigger: 230, invalidation: 229.2, targets: [231.5, 233, 234.5], riskDollars: 0.8, rewardToTargets: [] },
    room: { dollars: 1.1, pct: 0.5, atrMultiple: 2.7, nextLevel: 231.5, grade: "GOOD", note: "" },
    contracts: [best], best, scenarios: null, opportunity: { total: 78, parts: [] },
    context: { spy: 0.4, qqq: 0.6 }, replayCutoff: null, notes: [],
    ...over,
  };
}

describe("siren rules", () => {
  it("fires a high-urgency alert on a confirmed, aligned, high-volume break with a tradeable contract", () => {
    const a = evaluateSiren(analysis(), "2026-09-08")!;
    expect(a).not.toBeNull();
    expect(a.kind).toBe("BREAK_CONFIRMED");
    expect(a.urgency).toBe("high");
    expect(a.body).toMatch(/RVOL 2.10x/);
    expect(a.body).toMatch(/230C/);
    expect(a.dedupeKey).toBe("NVDA:BREAK_CONFIRMED:2026-09-08");
  });

  it("does NOT fire on a confirmed break with weak volume", () => {
    expect(evaluateSiren(analysis({ rvol: 1.1 }), "2026-09-08")).toBeNull();
  });

  it("does NOT fire when the trend disagrees with the break direction", () => {
    expect(evaluateSiren(analysis({ trend: { label: "Bearish", confidence: 70, signals: [] } }), "2026-09-08")).toBeNull();
  });

  it("does NOT fire into a wall (poor room)", () => {
    expect(evaluateSiren(analysis({ room: { dollars: 0.1, pct: 0.04, atrMultiple: 0.2, nextLevel: 230.5, grade: "POOR", note: "" } }), "2026-09-08")).toBeNull();
  });

  it("does NOT fire on stale data or a stale contract", () => {
    expect(evaluateSiren(analysis({ dataStale: true }), "2026-09-08")).toBeNull();
    const stale = contract({ stale: true });
    expect(evaluateSiren(analysis({ sides: { call: { side: "call", best: stale, alternatives: [], ladder: [] }, put: { side: "put", best: null, alternatives: [], ladder: [] } } }), "2026-09-08")).toBeNull();
  });

  it("WATCHING with a mere Bullish trend is not an alert; a Strongly Bullish surge on heavy volume is medium urgency", () => {
    const watching = analysis({ machine: { state: "WATCHING", sinceIndex: 0, quality: 0, checks: [], extreme: null, retestZone: null, transitions: [] } });
    expect(evaluateSiren(watching, "2026-09-08")).toBeNull();
    const surge = analysis({
      machine: { state: "APPROACHING", sinceIndex: 0, quality: 0, checks: [], extreme: null, retestZone: null, transitions: [] },
      trend: { label: "Strongly Bullish", confidence: 90, signals: [] }, rvol: 2.4,
    });
    const a = evaluateSiren(surge, "2026-09-08")!;
    expect(a.kind).toBe("TREND_SURGE");
    expect(a.urgency).toBe("medium");
    expect(a.body).toMatch(/wait for the level to break/);
  });

  it("works for the put side on a breakdown", () => {
    const put = contract({ symbol: "NVDA260908P00230000", side: "put", delta: -0.5 });
    const a = evaluateSiren(analysis({
      direction: "short", trend: { label: "Bearish", confidence: 85, signals: [] },
      sides: { call: { side: "call", best: null, alternatives: [], ladder: [] }, put: { side: "put", best: put, alternatives: [], ladder: [] } },
    }), "2026-09-08")!;
    expect(a.kind).toBe("BREAK_CONFIRMED");
    expect(a.title).toMatch(/BREAKDOWN/);
    expect(a.body).toMatch(/230P/);
  });
});
