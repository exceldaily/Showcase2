import { describe, expect, it } from "vitest";
import {
  atrSeries,
  bollingerSeries,
  detectExtension,
  emaSeries,
  findLevels,
  macdSeries,
  rsiSeries,
  smaSeries,
  vwapSeries,
} from "../indicators";
import type { Bar } from "../bars";

function bars(closes: number[], vol = 1_000_000): Bar[] {
  return closes.map((c, i) => ({ o: c, h: c * 1.01, l: c * 0.99, c, v: vol, vw: c, t: i * 86400000 }));
}

describe("moving averages", () => {
  it("SMA equals the arithmetic mean of the window", () => {
    const s = smaSeries([1, 2, 3, 4, 5], 3);
    expect(s[0]).toBeNull();
    expect(s[1]).toBeNull();
    expect(s[2]).toBe(2); // (1+2+3)/3
    expect(s[4]).toBe(4); // (3+4+5)/3
  });

  it("EMA is null before it has enough history, then tracks price", () => {
    const s = emaSeries([10, 11, 12, 13, 14, 15], 3);
    expect(s[0]).toBeNull();
    expect(s[1]).toBeNull();
    expect(s[2]).toBe(11); // seeded with SMA of first 3
    expect(s[5]).toBeGreaterThan(13);
  });

  it("EMA of a constant series equals the constant", () => {
    const s = emaSeries(new Array(30).fill(50), 9);
    expect(s[29]).toBe(50);
  });
});

describe("MACD", () => {
  it("returns aligned series with a histogram equal to macd minus signal", () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + i * 0.5);
    const { macd, signal, histogram } = macdSeries(closes);
    expect(macd).toHaveLength(80);
    const i = 79;
    expect(histogram[i]).toBeCloseTo((macd[i] as number) - (signal[i] as number), 1);
  });

  it("is positive in an uptrend and negative in a downtrend", () => {
    const up = macdSeries(Array.from({ length: 80 }, (_, i) => 100 + i));
    const down = macdSeries(Array.from({ length: 80 }, (_, i) => 200 - i));
    expect(up.macd[79]).toBeGreaterThan(0);
    expect(down.macd[79]).toBeLessThan(0);
  });
});

describe("RSI", () => {
  it("saturates high on a pure uptrend and low on a pure downtrend", () => {
    const up = rsiSeries(Array.from({ length: 40 }, (_, i) => 100 + i));
    const down = rsiSeries(Array.from({ length: 40 }, (_, i) => 200 - i));
    expect(up[39]).toBeGreaterThan(95);
    expect(down[39]).toBeLessThan(5);
  });
  it("is null before the seed period", () => {
    expect(rsiSeries([1, 2, 3], 14)[2]).toBeNull();
  });
});

describe("ATR", () => {
  it("measures a constant true range", () => {
    const b = bars(new Array(40).fill(100)); // h/l = ±1% => TR = 2
    const a = atrSeries(b, 14);
    expect(a[39]).toBeGreaterThan(1.5);
    expect(a[39]).toBeLessThan(2.5);
  });
});

describe("Bollinger", () => {
  it("collapses to the mean when volatility is zero", () => {
    const b = bollingerSeries(new Array(30).fill(50), 20);
    expect(b.upper[29]).toBe(50);
    expect(b.lower[29]).toBe(50);
  });
  it("brackets the middle band", () => {
    const b = bollingerSeries([10, 12, 11, 15, 9, 13, 11, 14, 10, 12, 16, 9, 13, 11, 15, 10, 12, 14, 11, 13], 20);
    expect(b.upper[19]!).toBeGreaterThan(b.middle[19]!);
    expect(b.lower[19]!).toBeLessThan(b.middle[19]!);
  });
});

describe("VWAP series", () => {
  it("volume-weights typical price cumulatively", () => {
    const b: Bar[] = [
      { o: 10, h: 10, l: 10, c: 10, v: 1000, vw: 10, t: 0 },
      { o: 20, h: 20, l: 20, c: 20, v: 3000, vw: 20, t: 1 },
    ];
    expect(vwapSeries(b)[1]).toBe(17.5); // (10*1000 + 20*3000)/4000
  });
});

describe("support/resistance levels", () => {
  it("identifies repeated pivots and counts touches", () => {
    // Oscillate to create repeated highs near 110 and lows near 90.
    const seq: number[] = [];
    for (let i = 0; i < 8; i++) seq.push(90, 95, 110, 95, 90);
    const levels = findLevels(bars(seq));
    expect(levels.length).toBeGreaterThan(0);
    expect(levels.every((l) => l.touches >= 2)).toBe(true);
  });
});

describe("extension detection", () => {
  it("flags a parabolic move away from structure", () => {
    const base = Array.from({ length: 40 }, () => 100);
    const spike = [110, 125, 145, 170, 200, 240];
    const ext = detectExtension(bars([...base, ...spike]));
    expect(ext).not.toBeNull();
    expect(["Parabolic", "Very Extended"]).toContain(ext!.state);
    expect(ext!.pct5BarMove).toBeGreaterThan(20);
  });

  it("calls a steady drift normal", () => {
    const ext = detectExtension(bars(Array.from({ length: 40 }, (_, i) => 100 + i * 0.1)));
    expect(ext!.state).toBe("Normal");
  });
});

// ── Preserved coverage: snapshot metrics used by the scanner ──
describe("computeMetricsFromBars (snapshot)", () => {
  function trendBars(days: number, start = 100, step = 1, volume = 2_000_000) {
    return Array.from({ length: days }, (_, i) => {
      const c = start + i * step;
      return { o: c - 0.5, h: c + 1, l: c - 1, c, v: volume, vw: c, t: i };
    });
  }

  it("puts a steady uptrend above all moving averages", async () => {
    const { computeMetricsFromBars } = await import("../polygon");
    const m = computeMetricsFromBars("TEST", trendBars(250));
    expect(m.price).toBe(349);
    expect(m.above50d).toBe(true);
    expect(m.above200d).toBe(true);
    expect(m.ema9).toBeGreaterThan(m.ema50);
  });

  it("RSI saturates high in an uptrend and low in a downtrend", async () => {
    const { computeMetricsFromBars } = await import("../polygon");
    expect(computeMetricsFromBars("UP", trendBars(60, 100, 1)).rsi14).toBeGreaterThan(80);
    expect(computeMetricsFromBars("DOWN", trendBars(60, 200, -1)).rsi14).toBeLessThan(20);
  });

  it("relative volume compares the last bar to the 30-day average", async () => {
    const { computeMetricsFromBars } = await import("../polygon");
    const b = trendBars(60);
    b[b.length - 1].v = 6_000_000;
    const m = computeMetricsFromBars("VOL", b);
    expect(m.relVolume).toBeGreaterThan(2.5);
    expect(m.relVolume).toBeLessThan(3.5);
  });

  it("ATR reflects the constant true range", async () => {
    const { computeMetricsFromBars } = await import("../polygon");
    const m = computeMetricsFromBars("ATR", trendBars(60));
    expect(m.atr14).toBeGreaterThan(1.5);
    expect(m.atr14).toBeLessThan(2.5);
  });
});
