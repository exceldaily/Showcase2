import { describe, expect, it } from "vitest";
import type { Bar } from "../bars";
import {
  buildRead, closedBars, failedAttempts, readBreakout, readChase, readChop, readMarket, scoreQuality, stableBias,
  type BiasRead, type ChopRead, type MarketRead, type QualityInput,
} from "../quality/engine";
import { assembleRead, marketSymbols, releaseReason, sectorEtf, slotBaselineBefore } from "../quality/assemble";
import { resolveOutcome } from "../quality/replay";

// 2026-09-29, daylight time: ET = UTC-4.
const et = (h: number, m: number, date = "2026-09-29") => Date.parse(`${date}T${String(h + 4).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
const bar = (t: number, o: number, h: number, l: number, c: number, v = 1000): Bar => ({ t, o, h, l, c, v, vw: (h + l + c) / 3 });
/** 5-minute bars from 9:30: [open, high, low, close, volume]. */
const session = (rows: [number, number, number, number, number?][], start = et(9, 30)) => rows.map((r, i) => bar(start + i * 300_000, r[0], r[1], r[2], r[3], r[4] ?? 1000));
const baseline = new Map<number, number>(Array.from({ length: 78 }, (_, i) => [570 + i * 5, 1000]));

const flatMarket: MarketRead = { aligned: null, score: null, legs: [] };
const noChop: ChopRead = { chop: false, score: 0, signals: [], measured: true };
const bull: BiasRead = { bias: "BULLISH", momentum: "BULLISH", note: null, changes: 0 };

describe("closed bars", () => {
  it("drops a bar that is still forming", () => {
    const bars = session([[100, 101, 99, 100.5], [100.5, 102, 100, 101.8]]);
    expect(closedBars(bars, et(9, 38))).toHaveLength(1);
    expect(closedBars(bars, et(9, 40))).toHaveLength(2);
  });
});

describe("breakout states", () => {
  const base = { direction: "long" as const, trigger: 101, invalidation: 100.4, atr: 1, vwap: 100, rvol: 1, slotBaseline: baseline, marketAligned: null };
  it("a level cross alone is a break attempt, never a confirmation", () => {
    const r = readBreakout({ ...base, bars: session([[100, 100.6, 99.8, 100.5], [100.5, 101.6, 100.4, 101.4, 2000]]) });
    expect(r.state).toBe("BREAK ATTEMPT");
    expect(r.confirmedAt).toBeNull();
    expect(r.checks.find((c) => c.key === "hold")?.pass).toBe(false);
  });
  it("walks WATCHING, APPROACHING, TESTING before the break", () => {
    expect(readBreakout({ ...base, bars: session([[98, 98.5, 97.8, 98.2]]) }).state).toBe("WATCHING");
    expect(readBreakout({ ...base, bars: session([[100, 100.5, 99.9, 100.3]]) }).state).toBe("APPROACHING");
    expect(readBreakout({ ...base, bars: session([[100.5, 101.2, 100.4, 100.9]]) }).state).toBe("TESTING"); // wick through, no close
  });
  it("confirms on a follow-through candle with volume on the break", () => {
    const r = readBreakout({ ...base, bars: session([[100.5, 101.6, 100.4, 101.4, 1800], [101.4, 102.1, 101.2, 101.9, 1200]]) });
    expect(r.state).toBe("BREAKOUT CONFIRMED");
    expect(r.via).toBe("follow-through");
    expect(r.confirmedAt).toBe(et(9, 40));
    expect(r.breakVolX).toBeCloseTo(1.8, 5);
  });
  it("does not confirm a break on thin volume", () => {
    const r = readBreakout({ ...base, bars: session([[100.5, 101.6, 100.4, 101.4, 700], [101.4, 102.1, 101.2, 101.9, 800]]) });
    expect(r.state).toBe("BREAK ATTEMPT");
    expect(r.checks.find((c) => c.key === "volume")?.pass).toBe(false);
  });
  it("lets a later bar supply the volume", () => {
    const r = readBreakout({ ...base, bars: session([[100.5, 101.6, 100.4, 101.4, 700], [101.4, 102.1, 101.2, 101.9, 1500]]) });
    expect(r.state).toBe("BREAKOUT CONFIRMED");
  });
  it("calls a close back through the level a failed breakout", () => {
    const r = readBreakout({ ...base, bars: session([[100.5, 101.6, 100.4, 101.4, 1800], [101.4, 101.5, 100.6, 100.7]]) });
    expect(r.state).toBe("FAILED BREAKOUT");
  });
  it("confirms on a retest that holds", () => {
    const r = readBreakout({ ...base, bars: session([[100.5, 101.6, 100.4, 101.4, 1800], [101.4, 101.5, 101.05, 101.1], [101.1, 101.9, 101.0, 101.8]]) });
    expect(r.state).toBe("BREAKOUT CONFIRMED");
    expect(r.via).toBe("follow-through"); // the hold bar also made a higher close than the break bar
    const pure = readBreakout({ ...base, bars: session([[100.5, 102.4, 100.4, 102.2, 1800], [102.2, 102.3, 101.1, 101.3], [101.3, 101.9, 101.2, 101.8]]) });
    expect(pure.state).toBe("BREAKOUT CONFIRMED");
    expect(pure.via).toBe("retest");
  });
  it("will not confirm against the market or on the wrong side of VWAP", () => {
    const rows = session([[100.5, 101.6, 100.4, 101.4, 1800], [101.4, 102.1, 101.2, 101.9, 1200]]);
    expect(readBreakout({ ...base, marketAligned: false, bars: rows }).state).toBe("BREAK ATTEMPT");
    expect(readBreakout({ ...base, vwap: 103, bars: rows }).state).toBe("BREAK ATTEMPT");
  });
  it("fails a confirmed break that closes past the wrong line", () => {
    const r = readBreakout({ ...base, bars: session([[100.5, 101.6, 100.4, 101.4, 1800], [101.4, 102.1, 101.2, 101.9], [101.9, 102, 100.1, 100.2]]) });
    expect(r.state).toBe("FAILED BREAKOUT");
  });
  it("mirrors for breakdowns", () => {
    const r = readBreakout({ direction: "short", trigger: 99, invalidation: 99.6, atr: 1, vwap: 100, rvol: 1, slotBaseline: baseline, marketAligned: null, bars: session([[99.5, 99.6, 98.4, 98.6, 1800], [98.6, 98.8, 97.9, 98.1]]) });
    expect(r.state).toBe("BREAKOUT CONFIRMED");
  });
});

describe("don't chase", () => {
  it("is fine near the level", () => {
    expect(readChase({ direction: "long", price: 101.4, trigger: 101, atr: 1, target1: 104, ema9: 100.9, vwap: 100 }).chase).toBe(false);
  });
  it("flags an entry that ran too far past the level and says what would make a new one", () => {
    const r = readChase({ direction: "long", price: 102.8, trigger: 101, atr: 1, target1: 106, ema9: 102.1, vwap: 100 });
    expect(r.chase).toBe(true);
    expect(r.extAtr).toBeCloseTo(1.8, 5);
    expect(r.reentry[0]).toMatch(/pullback toward \$101\.00/);
    expect(r.reentry[1]).toMatch(/higher low near the 5-minute EMA 9 \(\$102\.10\)/);
  });
  it("flags a move that is mostly done", () => {
    const r = readChase({ direction: "short", price: 97.4, trigger: 99, atr: 2, target1: 96, ema9: null, vwap: 100 });
    expect(r.chase).toBe(true);
    expect(r.reason).toMatch(/53% of the way to target 1/);
  });
});

describe("chop", () => {
  const warm = Array.from({ length: 60 }, (_, i) => bar(et(9, 30, "2026-09-28") + i * 300_000, 100, 100.3, 99.7, 100 + (i % 2 ? 0.1 : -0.1)));
  it("calls a flat, alternating, low-volume hour chop", () => {
    const today = session(Array.from({ length: 14 }, (_, i) => [100 + (i % 2 ? 0.1 : -0.1), 100.25, 99.75, 100 + (i % 2 ? -0.1 : 0.1), 600] as [number, number, number, number, number]));
    const r = readChop({ bars: [...warm, ...today], day: "2026-09-29", atr: 0.6, rvol: 0.6, structure: "RANGE" });
    expect(r.measured).toBe(true);
    expect(r.chop).toBe(true);
    expect(r.signals.map((s) => s.key)).toEqual(expect.arrayContaining(["vwap-cross", "alternating", "low-volume", "no-structure", "tight-range"]));
  });
  it("leaves a clean trend alone", () => {
    const today = session(Array.from({ length: 14 }, (_, i) => [100 + i * 0.6, 100.8 + i * 0.6, 99.9 + i * 0.6, 100.6 + i * 0.6, 1500] as [number, number, number, number, number]));
    const r = readChop({ bars: [...warm, ...today], day: "2026-09-29", atr: 0.6, rvol: 1.4, structure: "HH/HL" });
    expect(r.chop).toBe(false);
    expect(r.score).toBeLessThan(25);
  });
  it("does not judge the first half hour", () => {
    expect(readChop({ bars: session([[100, 101, 99, 100.5], [100.5, 101, 100, 100.2]]), day: "2026-09-29", atr: 1, rvol: 1, structure: "N/A" }).measured).toBe(false);
  });
  it("counts failed breakout attempts", () => {
    const flat = Array.from({ length: 14 }, () => [100, 100.4, 99.6, 100] as [number, number, number, number]);
    expect(failedAttempts(session([...flat, [100, 101, 99.9, 100.9], [100.9, 101, 100, 100.1], [100.1, 100.3, 99.8, 100]]))).toBe(1);
    expect(failedAttempts(session(flat))).toBe(0);
  });
});

describe("bias with memory", () => {
  const s = (label: string, structure: "HH/HL" | "LH/LL" | "RANGE" = "RANGE") => ({ label, structure });
  it("does not flip on one candle", () => {
    const r = stableBias([s("Bullish", "HH/HL"), s("Bullish", "HH/HL"), s("Bullish", "HH/HL"), s("Bearish", "HH/HL")]);
    expect(r.bias).toBe("BULLISH");
    expect(r.momentum).toBe("BEARISH");
    expect(r.note).toMatch(/Bearish momentum is building, but the bullish structure has not broken/);
    expect(r.changes).toBe(0);
  });
  it("holds while the structure still points the old way, however many reads disagree", () => {
    const r = stableBias([s("Bullish", "HH/HL"), s("Bullish", "HH/HL"), s("Bearish", "HH/HL"), s("Bearish", "HH/HL"), s("Bearish", "HH/HL"), s("Bearish", "HH/HL")]);
    expect(r.bias).toBe("BULLISH");
  });
  it("flips once the structure has turned and the reads agree", () => {
    const r = stableBias([s("Bullish", "HH/HL"), s("Bullish", "HH/HL"), s("Bearish", "LH/LL"), s("Bearish", "LH/LL")]);
    expect(r.bias).toBe("BEARISH");
    expect(r.changes).toBe(1);
  });
  it("needs three firm reads when the structure is only a range", () => {
    expect(stableBias([s("Bullish"), s("Bullish"), s("Bearish"), s("Bearish")]).bias).toBe("BULLISH");
    expect(stableBias([s("Bullish"), s("Bullish"), s("Bearish"), s("Bearish"), s("Bearish")]).bias).toBe("BEARISH");
  });
  it("ignores slight reads and starts neutral", () => {
    expect(stableBias([s("Slightly Bullish"), s("Slightly Bullish"), s("Slightly Bullish")]).bias).toBe("NEUTRAL");
    expect(stableBias([]).bias).toBe("NEUTRAL");
  });
});

describe("market context", () => {
  it("is against only when every leg disagrees", () => {
    expect(readMarket("long", [{ symbol: "SPY", aboveVwap: false, changePct: -0.4 }, { symbol: "QQQ", aboveVwap: false, changePct: -0.2 }]).aligned).toBe(false);
    expect(readMarket("long", [{ symbol: "SPY", aboveVwap: true, changePct: 0.1 }, { symbol: "QQQ", aboveVwap: false, changePct: -0.2 }]).aligned).toBeNull();
    expect(readMarket("short", [{ symbol: "SPY", aboveVwap: false, changePct: -0.4 }, { symbol: "QQQ", aboveVwap: false, changePct: -0.2 }]).aligned).toBe(true);
    expect(readMarket("long", [{ symbol: "SPY", aboveVwap: null, changePct: null }]).aligned).toBeNull();
  });
  it("maps names to a sector fund and lets the index funds check each other", () => {
    expect(sectorEtf("NVDA")).toBe("SMH");
    expect(marketSymbols("NVDA")).toEqual(["SPY", "QQQ", "SMH"]);
    expect(marketSymbols("SPY")).toEqual(["QQQ"]);
    expect(marketSymbols("ZZZZ")).toEqual(["SPY", "QQQ"]);
  });
});

describe("quality score", () => {
  const good: QualityInput = {
    direction: "long", structure5: "HH/HL", structure15: "HH/HL", roomGrade: "GOOD", rrToT1: 2.6, levelStrength: 85, vwapDistAtr: 1.2,
    rvol: 1.4, recentVolX: 1.6, macdWith: true, rsi: 62, emaWith: true,
    market: { aligned: true, score: 100, legs: [{ symbol: "SPY", with: true, detail: "" }] }, tfWith: 5, tfAgainst: 0, tfMeasured: 5, chop: false, premarket: false,
  };
  it("rates a clean setup Strong", () => {
    const q = scoreQuality(good);
    expect(q.label).toBe("Strong");
    expect(q.score).toBeGreaterThanOrEqual(85);
    expect(q.caps).toEqual([]);
  });
  it("lets price structure outrank the indicators", () => {
    const q = scoreQuality({ ...good, structure5: "LH/LL", structure15: "LH/LL" });
    expect(q.structureAgainst).toBe(true);
    expect(q.label).toBe("Weak");
    expect(q.score).toBeLessThanOrEqual(45);
    expect(q.caps[0]).toMatch(/structure is lower highs and lower lows/);
  });
  it("cannot be inflated by piling up momentum indicators", () => {
    const allMomentum = scoreQuality({ ...good, structure5: "RANGE", structure15: "RANGE", roomGrade: "TIGHT", rrToT1: 1.1, levelStrength: 40, rvol: 0.85, recentVolX: 0.8, tfWith: 1, tfAgainst: 2, market: { aligned: null, score: 50, legs: [] } });
    expect(allMomentum.categories.find((c) => c.key === "momentum")?.score).toBe(100);
    expect(allMomentum.score).toBeLessThan(55);
  });
  it("applies the chop, premarket, volume and market ceilings", () => {
    expect(scoreQuality({ ...good, chop: true }).score).toBeLessThanOrEqual(35);
    expect(scoreQuality({ ...good, premarket: true }).score).toBeLessThanOrEqual(55);
    expect(scoreQuality({ ...good, rvol: 0.6 }).score).toBeLessThanOrEqual(60);
    expect(scoreQuality({ ...good, market: { aligned: false, score: 0, legs: [] } }).score).toBeLessThanOrEqual(60);
  });
});

describe("the read", () => {
  const plan = { trigger: 101, invalidation: 100.4, targets: [104, 106, 108] };
  const q = scoreQuality({
    direction: "long", structure5: "HH/HL", structure15: "HH/HL", roomGrade: "GOOD", rrToT1: 2.6, levelStrength: 85, vwapDistAtr: 1.2, rvol: 1.4, recentVolX: 1.6,
    macdWith: true, rsi: 62, emaWith: true, market: flatMarket, tfWith: 4, tfAgainst: 0, tfMeasured: 5, chop: false, premarket: false,
  });
  const common = { direction: "long" as const, plan, atr: 1, vwap: 100, rvol: 1.4, session: "rth", minutes: 640, marketOpen: true, quality: q, chop: noChop, bias: bull, market: flatMarket, ema9: 101.2, structure5: "HH/HL" as const };
  const confirmed = readBreakout({ direction: "long", trigger: 101, invalidation: 100.4, atr: 1, vwap: 100, rvol: 1.4, slotBaseline: baseline, marketAligned: null, bars: session([[100.5, 101.6, 100.4, 101.4, 1800], [101.4, 102.1, 101.2, 101.9]]) });
  const attempt = readBreakout({ direction: "long", trigger: 101, invalidation: 100.4, atr: 1, vwap: 100, rvol: 1.4, slotBaseline: baseline, marketAligned: null, bars: session([[100.5, 101.6, 100.4, 101.4, 1800]]) });

  it("says CALL only once the break is confirmed and the setup is sound", () => {
    expect(buildRead({ ...common, price: 101.9, breakout: confirmed }).call).toBe("CALL");
    const waiting = buildRead({ ...common, price: 101.4, breakout: attempt });
    expect(waiting.call).toBe("WAIT");
    expect(waiting.waitingFor[0]).toMatch(/next 5m candle to hold above \$101\.00/);
  });
  it("waits when a confirmed break has slipped back to the wrong side of the level", () => {
    const r = buildRead({ ...common, price: 100.8, breakout: confirmed });
    expect(r.call).toBe("WAIT");
    expect(r.reason).toMatch(/retest in progress/);
    expect(r.waitingFor[0]).toMatch(/5m close back above \$101\.00 that holds/);
  });
  it("says DO NOT CHASE when the entry has run away, and how to get another", () => {
    const r = buildRead({ ...common, price: 103.2, breakout: confirmed });
    expect(r.call).toBe("DO NOT CHASE");
    expect(r.reason).toMatch(/bullish, entry missed/);
    expect(r.waitingFor[0]).toMatch(/pullback toward \$101\.00/);
  });
  it("says NO TRADE in chop and after a failed breakout", () => {
    const chop: ChopRead = { chop: true, score: 60, signals: [{ key: "vwap-cross", text: "4 VWAP crossings in the last hour", weight: 20 }], measured: true };
    expect(buildRead({ ...common, price: 100.6, breakout: readBreakout({ direction: "long", trigger: 101, invalidation: 100.4, atr: 1, vwap: 100, rvol: 1, slotBaseline: baseline, marketAligned: null, bars: session([[100, 100.6, 99.8, 100.5]]) }), chop }).call).toBe("NO TRADE");
    const failed = readBreakout({ direction: "long", trigger: 101, invalidation: 100.4, atr: 1, vwap: 100, rvol: 1, slotBaseline: baseline, marketAligned: null, bars: session([[100.5, 101.6, 100.4, 101.4, 1800], [101.4, 101.5, 100.6, 100.7]]) });
    const r = buildRead({ ...common, price: 100.7, breakout: failed });
    expect(r.call).toBe("NO TRADE");
    expect(r.reason).toMatch(/failed breakout/);
  });
  it("holds a weak confirmed setup and a premarket one at WAIT", () => {
    const weak = scoreQuality({ direction: "long", structure5: "LH/LL", structure15: "RANGE", roomGrade: "OK", rrToT1: 2, levelStrength: 70, vwapDistAtr: 1, rvol: 1.2, recentVolX: 1.2, macdWith: true, rsi: 60, emaWith: true, market: flatMarket, tfWith: 3, tfAgainst: 1, tfMeasured: 5, chop: false, premarket: false });
    const w = buildRead({ ...common, quality: weak, structure5: "LH/LL", price: 101.9, breakout: confirmed });
    expect(w.call).toBe("WAIT");
    expect(w.why.some((l) => /momentum improving, but bearish structure remains/.test(l.text))).toBe(true);
    const pre = buildRead({ ...common, session: "premarket", minutes: 500, price: 101.9, breakout: confirmed });
    expect(pre.call).toBe("WAIT");
    expect(pre.warnings[0]).toMatch(/Premarket: lower confidence/);
    const busy = buildRead({ ...common, session: "premarket", minutes: 500, rvol: 2.4, price: 100.2, breakout: null });
    expect(busy.warnings[0]).toMatch(/unusually strong volume \(2\.40x\)/);
    expect(busy.reason).toMatch(/^premarket, lower confidence/);
  });
  it("has nothing to trade without a level", () => {
    const r = buildRead({ ...common, plan: null, price: 100, breakout: null, quality: null });
    expect(r.call).toBe("NO TRADE");
    expect(r.state).toBe("NO SETUP");
  });
});

describe("assembled read and outcomes", () => {
  it("judges the breakout only on closed bars from the moment the level was chosen", () => {
    const yesterday = Array.from({ length: 78 }, (_, i) => bar(et(9, 30, "2026-09-28") + i * 300_000, 100, 100.4, 99.6, 100 + Math.sin(i / 5) * 0.2));
    const today = session([[100, 101.8, 99.9, 101.6, 2500], [101.6, 101.7, 100.5, 100.6], [100.6, 100.9, 100.4, 100.7], [100.7, 101.7, 100.6, 101.5, 1900]]);
    const a = assembleRead({
      day: "2026-09-29", nowMs: et(9, 48), session: "rth", marketOpen: true, direction: "long", plan: { trigger: 101, invalidation: 100.4, targets: [104], rewardToTargets: [{ rr: 5 }] },
      lockedAtMs: et(9, 45), price: 101.5, atr: 1, vwap: 100.5, rvol: 1.2, bars5: [...yesterday, ...today], slotBaseline: baseline, marketLegs: [], rows: [], room: null, levelStrength: 80, biasSamples: [],
    });
    // The 9:30 break and its failure happened before the level was locked, and the 9:45 bar is still forming.
    expect(a.read.breakout?.state).toBe("WATCHING");
    expect(a.read.call).toBe("WAIT");
    expect(a.features.minutes).toBe(588);
  });
  it("scores an entry in R with its worst and best excursion", () => {
    const m1 = Array.from({ length: 30 }, (_, i) => bar(et(10, 0) + i * 60_000, 101.5 + i * 0.1, 101.7 + i * 0.1, 101.3 + i * 0.1, 101.6 + i * 0.1));
    const win = resolveOutcome({ direction: "long", price: 101.5, trigger: 101, invalidation: 100.5, targets: [103.5], t: et(10, 0) }, m1)!;
    expect(win.result).toBe("WIN");
    expect(win.r).toBe(2);
    expect(win.maeR).toBeCloseTo(0.2, 1);
    const down = Array.from({ length: 10 }, (_, i) => bar(et(10, 0) + i * 60_000, 101.5 - i * 0.2, 101.6 - i * 0.2, 101.2 - i * 0.2, 101.3 - i * 0.2));
    const loss = resolveOutcome({ direction: "long", price: 101.5, trigger: 101, invalidation: 100.5, targets: [103.5], t: et(10, 0) }, down)!;
    expect(loss.result).toBe("LOSS");
    expect(loss.r).toBe(-1);
    expect(loss.falseBreak).toBe(true);
  });
  it("averages each slot's volume over the sessions before the day", () => {
    const h = [bar(et(9, 30, "2026-09-25"), 1, 1, 1, 1, 100), bar(et(9, 30, "2026-09-28"), 1, 1, 1, 1, 300), bar(et(9, 30, "2026-09-29"), 1, 1, 1, 1, 9999)];
    expect(slotBaselineBefore(h, "2026-09-29").get(570)).toBe(200);
  });
  it("keeps a failed level on screen for two bars, and lets go of a level when the trend turns first", () => {
    const failed = { breakout: { state: "FAILED BREAKOUT", failedAt: et(10, 0) }, bias: { bias: "BULLISH" } };
    expect(releaseReason(failed, "long", et(10, 5))).toBeNull();
    expect(releaseReason(failed, "long", et(10, 10))).toBe("failed breakout");
    expect(releaseReason({ breakout: { state: "TESTING", failedAt: null }, bias: { bias: "BEARISH" } }, "long", et(10, 0))).toBe("trend changed before the break");
    expect(releaseReason({ breakout: { state: "BREAK ATTEMPT", failedAt: null }, bias: { bias: "BEARISH" } }, "long", et(10, 0))).toBeNull();
    expect(releaseReason({ breakout: { state: "WATCHING", failedAt: null }, bias: { bias: "NEUTRAL" } }, "long", et(10, 0))).toBeNull();
  });
});
