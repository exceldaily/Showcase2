import { describe, expect, it } from "vitest";
import { contractQuality, contractWarnings, distanceToBreakEvenPct, tagContracts, type RankableContract } from "../contractRank";

const mk = (over: Partial<RankableContract>): RankableContract => ({
  symbol: `NVDA${over.strike ?? 210}C`, side: "call", strike: 210, expiry: "2026-09-16", dte: 0.3, mid: 2, spreadPct: 3, volume: 2000, openInterest: 8000,
  iv: 0.5, delta: 0.5, gamma: 0.05, theta: -0.2, vega: 0.05, score: 70, stale: false, breakEven: 212, ...over,
});

describe("contract ranking layer", () => {
  it("tags best, alternatives, aggressive and conservative", () => {
    const list = [
      mk({ strike: 212.5, delta: 0.48, mid: 2, score: 82 }),
      mk({ strike: 215, delta: 0.36, mid: 1.2, gamma: 0.06, score: 74 }),
      mk({ strike: 210, delta: 0.6, mid: 3.1, score: 70 }),
      mk({ strike: 217.5, delta: 0.25, mid: 0.7, gamma: 0.07, score: 61 }),
      mk({ strike: 205, delta: 0.78, mid: 6, score: 55 }),
    ];
    const tags = tagContracts(list);
    expect(tags.get("NVDA212.5C")).toBe("BEST");
    expect(tags.get("NVDA215C")).toBe("ALTERNATIVE");
    expect(tags.get("NVDA210C")).toBe("ALTERNATIVE");
    expect(tags.get("NVDA217.5C")).toBe("AGGRESSIVE");
    expect(tags.get("NVDA205C")).toBe("CONSERVATIVE");
    expect(tagContracts([]).size).toBe(0);
  });
  it("warns about spreads, liquidity, IV, theta and premium", () => {
    const w = contractWarnings(mk({ spreadPct: 12, volume: 5, openInterest: 20, iv: 2.1, theta: -0.4, mid: 2 }), 4, 200);
    expect(w.map((x) => x.key)).toEqual(["spread", "oi", "volume", "liquidity", "iv", "theta"]);
    expect(contractWarnings(mk({ mid: 30 }), 4, 200).map((x) => x.key)).toEqual(["premium"]);
    expect(contractWarnings(mk({}), 4, 200)).toEqual([]);
  });
  it("computes quality metrics and break-even distance", () => {
    const q = contractQuality(mk({}), 4);
    expect(q.liquidity).toBeGreaterThan(80);
    expect(q.spreadQuality).toBe(63);
    expect(q.thetaImpactPct).toBe(10);
    expect(q.directionalSensitivity).toBe(0.53);
    expect(q.overall).toBe(70);
    expect(distanceToBreakEvenPct(mk({ breakEven: 212 }), 210)).toBe(0.95);
    expect(distanceToBreakEvenPct(mk({ side: "put", breakEven: 208 }), 210)).toBe(0.95);
    expect(distanceToBreakEvenPct(mk({}), null)).toBeNull();
  });
});
