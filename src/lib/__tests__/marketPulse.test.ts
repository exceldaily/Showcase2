import { describe, expect, it } from "vitest";
import type { Bar } from "../bars";
import {
  DEFAULT_MOMENTUM_WEIGHTS,
  classifyPulseRegime,
  momentumBand,
  momentumDayScore,
  optionsEnvironment,
  readTrend,
  type TrendRead,
} from "../marketPulse";

// ── Bar factories ──

function mkBars(closes: number[], volMult: (i: number) => number = () => 1): Bar[] {
  return closes.map((c, i) => ({
    o: c * 0.995,
    h: c * 1.01,
    l: c * 0.99,
    c,
    v: 1_000_000 * volMult(i),
    vw: c,
    t: Date.UTC(2026, 0, 1) + i * 86400e3,
  }));
}

const upBars = (n = 80) => mkBars(Array.from({ length: n }, (_, i) => 100 * Math.pow(1.008, i)));
const downBars = (n = 80) => mkBars(Array.from({ length: n }, (_, i) => 100 * Math.pow(0.992, i)));
const flatChopBars = (n = 80) =>
  mkBars(Array.from({ length: n }, (_, i) => 100 + (i % 2 === 0 ? 0.6 : -0.6)));

// ── readTrend ──

describe("readTrend", () => {
  it("returns null with insufficient history", () => {
    expect(readTrend("X", upBars(10))).toBeNull();
  });

  it("labels a steady uptrend bullish with multiple confirmations, never one signal", () => {
    const r = readTrend("UP", upBars())!;
    expect(["Bullish", "Strong Bullish"]).toContain(r.label);
    expect(r.bull).toBeGreaterThanOrEqual(3);
    expect(r.bear).toBeLessThanOrEqual(1);
  });

  it("labels a steady downtrend bearish", () => {
    const r = readTrend("DN", downBars())!;
    expect(["Bearish", "Strong Bearish"]).toContain(r.label);
  });

  it("labels alternating flat action as Chop, not Neutral drift", () => {
    const r = readTrend("CHOP", flatChopBars())!;
    expect(r.label).toBe("Chop");
    expect(r.flips).toBeGreaterThanOrEqual(4);
  });

  it("strong labels require elevated volume, not just price direction", () => {
    // Same trend, dead volume on the last bar -> cannot be Strong.
    const bars = upBars();
    bars[bars.length - 1] = { ...bars[bars.length - 1], v: 100_000 };
    const r = readTrend("UPLOWVOL", bars)!;
    expect(r.label).not.toBe("Strong Bullish");
  });
});

// ── classifyPulseRegime ──

const bullRead = (sym = "SPY"): TrendRead => readTrend(sym, upBars())!;
const bearRead = (sym = "SPY"): TrendRead => readTrend(sym, downBars())!;
const chopRead = (sym = "SPY"): TrendRead => readTrend(sym, flatChopBars())!;

describe("classifyPulseRegime", () => {
  it("aligned bullish everything => Strong Bullish", () => {
    const r = classifyPulseRegime({
      spy: bullRead("SPY"),
      qqq: bullRead("QQQ"),
      stock: bullRead("TEST"),
      breadth: { advancersPct: 74, upVolumePct: 78 },
      sector: { name: "Semis", score: 82, change5d: 6 },
      vix: { level: 14, prev: 15 },
    });
    expect(r.regime).toBe("Strong Bullish");
  });

  it("aligned bearish everything => Strong Bearish (downside is an environment, not an error)", () => {
    const r = classifyPulseRegime({
      spy: bearRead("SPY"),
      qqq: bearRead("QQQ"),
      stock: bearRead("TEST"),
      breadth: { advancersPct: 22, upVolumePct: 18 },
      sector: { name: "Semis", score: 25, change5d: -8 },
      vix: { level: 31, prev: 26 },
    });
    expect(r.regime).toBe("Strong Bearish");
  });

  it("above VWAP alone is NOT enough: one bullish stock in a mixed tape stays non-strong", () => {
    const r = classifyPulseRegime({
      spy: chopRead("SPY"),
      qqq: chopRead("QQQ"),
      stock: bullRead("TEST"),
      breadth: { advancersPct: 50, upVolumePct: 51 },
      vix: { level: 19, prev: 19 },
    });
    expect(["Neutral", "Chop", "Bullish"]).toContain(r.regime);
    expect(r.regime).not.toBe("Strong Bullish");
  });

  it("whipsawing indices with split breadth => Chop", () => {
    const r = classifyPulseRegime({
      spy: chopRead("SPY"),
      qqq: chopRead("QQQ"),
      breadth: { advancersPct: 50, upVolumePct: 50 },
      vix: { level: 19, prev: 19 },
    });
    expect(r.regime).toBe("Chop");
  });

  it("reports unmeasured inputs instead of guessing", () => {
    const r = classifyPulseRegime({ spy: bullRead("SPY"), qqq: null, breadth: null, vix: null });
    expect(r.notMeasured.join(" ")).toMatch(/QQQ/);
    expect(r.notMeasured.join(" ")).toMatch(/breadth/i);
    expect(r.notMeasured.join(" ")).toMatch(/VIX/);
  });
});

// ── momentumDayScore ──

function fastBars(): Bar[] {
  // Trending hard with a volume surge on the final bar and a gap.
  const closes = Array.from({ length: 80 }, (_, i) => 10 * Math.pow(1.012, i));
  const bars = mkBars(closes, (i) => (i >= 79 ? 6 : 1));
  const lastBar = bars[bars.length - 1];
  bars[bars.length - 1] = { ...lastBar, o: bars[bars.length - 2].c * 1.05, h: lastBar.h * 1.04 };
  return bars;
}

describe("momentumDayScore", () => {
  it("high-volume trending stock scores well above a dead one", () => {
    const hot = momentumDayScore({
      stock: readTrend("HOT", fastBars())!,
      spy: bullRead("SPY"),
      qqq: bullRead("QQQ"),
      sectorAligned: true,
      breadth: { advancersPct: 70, upVolumePct: 72 },
      vixMoving: true,
      catalystFound: true,
      intraday: null,
    });
    const dead = momentumDayScore({
      stock: readTrend("DEAD", flatChopBars())!,
      spy: chopRead("SPY"),
      qqq: chopRead("QQQ"),
      sectorAligned: false,
      breadth: { advancersPct: 50, upVolumePct: 50 },
      vixMoving: false,
      catalystFound: false,
      intraday: null,
    });
    expect(hot.score).toBeGreaterThan(dead.score + 25);
    expect(hot.score).toBeGreaterThanOrEqual(61);
    expect(dead.score).toBeLessThanOrEqual(40);
  });

  it("is direction-agnostic: a fast DOWN move scores like a fast UP move", () => {
    const downFast = mkBars(
      Array.from({ length: 80 }, (_, i) => 50 * Math.pow(0.988, i)),
      (i) => (i >= 79 ? 6 : 1)
    );
    const dLast = downFast[downFast.length - 1];
    downFast[downFast.length - 1] = { ...dLast, o: downFast[downFast.length - 2].c * 0.95, l: dLast.l * 0.96 };
    const up = momentumDayScore({
      stock: readTrend("UPFAST", fastBars())!,
      spy: bullRead("SPY"), qqq: bullRead("QQQ"), sectorAligned: true, intraday: null,
    });
    const down = momentumDayScore({
      stock: readTrend("DNFAST", downFast)!,
      spy: bearRead("SPY"), qqq: bearRead("QQQ"), sectorAligned: true, intraday: null,
    });
    expect(Math.abs(up.score - down.score)).toBeLessThanOrEqual(20);
    expect(down.score).toBeGreaterThanOrEqual(50);
  });

  it("excludes unmeasured components instead of zeroing them", () => {
    const r = momentumDayScore({
      stock: readTrend("HOT", fastBars())!,
      spy: null, qqq: null, sectorAligned: null, intraday: null,
    });
    expect(r.notMeasured.join(" ")).toMatch(/Opening range/);
    const usedWeight = r.components.reduce((a, c) => a + c.weightPct, 0);
    expect(usedWeight).toBeLessThan(100); // opening-range weight renormalized away
    expect(r.score).toBeGreaterThan(0);
  });

  it("weights are configurable, not hardcoded into the math", () => {
    const stock = readTrend("HOT", fastBars())!;
    const base = { stock, spy: null, qqq: null, sectorAligned: null, intraday: null } as const;
    const rvolOnly = momentumDayScore(base, { ...DEFAULT_MOMENTUM_WEIGHTS, rvol: 100, gapAndPremarket: 0, vwapStructure: 0, emaStructure: 0, openingRange: 0, indexAlignment: 0, macdAcceleration: 0, atrExpansion: 0, context: 0 });
    expect(rvolOnly.score).toBe(Math.round(rvolOnly.components[0].value01 * 100));
  });

  it("bands match the documented ranges", () => {
    expect(momentumBand(10)).toBe("Dead / Avoid");
    expect(momentumBand(30)).toBe("Low Momentum");
    expect(momentumBand(50)).toBe("Normal");
    expect(momentumBand(70)).toBe("Active");
    expect(momentumBand(85)).toBe("High Momentum");
    expect(momentumBand(95)).toBe("Extreme Momentum");
  });
});

// ── optionsEnvironment ──

describe("optionsEnvironment", () => {
  it("Strong Bearish + extreme momentum is A+ (great put environment), not Avoid", () => {
    expect(optionsEnvironment("Strong Bearish", 91).grade).toBe("A+");
  });
  it("Bullish direction with weak momentum grades C (bad for short-dated options)", () => {
    expect(optionsEnvironment("Bullish", 28).grade).toBe("C");
  });
  it("Chop is Avoid no matter the momentum", () => {
    expect(optionsEnvironment("Chop", 88).grade).toBe("Avoid");
  });
  it("dead tape is Avoid even when directional", () => {
    expect(optionsEnvironment("Strong Bullish", 15).grade).toBe("Avoid");
  });
  it("directional + active momentum is A", () => {
    expect(optionsEnvironment("Bullish", 68).grade).toBe("A");
  });
  it("neutral direction caps at C", () => {
    expect(optionsEnvironment("Neutral", 80).grade).toBe("C");
  });
});
