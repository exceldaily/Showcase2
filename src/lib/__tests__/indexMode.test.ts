import { describe, expect, it } from "vitest";
import { scaleBar, resolveIndex } from "../indexMode";
import { cboeRowToSnapshot, cboeTimeToIso, filterCboeRows } from "@/providers/cboe";

const row = (option: string, bid: number, ask: number) => ({
  option, bid, bid_size: 1, ask, ask_size: 1, iv: 0.163, open_interest: 1588, volume: 8932,
  delta: 0.517, gamma: 0.0089, vega: 1.0973, theta: -17.01, rho: 0,
  last_trade_price: 15.5, last_trade_time: "2026-09-09T15:59:30", open: 25.9, high: 28.2, low: 12.5, prev_day_close: 16.9,
});

describe("index mode", () => {
  it("resolves SPX and SPXW to the SPY proxy with the CBOE feed", () => {
    expect(resolveIndex("SPX")?.proxy).toBe("SPY");
    expect(resolveIndex("SPXW")?.cboe).toBe("_SPX");
    expect(resolveIndex("NVDA")).toBeNull();
  });
  it("scales ETF bars into index points and keeps volume", () => {
    const b = scaleBar({ t: 1, o: 760, h: 761, l: 759, c: 760.5, v: 1000, vw: 760.2 }, 10.02);
    expect(b.c).toBeCloseTo(7620.21, 2);
    expect(b.v).toBe(1000);
  });
});

describe("cboe mapping", () => {
  it("converts Eastern wall-clock stamps to real instants", () => {
    expect(cboeTimeToIso("2026-09-09T16:14:59")).toBe("2026-09-09T20:14:59.000Z"); // EDT
    expect(cboeTimeToIso("2026-01-15 10:00:00")).toBe("2026-01-15T15:00:00.000Z"); // EST
  });
  it("filters the chain by expiry window and strike band, dropping dead quotes", () => {
    const rows = [
      row("SPXW260910C07650000", 18.6, 18.8),
      row("SPXW260911C07650000", 30, 31),
      row("SPX260918C07650000", 60, 62),
      row("SPXW260910C09000000", 0.05, 0.1), // outside strike band
      row("SPXW260910P07600000", 0, 0),       // no quote
    ];
    const kept = filterCboeRows(rows, { strikeGte: 7400, strikeLte: 7900, expirationLte: "2026-09-12" });
    expect(kept.map((r) => r.option)).toEqual(["SPXW260910C07650000", "SPXW260911C07650000"]);
  });
  it("shapes a row like an Alpaca snapshot so scoring needs no special case", () => {
    const s = cboeRowToSnapshot(row("SPXW260910C07650000", 18.6, 18.8), "2026-09-10T13:00:00.000Z");
    expect(s.latestQuote).toMatchObject({ bp: 18.6, ap: 18.8 });
    expect(s.greeks?.delta).toBe(0.517);
    expect(s.impliedVolatility).toBe(0.163);
    expect(s.dailyBar?.v).toBe(8932);
  });
});
