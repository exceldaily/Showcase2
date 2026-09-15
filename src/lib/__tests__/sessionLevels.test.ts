import { describe, expect, it } from "vitest";
import { sessionLevels } from "../sessionLevels";
import type { Bar } from "../bars";

// 2026-09-15 is a Tuesday. ET = UTC-4 in September.
const et = (h: number, m: number, dayOffset = 0) => Date.UTC(2026, 8, 15 + dayOffset, h + 4, m);
const bar = (t: number, o: number, h: number, l: number, c: number): Bar => ({ t, o, h, l, c, v: 1000, vw: c });

describe("sessionLevels", () => {
  const daily: Bar[] = [bar(et(0, 0, -2), 100, 104, 98, 103), bar(et(0, 0, -1), 103, 106, 101, 105)];
  const m1: Bar[] = [
    bar(et(17, 0, -1), 105, 107, 104.5, 106),  // yesterday after hours (overnight)
    bar(et(7, 0), 106, 108, 105.5, 107),        // premarket
    bar(et(9, 0), 107, 107.5, 106, 106.5),      // premarket
    bar(et(9, 30), 106.5, 109, 106, 108),       // RTH opening range
    bar(et(9, 40), 108, 110, 107.5, 109.5),
    bar(et(9, 50), 109.5, 111, 109, 110.5),     // after the 15-minute range
  ];
  it("reads prev day, premarket, overnight, opening range and today", () => {
    const s = sessionLevels(m1, daily, et(10, 0));
    expect(s.day).toBe("2026-09-15");
    expect(s.prevHigh).toBe(106);
    expect(s.prevLow).toBe(101);
    expect(s.prevClose).toBe(105);
    expect(s.premarketHigh).toBe(108);
    expect(s.premarketLow).toBe(105.5);
    expect(s.overnightHigh).toBe(108);
    expect(s.overnightLow).toBe(104.5);
    expect(s.openingRangeHigh).toBe(110);
    expect(s.openingRangeLow).toBe(106);
    expect(s.openingRangeComplete).toBe(true);
    expect(s.todayHigh).toBe(111);
    expect(s.todayLow).toBe(106);
    expect(s.todayOpen).toBe(106.5);
  });
  it("is null, not guessed, when the bars do not exist", () => {
    const s = sessionLevels([bar(et(9, 31), 1, 2, 1, 2)], [], et(9, 32));
    expect(s.prevHigh).toBeNull();
    expect(s.premarketHigh).toBeNull();
    expect(s.openingRangeComplete).toBe(false);
    expect(sessionLevels([], daily, et(10, 0)).day).toBeNull();
  });
});
