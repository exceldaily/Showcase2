import { describe, expect, it } from "vitest";
import { coachVerdict, strikeChoices, type CoachCandidate } from "../strikeCoach";

// 10:00 ET on a same-day expiry: ~6 hours of life left.
const NOW = Date.parse("2026-09-08T14:00:00Z");
const EXP = "2026-09-08";
const c = (strike: number, mid: number, delta: number): CoachCandidate => ({
  symbol: `NVDA260908C${String(strike * 1000).padStart(8, "0")}`, side: "call", strike, expiry: EXP, dte: 0, mid, iv: 0.45, delta, breakEven: strike + mid,
});
const chain = [c(230, 4.9, 0.92), c(232.5, 2.58, 0.8), c(235, 0.99, 0.47), c(237.5, 0.24, 0.16), c(240, 0.05, 0.04)];

describe("strikeChoices", () => {
  it("lines up recommended, cheaper (at the target) and safer (one strike in the money)", () => {
    const out = strikeChoices({ side: "call", candidates: chain, best: chain[2], underlying: 234.76, target: 237.4, wrong: 232.9, now: NOW, stepMinutes: 30 });
    expect(out.map((o) => `${o.label}:${o.strike}`)).toEqual(["Recommended:235", "Cheaper:237.5", "Safer:232.5"]);
    const [rec, cheap, safe] = out;
    // Cheaper wins on percent if the move comes fast, dies if it only arrives by the close, and burns faster sitting still.
    expect(cheap.atTarget!.pct).toBeGreaterThan(rec.atTarget!.pct);
    expect(cheap.atTargetClose!.value).toBe(0);
    expect(rec.atTargetClose!.value).toBeCloseTo(2.4, 2);
    expect(Math.abs(cheap.flatHour!.pct)).toBeGreaterThan(Math.abs(rec.flatHour!.pct));
    expect(Math.abs(safe.flatHour!.pct)).toBeLessThan(Math.abs(rec.flatHour!.pct));
    expect(safe.atWrong!.pct).toBeGreaterThan(rec.atWrong!.pct); // loses less
    expect(cheap.plain).toMatch(/long shot/);
    expect(rec.perContract).toBe(99);
  });
  it("handles a missing target or the edge of the chain", () => {
    const out = strikeChoices({ side: "call", candidates: chain, best: chain[0], underlying: 234.76, target: null, wrong: null, now: NOW });
    expect(out.map((o) => o.label)).toEqual(["Recommended"]); // no target => no cheaper; nothing further ITM
    expect(out[0].atTarget).toBeNull();
  });
  it("mirrors for puts", () => {
    const puts: CoachCandidate[] = [232.5, 235, 237.5].map((k) => ({ symbol: `P${k}`, side: "put", strike: k, expiry: EXP, dte: 0, mid: k === 235 ? 1.1 : k === 237.5 ? 2.7 : 0.3, iv: 0.45, delta: -0.5, breakEven: k - 1 }));
    const out = strikeChoices({ side: "put", candidates: puts, best: puts[1], underlying: 234.76, target: 232.2, wrong: 236.5, now: NOW });
    expect(out.map((o) => `${o.label}:${o.strike}`)).toEqual(["Recommended:235", "Cheaper:232.5", "Safer:237.5"]);
  });
  it("writes an honest verdict", () => {
    const out = strikeChoices({ side: "call", candidates: chain, best: chain[2], underlying: 234.76, target: 237.4, wrong: 232.9, now: NOW, stepMinutes: 30 });
    const v = coachVerdict(out, "NVDA")!;
    expect(v).toMatch(/Cheaper is not free money/);
    expect(v).toMatch(/worth \$0/);
    expect(v).toMatch(/Same bet, more dice/);
    expect(v).not.toMatch(/will/);
  });
});
