import { describe, expect, it } from "vitest";
import { liveCandle, quoteStaleMs } from "../liveCandle";
import { etOffsetMs } from "../intraday";
import type { Bar } from "../bars";

const bar = (t: number, o: number, h: number, l: number, c: number): Bar => ({ t, o, h, l, c, v: 100, vw: c });
const T0 = Date.parse("2026-09-08T14:00:00Z"); // 10:00 ET
const bars = [bar(T0 - 300e3, 100, 101, 99, 100.5), bar(T0, 100.5, 100.9, 100.2, 100.7)];

describe("liveCandle", () => {
  it("patches the current 5-minute candle with a newer print", () => {
    const b = liveCandle(bars, { t: T0 + 120e3, price: 101.3 }, 300e3)!;
    expect(b.t).toBe(T0);
    expect(b.h).toBe(101.3);
    expect(b.c).toBe(101.3);
    expect(b.l).toBe(100.2);
  });
  it("opens a fresh candle when the print is in the next bucket", () => {
    const b = liveCandle(bars, { t: T0 + 330e3, price: 100.1 }, 300e3)!;
    expect(b.t).toBe(T0 + 300e3);
    expect(b.o).toBe(100.1);
    expect(b.v).toBe(0);
  });
  it("ignores stale prints and bad prices; daily just patches the last bar", () => {
    expect(liveCandle(bars, { t: T0 - 1, price: 100 }, 300e3)).toBeNull();
    expect(liveCandle(bars, { t: T0 + 1, price: 0 }, 300e3)).toBeNull();
    expect(liveCandle([], { t: T0 + 1, price: 5 }, 300e3)).toBeNull();
    const d = liveCandle(bars, { t: T0 + 10 * 3600e3, price: 99 }, null)!;
    expect(d.t).toBe(T0);
    expect(d.l).toBe(99);
  });
  it("stale threshold is tighter during regular hours", () => {
    expect(quoteStaleMs("rth")).toBe(10_000);
    expect(quoteStaleMs("premarket")).toBe(90_000);
  });
});

describe("etOffsetMs", () => {
  it("is -4h in summer (EDT) and -5h in winter (EST)", () => {
    expect(etOffsetMs(Date.parse("2026-09-08T14:00:00Z"))).toBe(-4 * 3600e3);
    expect(etOffsetMs(Date.parse("2026-01-15T14:00:00Z"))).toBe(-5 * 3600e3);
  });
});
