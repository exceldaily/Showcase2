import { describe, expect, it } from "vitest";
import { countdownLabel, etToIso, fromFredRelease, minutesToNextEvent, viewEvents, type CatalystEvent } from "../catalysts";
import { classify, marketEvidence, tickerEvidence, type Evidence } from "../marketState";
import { detectTransitions, type AlertSnapshot } from "../alertTransitions";
import type { MatrixRow } from "../timeframeMatrix";

describe("catalysts", () => {
  it("maps FRED releases to typical ET times and impact, ignoring noise", () => {
    const cpi = fromFredRelease(10, "Consumer Price Index", "2026-09-16");
    expect(cpi?.impact).toBe("HIGH");
    expect(cpi?.typicalTime).toBe(true);
    expect(new Date(cpi!.at).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })).toBe("8:30 AM");
    expect(fromFredRelease(1, "H.4.1 Factors Affecting Reserve Balances", "2026-09-17")).toBeNull();
    expect(fromFredRelease(2, "Some Unknown Series", "2026-09-17")).toBeNull();
    expect(fromFredRelease(3, "FOMC Press Release", "2026-09-17")?.at).toBe(etToIso("2026-09-17", "14:00"));
    // Winter: EST is UTC-5.
    expect(etToIso("2026-01-15", "08:30")).toBe("2026-01-15T13:30:00.000Z");
    expect(etToIso("2026-07-15", "08:30")).toBe("2026-07-15T12:30:00.000Z");
  });
  it("views events with countdowns and finds the next high-impact one", () => {
    const now = Date.parse("2026-09-16T13:00:00Z");
    const events: CatalystEvent[] = [
      { id: "a", at: "2026-09-16T12:30:00Z", title: "CPI", impact: "HIGH", source: "fred", affects: "market", typicalTime: true },
      { id: "b", at: "2026-09-16T14:00:00Z", title: "Earnings NVDA", impact: "HIGH", source: "manual", affects: "NVDA", typicalTime: false },
      { id: "c", at: "2026-09-16T18:00:00Z", title: "FOMC", impact: "HIGH", source: "fred", affects: "market", typicalTime: true },
      { id: "a", at: "2026-09-16T12:30:00Z", title: "dup", impact: "HIGH", source: "fred", affects: "market", typicalTime: true },
    ];
    const v = viewEvents(events, now, "TSLA");
    expect(v.map((e) => e.id)).toEqual(["a", "c"]);
    expect(v[0].countdown).toBe("past");
    expect(v[1].countdown).toBe("5h 00m");
    expect(countdownLabel(12)).toBe("12m");
    expect(minutesToNextEvent(events, now, "HIGH", "NVDA")?.minutes).toBe(60);
    expect(minutesToNextEvent(events, Date.parse("2026-09-16T23:00:00Z"))).toBeNull();
  });
});

const row = (tf: MatrixRow["tf"], trend: MatrixRow["trend"], macd: MatrixRow["macd"] = "POS", structure: MatrixRow["structure"] = "HH/HL"): MatrixRow => ({
  tf, bars: 80, trend, momentum: "BULL", vwap: "ABOVE", vwapPct: 0.3, ema: "STACKED UP", macd, structure, support: 99, resistance: 102, setup: null, detail: "",
});

describe("market state", () => {
  it("classifies weighted evidence and returns for/against lists", () => {
    const ev: Evidence[] = [
      { text: "a", dir: "bull", weight: 2, source: "x" }, { text: "b", dir: "bull", weight: 2, source: "x" },
      { text: "c", dir: "bull", weight: 2, source: "x" }, { text: "d", dir: "bear", weight: 1, source: "x" }, { text: "e", dir: "flat", weight: 1, source: "x" },
    ];
    const s = classify(ev);
    expect(s.state).toBe("BULLISH");
    expect(s.evidenceFor).toHaveLength(3);
    expect(s.evidenceAgainst.map((e) => e.text)).toEqual(["d"]);
    expect(classify(ev.map((e) => ({ ...e, dir: e.dir === "bear" ? "flat" : e.dir }))).state).toBe("STRONG BULL");
    expect(classify(ev.map((e) => ({ ...e, dir: e.dir === "bull" ? "bear" : e.dir === "bear" ? "bull" : e.dir }))).state).toBe("BEARISH");
    expect(classify([{ text: "a", dir: "bull", weight: 2, source: "x" }, { text: "b", dir: "bear", weight: 2, source: "x" }], [], 2).state).toBe("CHOP");
    expect(classify([]).state).toBe("NEUTRAL");
  });
  it("builds ticker evidence from matrix rows, VWAP and levels, listing what is not measured", () => {
    const t = tickerEvidence({ rows: [row("5m", "BULL"), row("15m", "BULL"), row("1h", "NEUTRAL", "FLAT", "RANGE"), row("D", "BULL")], price: 101, vwap: 100, rvol: 1.4, trendLabel: "Bullish", choppy: false, changePct: 1, prevHigh: 100.5, prevLow: 98 });
    const s = classify(t.evidence, t.notMeasured, t.chopSignals);
    expect(["BULLISH", "STRONG BULL"]).toContain(s.state);
    expect(s.evidenceFor.some((e) => /Above VWAP/.test(e.text))).toBe(true);
    expect(s.evidenceFor.some((e) => /yesterday's high/.test(e.text))).toBe(true);
    const missing = tickerEvidence({ rows: [], price: null, vwap: null, rvol: null, trendLabel: null, choppy: false, changePct: null, prevHigh: null, prevLow: null });
    expect(missing.notMeasured).toEqual(["VWAP", "5m trend", "15m trend", "1h trend", "daily trend", "relative volume"]);
  });
  it("adds QQQ, VIX and breadth for the broad market", () => {
    const m = marketEvidence({
      spy: { rows: [row("5m", "BEAR", "NEG", "LH/LL"), row("15m", "BEAR", "NEG", "LH/LL"), row("D", "NEUTRAL", "FLAT", "RANGE")], price: 99, vwap: 100, rvol: 1.2, trendLabel: "Bearish", choppy: false, changePct: -0.8, prevHigh: 101, prevLow: 98 },
      qqqChangePct: -1.1, spyChangePct: -0.8, vix: { level: 19, prevClose: 17 }, vix1d: { level: 14, prevClose: 13 }, breadth: { advancersPct: 35, upVolumePct: 30, asOf: "2026-09-15" },
    });
    const s = classify(m.evidence, m.notMeasured, m.chopSignals);
    expect(["BEARISH", "STRONG BEAR"]).toContain(s.state);
    expect(s.evidenceFor.some((e) => /VIX 19/.test(e.text))).toBe(true);
    expect(s.evidenceFor.some((e) => /Breadth 35%/.test(e.text))).toBe(true);
    expect(s.notMeasured).toContain("NYSE TICK");
  });
});

describe("alert transitions", () => {
  const base: AlertSnapshot = { symbol: "NVDA", price: 210, vwap: 209, rvol: 1.2, direction: "long", lifecycle: "WATCHING", machineState: "WATCHING", trigger: 211, invalidation: 210.2, target1: 213, support: 208, resistance: 211, minutesToEvent: null };
  it("emits lifecycle, crossing, volume and catalyst alerts once each", () => {
    expect(detectTransitions(null, base)).toEqual([]);
    const a = detectTransitions(base, { ...base, lifecycle: "APPROACHING" });
    expect(a.map((e) => e.kind)).toEqual(["APPROACHING_TRIGGER"]);
    const b = detectTransitions({ ...base, lifecycle: "APPROACHING", price: 210.9 }, { ...base, lifecycle: "APPROACHING", price: 211.05 });
    expect(b.map((e) => e.kind)).toEqual(["TRIGGER_TOUCHED", "RESISTANCE_BROKEN"].filter((k) => k !== "RESISTANCE_BROKEN"));
    const c = detectTransitions({ ...base, lifecycle: "TRIGGERED", price: 211.2 }, { ...base, lifecycle: "CONFIRMED", price: 211.5, rvol: 1.6 });
    expect(c.map((e) => e.kind)).toEqual(["CONFIRMED", "VOLUME_CONFIRMED"]);
    const d = detectTransitions({ ...base, lifecycle: "CONFIRMED", price: 211.5 }, { ...base, lifecycle: "CONFIRMED", price: 210.1 });
    expect(d.map((e) => e.kind)).toEqual(["INVALIDATION_REACHED"]);
    const e = detectTransitions({ ...base, price: 209.5 }, { ...base, price: 208.5 });
    expect(e.map((x) => x.kind)).toEqual(["VWAP_LOST"]);
    const f = detectTransitions({ ...base, price: 208.5 }, { ...base, price: 207.9 });
    expect(f.map((x) => x.kind)).toEqual(["SUPPORT_BROKEN"]);
    const g = detectTransitions({ ...base, minutesToEvent: 40 }, { ...base, minutesToEvent: 12 });
    expect(g.map((x) => x.kind)).toEqual(["CATALYST_SOON"]);
    const h = detectTransitions({ ...base, lifecycle: "CONFIRMED" }, { ...base, lifecycle: "INVALIDATED", machineState: "FAILED" });
    expect(h[0].kind).toBe("SETUP_INVALIDATED");
    expect(h[0].urgency).toBe("high");
  });
});
