import { describe, expect, it } from "vitest";
import { blockedTable, bySymbol, conditionTable, modelSummary, summarize, MIN_SAMPLE, type SignalRow } from "../signals/stats";
import { dedupeWrites, fromReplay, type SignalWrite } from "../signals/store";
import { readDecision } from "../decision/lifecycle";
import { lifecycleFromRead } from "../decision/lifecycle";
import { scanGroup, scanRank, type WatchRow } from "../quality/watchlist";
import type { SignalFeatures } from "../quality/assemble";
import type { SetupRead } from "../quality/engine";

const feat = (over: Partial<SignalFeatures> = {}): SignalFeatures => ({
  minutes: 640, session: "rth", rvol: 1.2, breakVolX: 1.5, recentVolX: 1.2, structure5: "HH/HL", structure15: "HH/HL", vwapSide: "with", vwapDistAtr: 1, macdWith: true, rsi: 60, emaWith: true,
  tfWith: 4, tfAgainst: 0, marketAligned: true, spyWith: true, qqqWith: true, sectorWith: null, chopScore: 10, quality: 75, qualityLabel: "Strong", roomGrade: "GOOD", rr: 2.5, levelStrength: 80, bias: "BULLISH", extAtr: 0.4, via: "follow-through", ...over,
});
const row = (over: Partial<SignalRow> = {}): SignalRow => ({
  symbol: "NVDA", day: "2026-09-28", model: "new", source: "replay", direction: "long", trigger: 229, status: "ENTRY", blockedBy: null, firedAt: "2026-09-28T14:40:00.000Z", price: 229.4,
  features: feat(), outcome: "WIN", r: 2, maeR: 0.3, mfeR: 2, rr: 2, falseBreak: false, ...over,
});

describe("signal stats", () => {
  it("counts only resolved signals and flags small samples", () => {
    const b = summarize("x", [row(), row({ outcome: "LOSS", r: -1, maeR: 1, mfeR: 0.2, falseBreak: true }), row({ outcome: "BREAKEVEN", r: 0.1 }), row({ outcome: null, r: null })]);
    expect(b.n).toBe(3);
    expect(b.wins).toBe(1);
    expect(b.losses).toBe(1);
    expect(b.breakeven).toBe(1);
    expect(b.winRate).toBe(33);
    expect(b.avgR).toBeCloseTo(0.37, 2);
    expect(b.totalR).toBe(1.1);
    expect(b.falseBreakRate).toBe(33);
    expect(b.small).toBe(true);
    expect(summarize("big", Array.from({ length: MIN_SAMPLE }, () => row())).small).toBe(false);
    expect(summarize("none", []).winRate).toBeNull();
  });
  it("slices entries by what was true at the signal", () => {
    const rows = [row(), row({ outcome: "LOSS", r: -1, features: feat({ rvol: 0.6, spyWith: false, structure5: "LH/LL", quality: 40 }) })];
    const t = conditionTable(rows);
    const get = (k: string) => t.find((c) => c.key === k)!;
    expect(get("rvol-mid").n).toBe(1);
    expect(get("rvol-low").n).toBe(1);
    expect(get("rvol-low").winRate).toBe(0);
    expect(get("mkt-against").n).toBe(1);
    expect(get("struct-against").avgR).toBe(-1);
    expect(get("q-strong").winRate).toBe(100);
    expect(get("q-weak").n).toBe(1);
    expect(get("pre").n).toBe(0);
  });
  it("summarises each model and what the new one held back", () => {
    const rows = [
      row(), row({ model: "old", outcome: "LOSS", r: -1 }), row({ model: "old", status: "NEVER TRIGGERED", outcome: null, r: null, features: null }),
      row({ status: "NO ENTRY", blockedBy: "DO NOT CHASE: bullish, entry missed: price is 1.9 ATR past the level", outcome: "LOSS", r: -1 }),
      row({ status: "NO ENTRY", blockedBy: "NO TRADE: chop", outcome: "WIN", r: 1.5, day: "2026-09-25" }),
      row({ status: "FAILED BREAKOUT", outcome: null, r: null }),
    ];
    const n = modelSummary("new", rows);
    expect(n.setups).toBe(4);
    expect(n.status).toEqual({ ENTRY: 1, "NO ENTRY": 2, "FAILED BREAKOUT": 1, "NEVER TRIGGERED": 0 });
    expect(n.sessions).toBe(2);
    expect(n.blocked.n).toBe(2);
    expect(modelSummary("old", rows).status["NEVER TRIGGERED"]).toBe(1);
    const held = blockedTable(rows);
    expect(held.map((b) => b.name).sort()).toEqual(["DO NOT CHASE: price ran too far past the level", "NO TRADE: chop"]);
    expect(bySymbol(rows.filter((r) => r.status === "ENTRY"))[0].name).toBe("NVDA");
  });
});

describe("signal writes", () => {
  const w = (status: SignalWrite["status"], trigger = 229): SignalWrite => ({ symbol: "NVDA", day: "2026-09-28", model: "new", source: "replay", direction: "long", trigger, invalidation: 228, targets: [232], status, blockedBy: null, firedAt: null, price: null, features: null, outcome: null });
  it("keeps the furthest a level got when it was locked more than once", () => {
    const out = dedupeWrites([w("NEVER TRIGGERED"), w("FAILED BREAKOUT"), w("ENTRY"), w("NO ENTRY"), w("NEVER TRIGGERED", 231)]);
    expect(out).toHaveLength(2);
    expect(out.find((x) => x.trigger === 229)?.status).toBe("ENTRY");
  });
  it("maps a replay record to a row", () => {
    const r = fromReplay({ symbol: "SPY", day: "2026-09-28", model: "old", direction: "short", trigger: 765, invalidation: 766, target1: 762, status: "ENTRY", blockedBy: null, firedAt: Date.parse("2026-09-28T15:00:00Z"), price: 764.5, features: feat(), outcome: { result: "WIN", r: 1.7, maeR: 0.2, mfeR: 1.7, exit: "target", falseBreak: false, rr: 1.7 } }, "replay");
    expect(r.firedAt).toBe("2026-09-28T15:00:00.000Z");
    expect(r.targets).toEqual([762]);
    expect(r.source).toBe("replay");
  });
});

describe("decision from the read", () => {
  const plan = { direction: "long" as const, trigger: 101, invalidation: 100.4, targets: [104, 106, 108], riskDollars: 0.6, rewardToTargets: [{ target: 104, reward: 3, rr: 5 }] };
  const read = (over: Partial<SetupRead>): SetupRead => ({
    call: "CALL", reason: "breakout confirmed, follow-through held", setup: "Bullish breakout", quality: null, state: "BREAKOUT CONFIRMED", stateDetail: "follow-through held", why: [], waitingFor: [], warnings: [],
    bias: { bias: "BULLISH", momentum: "BULLISH", note: null, changes: 0 }, chop: { chop: false, score: 0, signals: [], measured: true }, chase: null,
    breakout: { state: "BREAKOUT CONFIRMED", breakAt: 1, confirmedAt: 2, failedAt: null, via: "follow-through", checks: [{ key: "close", name: "5-minute close above $101.00", pass: true, detail: "" }], breakVolX: 1.5, extreme: 102, barsSinceBreak: 1 },
    market: { aligned: null, score: null, legs: [] }, premarket: false, ...over,
  });
  const input = { machineState: "WATCHING" as const, checks: [], extreme: null, plan, direction: "long" as const, price: 101.6, trendLabel: "Bullish", trendConfidence: 70, choppy: false, dailyTrend: null, room: null, rvol: 1.2, vwap: 100, session: "rth", slot: "morning", marketOpen: true, inTrade: false };

  it("takes the call and the lifecycle from the engine, not the old machine", () => {
    const d = readDecision({ ...input, read: read({}) });
    expect(d.call).toBe("CALL");
    expect(d.verdict).toBe("TRADE");
    expect(d.lifecycle).toBe("CONFIRMED");
    expect(d.confirmation[0].met).toBe(true);
  });
  it("lets a no-trade rule hold a call back but never create one", () => {
    const soft = readDecision({ ...input, read: read({}), blockers: [{ key: "event", severity: "soft", reason: "High-impact event in 9 minutes" }] });
    expect(soft.call).toBe("WAIT");
    expect(soft.verdictReason).toBe("high-impact event in 9 minutes");
    const hard = readDecision({ ...input, read: read({}), blockers: [{ key: "spread", severity: "hard", reason: "Wide option spread (14%)" }] });
    expect(hard.call).toBe("NO TRADE");
    const waiting = readDecision({ ...input, read: read({ call: "WAIT", reason: "testing $101.00, no close beyond it", state: "TESTING", waitingFor: ["5m close above $101.00"] }) });
    expect(waiting.call).toBe("WAIT");
    expect(waiting.lifecycle).toBe("APPROACHING");
    expect(waiting.needs).toEqual(["5m close above $101.00"]);
  });
  it("passes DO NOT CHASE through and switches to MANAGE with a position open", () => {
    expect(readDecision({ ...input, read: read({ call: "DO NOT CHASE", reason: "bullish, entry missed" }) }).call).toBe("DO NOT CHASE");
    const m = readDecision({ ...input, inTrade: true, read: read({}) });
    expect(m.call).toBe("MANAGE");
    expect(m.lifecycle).toBe("IN TRADE");
    expect(m.verdictReason).toMatch(/out on a 5m close below \$100\.40/);
  });
  it("maps the engine states onto lifecycle words", () => {
    const st = (state: string) => lifecycleFromRead({ state, stateDetail: null, breakout: { state } }, true).lifecycle;
    expect(st("TESTING")).toBe("APPROACHING");
    expect(st("BREAK ATTEMPT")).toBe("TRIGGERED");
    expect(st("BREAKOUT CONFIRMED")).toBe("CONFIRMED");
    expect(st("FAILED BREAKOUT")).toBe("INVALIDATED");
    expect(st("TARGET REACHED")).toBe("TARGET HIT");
    expect(lifecycleFromRead({ state: "WATCHING", stateDetail: null, breakout: null }, false).lifecycle).toBe("NO SETUP");
  });
});

describe("watchlist order", () => {
  const r = (over: Partial<WatchRow>): WatchRow => ({ state: "WATCHING", trigger: 10, distanceToTriggerPct: 1, ...over });
  it("puts something to act on first, then forming setups, best score first", () => {
    expect(scanRank({ call: "CALL", readState: "BREAKOUT CONFIRMED", setupScore: 60 })).toBeGreaterThan(scanRank({ call: "WAIT", readState: "TESTING", setupScore: 95 }));
    expect(scanRank({ call: "WAIT", readState: "TESTING", setupScore: 50 })).toBeGreaterThan(scanRank({ call: "WAIT", readState: "WATCHING", setupScore: 90 }));
    expect(scanRank({ call: "WAIT", readState: "WATCHING", setupScore: 80 })).toBeGreaterThan(scanRank({ call: "WAIT", readState: "WATCHING", setupScore: 40 }));
  });
  it("groups rows by the engine's call and state", () => {
    expect(scanGroup(r({ call: "PUT", readState: "BREAKOUT CONFIRMED" }))).toBe("READY");
    expect(scanGroup(r({ call: "WAIT", readState: "BREAK ATTEMPT" }))).toBe("NEAR TRIGGER");
    expect(scanGroup(r({ call: "DO NOT CHASE", readState: "BREAKOUT CONFIRMED" }))).toBe("NEAR TRIGGER");
    expect(scanGroup(r({ call: "WAIT", readState: "WATCHING" }))).toBe("WATCH");
    expect(scanGroup(r({ call: "NO TRADE", readState: "FAILED BREAKOUT" }))).toBe("NO SETUP");
    expect(scanGroup(r({ state: "CONFIRMED" }))).toBe("READY"); // rows from an older payload still group
  });
});
