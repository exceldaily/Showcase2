import { describe, expect, it } from "vitest";
import type { Bar } from "../bars";
import { backtestBreakouts, expectedFractionFromProfile, rvolFromProfile, volumeProfileFromMinutes, PROFILE_BINS } from "../historyStats";

function session(dateUtc: string, shape: (i: number) => number, vol: (i: number) => number): Bar[] {
  const start = Date.parse(`${dateUtc}T13:30:00Z`); // 9:30 ET (September)
  return Array.from({ length: 390 }, (_, i) => {
    const c = shape(i);
    return { t: start + i * 60e3, o: c - 0.02, h: c + 0.05, l: c - 0.05, c, v: vol(i), vw: c };
  });
}

describe("volume profile", () => {
  it("builds a cumulative 26-bin profile that ends at 1 and reflects a front-loaded day", () => {
    const days: Bar[] = [];
    for (let d = 1; d <= 8; d++) {
      days.push(...session(`2026-09-0${d}`, () => 100, (i) => (i < 30 ? 50_000 : 5_000)));
    }
    const vp = volumeProfileFromMinutes(days)!;
    expect(vp.sessions).toBe(8);
    expect(vp.profile.length).toBe(PROFILE_BINS);
    expect(vp.profile[PROFILE_BINS - 1]).toBeCloseTo(1, 5);
    expect(vp.profile[1]).toBeGreaterThan(0.4); // first 30 min carried most volume
    expect(expectedFractionFromProfile(vp.profile, 390)).toBeCloseTo(1, 5);
    expect(expectedFractionFromProfile(vp.profile, 0)).toBeCloseTo(0, 5);
  });

  it("needs at least 5 complete sessions", () => {
    expect(volumeProfileFromMinutes(session("2026-09-01", () => 100, () => 1000))).toBeNull();
  });

  it("rvol against the symbol's own profile is 1.0 on a normal-shaped day", () => {
    const days: Bar[] = [];
    for (let d = 1; d <= 6; d++) days.push(...session(`2026-09-0${d}`, () => 100, (i) => (i < 30 ? 50_000 : 5_000)));
    const vp = volumeProfileFromMinutes(days)!;
    const dailyAvg = 30 * 50_000 + 360 * 5_000;
    const at1000 = Date.parse("2026-09-08T14:00:00Z");
    const volBy10 = 30 * 50_000; // exactly the profile's expectation
    expect(rvolFromProfile(volBy10, dailyAvg, vp.profile, at1000)).toBeCloseTo(1, 1);
    expect(rvolFromProfile(volBy10 * 2, dailyAvg, vp.profile, at1000)).toBeCloseTo(2, 1);
  });
});

describe("breakout backtest", () => {
  it("replays sessions without touching the partial last day and reports sample sizes", () => {
    const days: Bar[] = [];
    const daily: Bar[] = [];
    for (let d = 1; d <= 9; d++) {
      const base = 100 + d;
      // Morning grind, midday breakout through the prior-day high on volume.
      days.push(...session(`2026-09-0${d}`, (i) => (i < 60 ? base + Math.sin(i / 5) * 0.2 : base + 0.3 + (i - 60) * 0.01), (i) => (i >= 60 && i < 90 ? 60_000 : 8_000)));
      daily.push({ t: Date.parse(`2026-09-0${d}T20:00:00Z`), o: base, h: base + 0.4, l: base - 0.5, c: base + 0.3, v: 6e6, vw: base });
    }
    const s = backtestBreakouts(days, daily, 40);
    expect(s.sessions).toBe(8); // day 9 excluded as the last (possibly partial) session
    expect(s.setups).toBeGreaterThanOrEqual(0);
    expect(s.confirmed).toBeLessThanOrEqual(s.setups);
    expect(s.t1Hit + s.failed).toBeLessThanOrEqual(s.confirmed);
  });
});
