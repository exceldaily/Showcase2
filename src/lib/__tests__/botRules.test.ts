import { describe, expect, it } from "vitest";
import { DEFAULT_BOT, budgetState, entryBlocks, exitDecision, exitLimit, planEntry, sanitizeSettings, tick, type BotSettings, type Candidate, type TradeMoney } from "../bot/rules";

const S: BotSettings = { ...DEFAULT_BOT, mode: "trade", budget: 500, perTrade: 150, maxContracts: 3 };
const t = (over: Partial<TradeMoney>): TradeMoney => ({ status: "CLOSED", reserved: 0, cost: 0, pnl: 0, day: "2026-11-11", openedAt: "2026-11-11T15:00:00.000Z", ...over });
const cand = (over: Partial<Candidate> = {}): Candidate => ({ symbol: "NVDA", call: "CALL", setupScore: 72, side: "call", contract: { symbol: "NVDA261111C00230000", ask: 1.2, bid: 1.15, spreadPct: 4.3, dte: 0.2, openInterest: 5000, volume: 9000 }, ...over });

describe("bot budget", () => {
  it("charges open orders at their limit, open positions at cost, and losses for good", () => {
    const b = budgetState(S, [t({ status: "PENDING_ENTRY", reserved: 120 }), t({ status: "OPEN", cost: 100 }), t({ pnl: -80 }), t({ pnl: 60, day: "2026-11-10" })], "2026-11-11");
    expect(b.reserved).toBe(120);
    expect(b.inPositions).toBe(100);
    expect(b.realized).toBe(-20);
    expect(b.available).toBe(500 - 120 - 100 - 20);
    expect(b.todayRealized).toBe(-80);
    expect(b.openCount).toBe(2);
  });
  it("does not let gains raise the budget unless reinvesting is on", () => {
    const trades = [t({ pnl: 300 })];
    expect(budgetState(S, trades, "2026-11-11").available).toBe(500);
    expect(budgetState({ ...S, reinvestGains: true }, trades, "2026-11-11").available).toBe(800);
  });
  it("never goes below zero and forgets losses from before a reset", () => {
    expect(budgetState(S, [t({ pnl: -900 })], "2026-11-11").available).toBe(0);
    expect(budgetState({ ...S, budgetSince: "2026-11-11T16:00:00.000Z" }, [t({ pnl: -900 })], "2026-11-11").available).toBe(500);
  });
  it("can never have more at risk than the budget, whatever order trades arrive in", () => {
    // Keep buying the most the rules allow, lose every trade, and check the total lost never passes the budget.
    const trades: TradeMoney[] = [];
    let lost = 0;
    for (let i = 0; i < 40; i++) {
      const b = budgetState({ ...S, maxOpen: 99, maxTradesPerDay: 99 }, trades, "2026-11-11");
      const p = planEntry(S, b, cand({ contract: { symbol: "X", ask: 0.4 + (i % 5) * 0.3, bid: 0.38, spreadPct: 5, dte: 0, openInterest: 999, volume: 999 } }));
      if (!p.ok) continue;
      expect(p.reserve).toBeLessThanOrEqual(b.available + 1e-9);
      trades.push(t({ pnl: -p.reserve }));
      lost += p.reserve;
    }
    expect(lost).toBeLessThanOrEqual(500);
    expect(budgetState(S, trades, "2026-11-11").available).toBeLessThan(45);
  });
});

describe("bot entries", () => {
  const b = budgetState(S, [], "2026-11-11");
  it("sizes within the per-trade cap at the limit price, not the quote", () => {
    const p = planEntry(S, b, cand());
    expect(p.ok).toBe(true);
    expect(p.limit).toBe(1.24); // 1.20 ask + 3%, rounded up to a cent
    expect(p.qty).toBe(1); // two would cost $248, over the $150 cap
    expect(p.reserve).toBe(124);
  });
  it("uses what is left when that is less than the per-trade cap", () => {
    const tight = budgetState(S, [t({ status: "OPEN", cost: 440 })], "2026-11-11");
    expect(planEntry(S, tight, cand({ contract: { symbol: "X", ask: 0.25, bid: 0.24, spreadPct: 4, dte: 0, openInterest: 999, volume: 999 } })).qty).toBe(2);
    const p = planEntry(S, tight, cand());
    expect(p.ok).toBe(false);
    expect(p.reason).toMatch(/one contract costs \$124, more than the \$60/);
  });
  it("only acts on CALL or PUT, on an allowed side, above the minimum score, on a tradeable contract", () => {
    expect(planEntry(S, b, cand({ call: "WAIT" })).reason).toBe("engine says WAIT");
    expect(planEntry(S, b, cand({ call: "DO NOT CHASE" })).ok).toBe(false);
    expect(planEntry({ ...S, calls: false }, b, cand()).reason).toBe("calls are switched off");
    expect(planEntry(S, b, cand({ setupScore: 55 })).reason).toMatch(/under 60/);
    expect(planEntry(S, b, cand({ contract: null })).reason).toBe("no contract within the rules");
    expect(planEntry(S, b, cand({ contract: { ...cand().contract!, spreadPct: 14 } })).reason).toMatch(/spread 14\.0% is wider/);
    expect(planEntry(S, b, cand({ contract: { ...cand().contract!, dte: 3 } })).reason).toMatch(/expires in 3 days/);
    expect(planEntry(S, b, cand({ contract: { ...cand().contract!, openInterest: 10, volume: 5 } })).reason).toBe("contract is too thin");
  });
  it("blocks every entry when a limit is hit", () => {
    expect(entryBlocks(S, b, 11 * 60, true)).toEqual([]);
    expect(entryBlocks({ ...S, mode: "off" }, b, 11 * 60, true)[0]).toBe("bot is off");
    expect(entryBlocks(S, b, 11 * 60, false)).toContain("market is closed");
    expect(entryBlocks(S, b, 9 * 60 + 40, true)).toContain("before 9:45 ET");
    expect(entryBlocks(S, b, 15 * 60 + 5, true)).toContain("past the last entry time");
    expect(entryBlocks(S, budgetState(S, [t({ status: "OPEN", cost: 50 }), t({ status: "OPEN", cost: 50 })], "2026-11-11"), 660, true)[0]).toMatch(/2 of 2 positions/);
    expect(entryBlocks(S, budgetState(S, [t({ pnl: -210 })], "2026-11-11"), 660, true)).toContain("daily loss limit reached ($210)");
    expect(entryBlocks(S, budgetState(S, [t({}), t({}), t({})], "2026-11-11"), 660, true)).toContain("daily trade limit reached (3)");
    expect(entryBlocks(S, budgetState(S, [t({ pnl: -500, day: "2026-11-10" })], "2026-11-11"), 660, true)).toContain("budget is used up");
  });
});

describe("bot exits", () => {
  const p = { side: "call" as const, entryFill: 1.2, openedAtMs: 0, target: 232, invalidation: 229.4 };
  const m = { minutes: 11 * 60, nowMs: 10 * 60_000, underlying: 230.5, optionPrice: 1.25 };
  it("holds while nothing has happened", () => {
    expect(exitDecision(S, p, m).exit).toBe(false);
  });
  it("sells at the stock's target and at the wrong line, mirrored for puts", () => {
    expect(exitDecision(S, p, { ...m, underlying: 232.1 }).reason).toMatch(/reached target 1/);
    expect(exitDecision(S, p, { ...m, underlying: 229.4 }).reason).toMatch(/wrong line/);
    const put = { ...p, side: "put" as const, target: 228, invalidation: 231 };
    expect(exitDecision(S, put, { ...m, underlying: 227.9 }).reason).toMatch(/reached target 1/);
    expect(exitDecision(S, put, { ...m, underlying: 231.2 }).reason).toMatch(/wrong line/);
  });
  it("sells on the option's own stop and take profit", () => {
    expect(exitDecision(S, p, { ...m, optionPrice: 0.75 }).reason).toMatch(/down 38%/);
    expect(exitDecision(S, p, { ...m, optionPrice: 1.7 }).reason).toMatch(/up 42%/);
    expect(exitDecision(S, p, { ...m, optionPrice: null, underlying: null }).exit).toBe(false);
  });
  it("sells everything before the close with a market order, and anything held too long", () => {
    const eod = exitDecision(S, p, { ...m, minutes: 15 * 60 + 45 });
    expect(eod.exit).toBe(true);
    expect(eod.urgent).toBe(true);
    expect(exitDecision(S, p, { ...m, nowMs: 121 * 60_000 }).reason).toMatch(/held 120 minutes/);
  });
  it("prices a sell a little under the bid, on a valid tick", () => {
    expect(exitLimit(S, 1.5, 1.4)).toBe(1.45);
    expect(exitLimit(S, null, 4.0)).toBe(3.85);
    expect(exitLimit(S, 0.01, 0.01)).toBe(0.01);
    expect(tick(3.01, "up")).toBe(3.05);
    expect(tick(2.999, "down")).toBe(2.99);
  });
});

describe("bot settings", () => {
  it("clamps whatever a form sends", () => {
    const s = sanitizeSettings({ mode: "live", budget: "300", perTrade: 9999, dailyLossLimit: 5000, symbols: ["nvda", "SPX", "bad symbol!", "NVDA", "tsla"], minScore: 10, flattenAt: 2000, noEntryAfter: 2000, stopLossPct: 500, maxOpen: 0 });
    expect(s.mode).toBe("off"); // unknown mode keeps the previous one
    expect(s.budget).toBe(300);
    expect(s.perTrade).toBe(300);
    expect(s.dailyLossLimit).toBe(300);
    expect(s.symbols).toEqual(["NVDA", "TSLA"]);
    expect(s.minScore).toBe(50);
    expect(s.flattenAt).toBe(15 * 60 + 55);
    expect(s.noEntryAfter).toBe(15 * 60 + 50);
    expect(s.stopLossPct).toBe(95);
    expect(s.maxOpen).toBe(1);
  });
  it("starts off", () => {
    expect(DEFAULT_BOT.mode).toBe("off");
  });
});
