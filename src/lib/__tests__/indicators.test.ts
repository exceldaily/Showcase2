import { describe, expect, it } from "vitest";
import { computeMetricsFromBars } from "../polygon";

// Build a deterministic bar series: linear uptrend with constant volume.
function trendBars(days: number, start = 100, step = 1, volume = 2_000_000) {
  return Array.from({ length: days }, (_, i) => {
    const c = start + i * step;
    return { o: c - 0.5, h: c + 1, l: c - 1, c, v: volume, vw: c, t: i };
  });
}

describe("computeMetricsFromBars", () => {
  it("puts a steady uptrend above all moving averages", () => {
    const m = computeMetricsFromBars("TEST", trendBars(250));
    expect(m.price).toBe(349); // 100 + 249
    expect(m.above50d).toBe(true);
    expect(m.above200d).toBe(true);
    expect(m.ema9).toBeGreaterThan(m.ema50);
    expect(m.ema50).toBeGreaterThan(m.ema200);
  });

  it("RSI saturates high in a persistent uptrend and low in a downtrend", () => {
    const up = computeMetricsFromBars("UP", trendBars(60, 100, 1));
    const down = computeMetricsFromBars("DOWN", trendBars(60, 200, -1));
    expect(up.rsi14).toBeGreaterThan(80);
    expect(down.rsi14).toBeLessThan(20);
  });

  it("relative volume compares the last bar against the 30-day average", () => {
    const bars = trendBars(60);
    bars[bars.length - 1].v = 6_000_000; // 3x the constant 2M
    const m = computeMetricsFromBars("VOL", bars);
    expect(m.relVolume).toBeGreaterThan(2.5);
    expect(m.relVolume).toBeLessThan(3.5);
  });

  it("ATR reflects the constant 2-point true range", () => {
    const m = computeMetricsFromBars("ATR", trendBars(60));
    expect(m.atr14).toBeGreaterThan(1.5);
    expect(m.atr14).toBeLessThan(2.5);
  });
});
