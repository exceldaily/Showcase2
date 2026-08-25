import { describe, expect, it } from "vitest";
import { buildSweepRow, catalystStatusFrom, CATALYST_FRESH_HOURS } from "../marketSweep";
import { evaluateGroup, type RuleGroup } from "../scannerRules";

const NOW = new Date("2026-08-25T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600e3).toISOString();

describe("catalystStatusFrom", () => {
  it("unknown when never checked", () => {
    expect(catalystStatusFrom(undefined, NOW)).toBeUndefined();
  });
  it("Found for a fresh article", () => {
    expect(
      catalystStatusFrom({ checked_at: hoursAgo(1), published_at: hoursAgo(10) }, NOW)
    ).toBe("Found");
  });
  it("None when checked recently but the article is stale", () => {
    expect(
      catalystStatusFrom({ checked_at: hoursAgo(1), published_at: hoursAgo(CATALYST_FRESH_HOURS + 1) }, NOW)
    ).toBe("None");
  });
  it("None when checked recently and no article at all", () => {
    expect(catalystStatusFrom({ checked_at: hoursAgo(1), published_at: null }, NOW)).toBe("None");
  });
  it("back to unknown when the check itself is too old", () => {
    expect(
      catalystStatusFrom({ checked_at: hoursAgo(24 * 8), published_at: hoursAgo(24 * 8) }, NOW)
    ).toBeUndefined();
  });
});

describe("buildSweepRow", () => {
  const raw = {
    symbol: "TEST",
    open: "10.50",
    close: "11.00",
    volume: "5000000",
    prev_close: "10.00",
    avg_vol: "1000000",
    hist_n: "20",
  };

  it("computes price, change, gap, dollar volume and rvol", () => {
    const r = buildSweepRow(raw);
    expect(r.price).toBe(11);
    expect(r.changePct).toBe(10);
    expect(r.gapPct).toBe(5);
    expect(r.dollarVolume).toBe(55_000_000);
    expect(r.rvol).toBe(5);
  });

  it("leaves rvol unknown with a thin baseline (fails closed in rules)", () => {
    const r = buildSweepRow({ ...raw, hist_n: "5" });
    expect(r.rvol).toBeUndefined();
    const g: RuleGroup = { logic: "AND", conditions: [{ field: "rvol", op: "gte", value: 1 }] };
    expect(evaluateGroup(g, r).pass).toBe(false);
  });

  it("leaves change unknown without a previous close", () => {
    const r = buildSweepRow({ ...raw, prev_close: null });
    expect(r.changePct).toBeUndefined();
    expect(r.gapPct).toBeUndefined();
  });

  it("uses shares outstanding as a conservative float upper bound", () => {
    const r = buildSweepRow(raw, { shares_outstanding: "15000000", float_shares: null });
    expect(r.floatShares).toBe(15_000_000);
    const r2 = buildSweepRow(raw, { shares_outstanding: "50000000", float_shares: "12000000" });
    expect(r2.floatShares).toBe(12_000_000); // true float wins when known
  });

  it("attaches catalyst status only when known", () => {
    expect(buildSweepRow(raw).catalystStatus).toBeUndefined();
    expect(buildSweepRow(raw, undefined, "Found").catalystStatus).toBe("Found");
  });

  it("passes the whole 5-point checklist end to end", () => {
    const fivePoint: RuleGroup = {
      logic: "AND",
      conditions: [
        { field: "price", op: "between", value: 2, value2: 20 },
        { field: "changePct", op: "gte", value: 10 },
        { field: "rvol", op: "gte", value: 5 },
        { field: "floatShares", op: "lt", value: 20e6, soft: true },
        { field: "catalystStatus", op: "eq", value: "Found", soft: true },
      ],
    };
    const row = buildSweepRow(raw, { shares_outstanding: "15000000" }, "Found");
    const res = evaluateGroup(fivePoint, row);
    expect(res.pass).toBe(true);
    expect(res.criteriaMet).toBe(5);
    expect(res.criteriaUnknown).toBe(0);
  });
});
