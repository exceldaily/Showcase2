import { describe, expect, it } from "vitest";
import { anchoredVwap, swingAnchoredVwap, swingLowIndex } from "../vwap";
import { detectBreakout, detectPrimed } from "../alerts";
import { computeMetricsFromBars } from "../polygon";
import type { Bar } from "../bars";

function bar(o: number, h: number, l: number, c: number, v = 2_000_000): Bar {
  return { o, h, l, c, v, vw: (h + l + c) / 3, t: 0 };
}

describe("anchored VWAP", () => {
  it("finds the swing low index", () => {
    const bars = [bar(10, 11, 9, 10), bar(10, 11, 7, 8), bar(9, 12, 9, 11)];
    expect(swingLowIndex(bars)).toBe(1);
  });
  it("weights by volume from the anchor forward", () => {
    const bars = [bar(10, 10, 10, 10, 1000), bar(20, 20, 20, 20, 3000)];
    // anchor at index 0: (10*1000 + 20*3000)/4000 = 17.5
    expect(anchoredVwap(bars, 0)).toBe(17.5);
  });
  it("reports rising VWAP when price climbs off the low", () => {
    const bars: Bar[] = [];
    for (let i = 0; i < 30; i++) bars.push(bar(100 + i, 101 + i, 99 + i, 100 + i));
    expect(swingAnchoredVwap(bars).rising).toBe(true);
  });
});

// Build a coil: strong uptrend, then 8 tight sessions just under a
// clear prior high.
function primedSeries(): Bar[] {
  const arr: Bar[] = [];
  // 40-session climb 60 -> 100 sets the trend + EMA stack
  for (let i = 0; i < 40; i++) {
    const c = 60 + i;
    arr.push(bar(c - 0.5, c + 0.5, c - 1, c, 2_000_000));
  }
  // a resistance spike to 108, then pull back to form the lid
  arr.push(bar(100, 108, 100, 101, 3_000_000));
  for (let i = 0; i < 12; i++) arr.push(bar(101, 102, 100, 101, 1_500_000));
  // tight coil at ~104, just under the 108 lid
  for (let i = 0; i < 8; i++) arr.push(bar(104, 105, 103.5, 104.3, 1_800_000));
  return arr;
}

describe("detectPrimed", () => {
  it("flags a tight coil under resistance with the EMA stack + VWAP aligned", () => {
    const bars = primedSeries();
    const m = computeMetricsFromBars("TEST", bars);
    const primed = detectPrimed(m, bars);
    expect(primed).not.toBeNull();
    expect(primed!.type).toBe("Primed");
    expect(primed!.resistance).toBeGreaterThan(m.price);
    expect(primed!.distanceToBreakoutPct).toBeGreaterThanOrEqual(0);
    expect(primed!.strength).toBeGreaterThan(40);
  });
  it("stays silent on a downtrend (no EMA stack)", () => {
    const bars: Bar[] = [];
    for (let i = 0; i < 60; i++) {
      const c = 200 - i;
      bars.push(bar(c + 0.5, c + 1, c - 0.5, c));
    }
    const m = computeMetricsFromBars("DOWN", bars);
    expect(detectPrimed(m, bars)).toBeNull();
  });
});

describe("detectBreakout", () => {
  it("fires when price closes above the 20-session high on volume", () => {
    const bars = primedSeries();
    // the trigger bar: gap through the 108 lid on heavy volume
    bars.push(bar(105, 112, 105, 111, 6_000_000));
    const m = computeMetricsFromBars("TEST", bars);
    const bo = detectBreakout(m, bars);
    expect(bo).not.toBeNull();
    expect(bo!.type).toBe("Breakout");
    expect(bo!.strength).toBeGreaterThan(55);
  });
});
