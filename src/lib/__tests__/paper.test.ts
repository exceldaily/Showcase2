import { describe, expect, it } from "vitest";
import { tryExit, tryFill } from "../paper";
import type { Bar } from "../bars";

function bar(o: number, h: number, l: number, c: number): Bar {
  return { o, h, l, c, v: 1_000_000, vw: c, t: Date.now() };
}

describe("tryFill (long)", () => {
  it("fills at the open when the open is inside or below the zone", () => {
    const f = tryFill("Long", 99, 101, bar(100, 105, 99.5, 104));
    expect(f.filled).toBe(true);
    expect(f.price).toBe(100);
  });
  it("fills at the zone edge when price tags the zone intraday", () => {
    const f = tryFill("Long", 99, 101, bar(103, 104, 100.5, 102));
    expect(f.filled).toBe(true);
    expect(f.price).toBe(101);
  });
  it("does not fill when the bar never reaches the zone", () => {
    expect(tryFill("Long", 99, 101, bar(104, 106, 102, 105)).filled).toBe(false);
  });
});

describe("tryFill (short)", () => {
  it("fills at the open when the open is inside or above the zone", () => {
    const f = tryFill("Short", 99, 101, bar(100, 101, 96, 97));
    expect(f.filled).toBe(true);
    expect(f.price).toBe(100);
  });
  it("fills at the zone edge on an intraday bounce into the zone", () => {
    const f = tryFill("Short", 99, 101, bar(97, 99.5, 96, 98));
    expect(f.filled).toBe(true);
    expect(f.price).toBe(99);
  });
  it("does not fill when the bounce never reaches the zone", () => {
    expect(tryFill("Short", 99, 101, bar(97, 98, 95, 96)).filled).toBe(false);
  });
});

describe("tryExit", () => {
  it("long: stop takes precedence when both stop and target hit in one bar", () => {
    const e = tryExit("Long", 95, 105, 110, bar(100, 111, 94, 108), 3);
    expect(e.exited).toBe(true);
    expect(e.reason).toBe("Stop");
    expect(e.price).toBe(95);
  });
  it("long: exits at target 2 and records the win", () => {
    const e = tryExit("Long", 95, 105, 110, bar(106, 111, 105, 109), 4);
    expect(e.reason).toBe("Target");
    expect(e.price).toBe(110);
    expect(e.t1Hit).toBe(true);
  });
  it("short: exits at target when price falls through it", () => {
    const e = tryExit("Short", 105, 95, 90, bar(94, 96, 88, 89), 2);
    expect(e.reason).toBe("Target");
    expect(e.price).toBe(90);
  });
  it("records a T1 touch without exiting", () => {
    const e = tryExit("Long", 95, 105, 110, bar(104, 106, 103, 105.5), 2);
    expect(e.exited).toBe(false);
    expect(e.t1Hit).toBe(true);
  });
  it("time-exits at the close after the max hold", () => {
    const e = tryExit("Long", 95, 105, 110, bar(100, 102, 99, 101), 20);
    expect(e.reason).toBe("Time");
    expect(e.price).toBe(101);
  });
});
