import { describe, expect, it } from "vitest";
import type { Bar } from "../bars";
import {
  blackScholes, breakEvenAtExpiry, buildOcc, dte, extrinsicValue, impliedVol,
  intrinsicValue, isQuoteStale, moneyness, parseOcc, scenarioPrice, spreadPct,
} from "../optionsMath";
import { SCORE_PROFILES, scoreContract, type ContractFacts } from "../optionsScore";
import {
  buildLevels, etStamp, expectedVolumeFraction, openingRange, resample,
  sessionOf, sessionVwapSeries, timeAdjustedRvol,
} from "../intraday";
import {
  DEFAULT_BREAKOUT_CONFIG, buildTradePlan, initialMachine, roomToMove, runMachine,
  stepMachine, opportunityScore, type SetupContext,
} from "../setupMachine";
import type { LevelZone } from "../intraday";

// ── OCC + quote math ──

describe("optionsMath", () => {
  it("parses and rebuilds OCC symbols", () => {
    const p = parseOcc("NVDA260911P00230000")!;
    expect(p).toEqual({ underlying: "NVDA", expiry: "2026-09-11", side: "put", strike: 230 });
    expect(buildOcc(p)).toBe("NVDA260911P00230000");
    expect(parseOcc("GARBAGE")).toBeNull();
  });

  it("intrinsic/extrinsic/breakeven/moneyness", () => {
    expect(intrinsicValue("call", 100, 105)).toBe(5);
    expect(intrinsicValue("put", 100, 105)).toBe(0);
    expect(extrinsicValue("call", 100, 105, 6.5)).toBeCloseTo(1.5);
    expect(breakEvenAtExpiry("call", 100, 3.2)).toBeCloseTo(103.2);
    expect(breakEvenAtExpiry("put", 100, 3.2)).toBeCloseTo(96.8);
    expect(moneyness("call", 100, 105)).toBe("ITM");
    expect(moneyness("put", 100, 105)).toBe("OTM");
    expect(moneyness("call", 100, 100.2)).toBe("ATM");
    expect(spreadPct(1.0, 1.1)).toBeCloseTo(9.52, 1);
  });

  it("Black-Scholes matches a known reference value", () => {
    // S=100 K=100 T=1y sigma=20% r=5%: call ~10.45, put ~5.57 (textbook)
    const c = blackScholes("call", 100, 100, 1, 0.2, 0.05);
    const p = blackScholes("put", 100, 100, 1, 0.2, 0.05);
    expect(c.price).toBeCloseTo(10.45, 1);
    expect(p.price).toBeCloseTo(5.57, 1);
    expect(c.delta).toBeCloseTo(0.637, 2);
    expect(c.gamma).toBeGreaterThan(0);
    expect(c.theta).toBeLessThan(0);
    expect(c.vega).toBeGreaterThan(0);
  });

  it("implied vol round-trips a BS price", () => {
    const price = blackScholes("call", 230, 232, 0.05, 0.35).price;
    const iv = impliedVol("call", 230, 232, 0.05, price)!;
    expect(iv).toBeCloseTo(0.35, 2);
  });

  it("scenario engine returns honest ranges that respect direction", () => {
    const input = { side: "call" as const, strike: 230, expiry: "2026-09-18", iv: 0.4, currentMid: 3.5, underlyingNow: 229 };
    const up = scenarioPrice(input, 233, 30, "T1");
    const down = scenarioPrice(input, 226, 30, "INV");
    expect(up.high).toBeGreaterThanOrEqual(up.low);
    expect(up.midEstimate).toBeGreaterThan(down.midEstimate); // calls worth more up
    expect(up.method).toBe("bs-iv");
    // Without IV it implies from mid; without either it is intrinsic-only.
    const noIv = scenarioPrice({ ...input, iv: null }, 233, 30);
    expect(noIv.method).toBe("bs-implied-from-mid");
    const nothing = scenarioPrice({ ...input, iv: null, currentMid: null }, 233, 30);
    expect(nothing.method).toBe("intrinsic-only");
    expect(nothing.midEstimate).toBe(3); // 233-230
  });

  it("stale quotes are stale only while the market is open", () => {
    const old = Date.now() - 5 * 60_000;
    expect(isQuoteStale(old, Date.now(), true)).toBe(true);
    expect(isQuoteStale(old, Date.now(), false)).toBe(false);
    expect(isQuoteStale(null, Date.now(), true)).toBe(true);
  });

  it("dte counts forward only", () => {
    expect(dte("2020-01-01")).toBe(0);
    expect(dte("2099-01-01")).toBeGreaterThan(300);
  });
});

// ── Contract scoring ──

function facts(over: Partial<ContractFacts> = {}): ContractFacts {
  return {
    symbol: "NVDA260911C00230000", side: "call", strike: 230, expiry: "2026-09-11",
    bid: 3.5, ask: 3.6, last: 3.55, volume: 5000, openInterest: 8000, iv: 0.35,
    delta: 0.52, gamma: 0.03, theta: -0.25, vega: 0.1, greeksSource: "alpaca",
    quoteTs: Date.now(), underlying: 229.5, expectedMove: 2.5, stale: false,
    ...over,
  };
}

describe("contract scoring", () => {
  it("a liquid tight-spread ATM contract beats a wide illiquid far-OTM one", () => {
    const good = scoreContract(facts());
    const bad = scoreContract(facts({ strike: 260, bid: 0.05, ask: 0.25, volume: 12, openInterest: 30, delta: 0.04, expectedMove: 2.5 }));
    expect(good.total).toBeGreaterThan(bad.total + 25);
    expect(bad.penalties.join(" ")).toMatch(/OTM|spread|volume|interest/i);
  });

  it("a stale quote hard-caps the score", () => {
    const s = scoreContract(facts({ stale: true }));
    expect(s.total).toBeLessThanOrEqual(25);
    expect(s.penalties.join(" ")).toMatch(/STALE/);
  });

  it("profiles change the verdict (scalp punishes a 6% spread far harder)", () => {
    const wide = facts({ bid: 3.4, ask: 3.61 }); // ~6% spread
    const part = (profile: (typeof SCORE_PROFILES)["BALANCED"]) => {
      const sc = scoreContract(wide, profile);
      const sp = sc.parts.find((x) => x.name === "Spread")!;
      return sp.score / sp.max;
    };
    expect(part(SCORE_PROFILES.SCALP)).toBeLessThan(part(SCORE_PROFILES.BALANCED) - 0.15);
  });

  it("missing greeks degrade but never fabricate", () => {
    const s = scoreContract(facts({ delta: null, gamma: null, theta: null, greeksSource: "none" }));
    expect(s.total).toBeGreaterThan(0);
    expect(s.penalties.join(" ")).toMatch(/delta/i);
  });
});

// ── Intraday: sessions, VWAP, RVOL, levels ──

// Build a synthetic ET trading day of 1-minute bars.
function minuteDay(dateUtc: string, shape: (i: number) => number, vol: (i: number) => number = () => 10_000): Bar[] {
  // 9:30-16:00 ET in September = 13:30-20:00 UTC.
  const start = Date.parse(`${dateUtc}T13:30:00Z`);
  return Array.from({ length: 390 }, (_, i) => {
    const c = shape(i);
    return { t: start + i * 60e3, o: c - 0.02, h: c + 0.06, l: c - 0.06, c, v: vol(i), vw: c };
  });
}

describe("intraday engine", () => {
  it("classifies ET sessions correctly", () => {
    expect(sessionOf(Date.parse("2026-09-04T13:31:00Z"))).toBe("rth");       // 9:31 ET
    expect(sessionOf(Date.parse("2026-09-04T12:00:00Z"))).toBe("premarket"); // 8:00 ET
    expect(sessionOf(Date.parse("2026-09-04T21:00:00Z"))).toBe("afterhours");
    expect(sessionOf(Date.parse("2026-09-04T02:00:00Z"))).toBe("closed");
  });

  it("resamples 1m into 5m preserving OHLCV", () => {
    const day = minuteDay("2026-09-04", (i) => 100 + i * 0.01);
    const m5 = resample(day, 5);
    expect(m5.length).toBe(78);
    expect(m5[0].o).toBeCloseTo(day[0].o);
    expect(m5[0].c).toBeCloseTo(day[4].c);
    expect(m5[0].v).toBe(day.slice(0, 5).reduce((a, b) => a + b.v, 0));
  });

  it("session VWAP tracks heavy-volume prices and resets daily", () => {
    const d1 = minuteDay("2026-09-03", () => 100);
    const d2 = minuteDay("2026-09-04", () => 200);
    const vw = sessionVwapSeries([...d1, ...d2]);
    expect(vw[d1.length - 1]).toBeCloseTo(100, 0);
    expect(vw[vw.length - 1]).toBeCloseTo(200, 0);
  });

  it("opening range covers exactly the first N minutes", () => {
    const day = minuteDay("2026-09-04", (i) => (i < 5 ? 101 + i : 100));
    const or5 = openingRange(day, 5, "2026-09-04")!;
    expect(or5.high).toBeCloseTo(105.06, 1);
    expect(or5.complete).toBe(true);
  });

  it("time-adjusted RVOL compares against time-of-day expectations", () => {
    const tenAm = Date.parse("2026-09-04T14:00:00Z"); // 10:00 ET = 30 min in
    // Volume equal to 16% of avg daily at 10:00 = exactly normal pace.
    expect(timeAdjustedRvol(160_000, 1_000_000, tenAm)).toBeCloseTo(1, 1);
    expect(timeAdjustedRvol(480_000, 1_000_000, tenAm)).toBeCloseTo(3, 0);
    expect(expectedVolumeFraction(390)).toBe(1);
  });

  it("level engine clusters nearby prints into one zone and explains it", () => {
    // Price bangs against ~105 repeatedly then sits at 100.
    const day = minuteDay("2026-09-04", (i) => (i % 30 < 3 ? 104.95 + (i % 3) * 0.03 : 100 + (i % 7) * 0.05));
    const prevDay: Bar[] = [{ t: Date.parse("2026-09-03T20:00:00Z"), o: 99, h: 105.02, l: 97, c: 99.5, v: 5e6, vw: 100 }];
    const res = buildLevels({ minuteBars: day, dailyBars: prevDay })!;
    const resistances = res.zones.filter((z) => z.kind === "resistance" && Math.abs(z.price - 105) < 0.6);
    expect(resistances.length).toBe(1); // clustered, not five lines
    expect(resistances[0].strength).toBeGreaterThanOrEqual(50);
    expect(resistances[0].reasons.length).toBeGreaterThan(0);
    for (const z of res.zones) expect(z.reasons.length).toBeGreaterThan(0);
  });
});

// ── Setup machine ──

const ctx = (over: Partial<SetupContext> = {}): SetupContext => ({
  direction: "long", trigger: 105, invalidation: 104, atr: 0.5, vwap: 103, rvol: 2, ...over,
});
const bar = (o: number, h: number, l: number, c: number, v = 100_000): Bar => ({ t: 0, o, h, l, c, v, vw: c });

describe("breakout state machine", () => {
  it("a wick above resistance is NOT a breakout", () => {
    let ms = initialMachine();
    ms = stepMachine(ms, bar(104.6, 105.4, 104.5, 104.7), 0, ctx()); // wick through, close below
    expect(["FORMING", "APPROACHING"]).toContain(ms.state);
    expect(ms.state).not.toBe("CONFIRMED");
  });

  it("close beyond with volume and body confirms with quality", () => {
    let ms = initialMachine();
    ms = stepMachine(ms, bar(104.5, 104.8, 104.4, 104.7), 0, ctx());
    ms = stepMachine(ms, bar(104.7, 105.5, 104.7, 105.4), 1, ctx()); // strong close through
    expect(ms.state).toBe("CONFIRMED");
    expect(ms.quality).toBeGreaterThanOrEqual(70);
    expect(ms.checks.length).toBeGreaterThan(4);
  });

  it("weak-volume break only TRIGGERS, then FAILS on a close back under", () => {
    const c = ctx({ rvol: 0.6 });
    let ms = initialMachine();
    ms = stepMachine(ms, bar(104.9, 105.3, 104.6, 105.15, 20_000), 0, c); // thin break (body 64%, no rvol)
    expect(["TRIGGERED", "CONFIRMING"]).toContain(ms.state);
    ms = stepMachine(ms, bar(105.1, 105.2, 104.4, 104.6), 1, c);
    expect(ms.state).toBe("FAILED");
  });

  it("retest of the broken level that holds becomes CONTINUATION", () => {
    const c = ctx();
    let ms = initialMachine();
    ms = stepMachine(ms, bar(104.8, 105.6, 104.8, 105.5), 0, c); // confirm
    expect(ms.state).toBe("CONFIRMED");
    ms = stepMachine(ms, bar(105.5, 105.6, 104.95, 105.1), 1, c); // dips into retest zone
    expect(ms.state).toBe("RETESTING");
    ms = stepMachine(ms, bar(105.1, 105.9, 105.05, 105.8), 2, c); // buyers defend
    expect(ms.state).toBe("CONTINUATION");
  });

  it("a short setup is not INVALIDATED merely because price is above invalidation pre-trigger", () => {
    const c = ctx({ direction: "short", trigger: 95, invalidation: 96 });
    let ms = initialMachine();
    ms = stepMachine(ms, bar(100, 100.5, 99.5, 100), 0, c); // far above, just watching
    expect(ms.state).toBe("WATCHING");
  });

  it("no lookahead: state at bar i is identical when future bars are appended", () => {
    const c = ctx();
    const series = [
      bar(104.5, 104.8, 104.4, 104.7), bar(104.7, 105.5, 104.7, 105.4),
      bar(105.4, 105.6, 104.9, 105.1), bar(105.1, 106.2, 105.0, 106.1),
    ];
    for (let i = 1; i <= series.length; i++) {
      const partial = runMachine(series.slice(0, i), c);
      const fullPrefix = (() => {
        let ms = initialMachine();
        series.forEach((b, j) => {
          if (j < i) ms = stepMachine(ms, b, j, c);
        });
        return ms;
      })();
      expect(partial.state).toBe(fullPrefix.state);
      expect(partial.transitions).toEqual(fullPrefix.transitions);
    }
  });
});

// ── Room, plan, opportunity ──

const zone = (price: number, strength: number, kind: "support" | "resistance"): LevelZone => ({
  price, low: price - 0.1, high: price + 0.1, kind, strength, touches: 3,
  timeframes: ["5m", "15m"], sources: ["swing-high"], reasons: ["test"],
});

describe("room-to-move and trade plan", () => {
  it("flags poor location directly under major resistance", () => {
    const r = roomToMove(104.9, "long", [zone(105.1, 90, "resistance")], 0.5);
    expect(r.grade).toBe("POOR");
    expect(r.note).toMatch(/POOR LOCATION/);
  });

  it("rewards open air", () => {
    const r = roomToMove(100, "long", [zone(104, 90, "resistance")], 0.5);
    expect(r.grade).toBe("OPEN");
    expect(r.atrMultiple).toBeGreaterThan(3);
  });

  it("plan uses structural targets first, then daily-scale synthesis", () => {
    const zones = [zone(106, 80, "resistance"), zone(108, 85, "resistance")];
    const p = buildTradePlan("long", 105, zones, 0.1, DEFAULT_BREAKOUT_CONFIG, 60, 2.0);
    expect(p.targets[0]).toBe(106);
    expect(p.targets[1]).toBe(108);
    expect(p.targets[2]).toBeGreaterThan(108.5); // synthesized on the daily unit, not 10 cents
    expect(p.invalidation).toBeLessThan(105);
    expect(105 - p.invalidation).toBeGreaterThanOrEqual(105 * 0.0015 - 1e-9); // noise floor
    expect(p.rewardToTargets[0].rr).toBeGreaterThan(0);
  });

  it("opportunity score exposes its parts and never hides weakness", () => {
    const s = opportunityScore({
      trendConfidence: 80, trendAligned: true, setupQuality: 85, setupState: "CONFIRMED",
      rvol: 2.1, roomAtr: 2, rrToT1: 2, contractScore: 90, mtfAgreeingTimeframes: 3, slotPenalty: 0,
    });
    expect(s.total).toBeGreaterThan(75);
    const weak = opportunityScore({
      trendConfidence: 20, trendAligned: false, setupQuality: 0, setupState: "WATCHING",
      rvol: 0.6, roomAtr: 0.3, rrToT1: 0.5, contractScore: 30, mtfAgreeingTimeframes: 1, slotPenalty: 6,
    });
    expect(weak.total).toBeLessThan(30);
    expect(weak.parts.length).toBeGreaterThan(5);
  });
});

describe("et clock", () => {
  it("stamps ET dates across midnight UTC", () => {
    // 01:00 UTC Sept 5 = 21:00 ET Sept 4
    expect(etStamp(Date.parse("2026-09-05T01:00:00Z")).date).toBe("2026-09-04");
  });
});
