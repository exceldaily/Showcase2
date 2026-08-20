import { describe, expect, it } from "vitest";
import { evaluateCondition, evaluateGroup, fieldsUsed, runScanner } from "../scannerRules";
import { getSessionState, etParts, isTradingDay } from "../session";
import { floatCategory } from "../metrics";
import { availableEntitlements } from "../fields";

describe("scanner rule engine", () => {
  const row = { price: 3.5, rvol: 4.2, changePct: 18, floatShares: undefined, emaState: "9>20>50" };

  it("evaluates numeric operators", () => {
    expect(evaluateCondition({ field: "price", op: "gt", value: 2 }, row).pass).toBe(true);
    expect(evaluateCondition({ field: "price", op: "lt", value: 2 }, row).pass).toBe(false);
    expect(evaluateCondition({ field: "price", op: "between", value: 1, value2: 5 }, row).pass).toBe(true);
  });

  it("FAILS CLOSED on missing data instead of passing", () => {
    const r = evaluateCondition({ field: "floatShares", op: "lt", value: 50_000_000 }, row);
    expect(r.pass).toBe(false);
    expect(r.missing).toBe(true);
  });

  it("reports missing fields from a group so the UI can warn", () => {
    const res = evaluateGroup(
      { logic: "AND", conditions: [{ field: "price", op: "gt", value: 1 }, { field: "floatShares", op: "lt", value: 1e7 }] },
      row
    );
    expect(res.pass).toBe(false);
    expect(res.missingFields).toContain("floatShares");
  });

  it("handles AND vs OR", () => {
    const conds = [
      { field: "price", op: "gt" as const, value: 100 }, // false
      { field: "rvol", op: "gt" as const, value: 2 },    // true
    ];
    expect(evaluateGroup({ logic: "AND", conditions: conds }, row).pass).toBe(false);
    expect(evaluateGroup({ logic: "OR", conditions: conds }, row).pass).toBe(true);
  });

  it("matches enum and in-list operators", () => {
    expect(evaluateCondition({ field: "emaState", op: "eq", value: "9>20>50" }, row).pass).toBe(true);
    expect(evaluateCondition({ field: "emaState", op: "in", values: ["9>20", "9>20>50"] }, row).pass).toBe(true);
  });

  it("produces an explanation for every condition (WHY panel)", () => {
    const res = evaluateGroup({ logic: "AND", conditions: [{ field: "rvol", op: "gte", value: 3 }] }, row);
    expect(res.explain[0].label).toBe("RVOL");
    expect(res.explain[0].expected).toContain("3");
    expect(res.explain[0].actual).toBe("4.20");
  });

  it("filters a row set", () => {
    const rows = [{ symbol: "A", rvol: 5 }, { symbol: "B", rvol: 1 }];
    const out = runScanner(rows, { logic: "AND", conditions: [{ field: "rvol", op: "gte", value: 3 }] });
    expect(out).toHaveLength(1);
    expect(out[0].row.symbol).toBe("A");
  });

  it("lists fields used including nested groups", () => {
    const used = fieldsUsed({
      logic: "AND",
      conditions: [{ field: "price", op: "gt", value: 1 }],
      groups: [{ logic: "OR", conditions: [{ field: "rvol", op: "gt", value: 2 }] }],
    });
    expect(used.sort()).toEqual(["price", "rvol"]);
  });
});

describe("market session", () => {
  it("classifies premarket, regular, after-hours on a weekday", () => {
    // 2026-08-17 is a Monday. Times given in UTC (ET = UTC-4 in August).
    expect(getSessionState(new Date("2026-08-17T12:00:00Z")).session).toBe("premarket"); // 08:00 ET
    expect(getSessionState(new Date("2026-08-17T15:00:00Z")).session).toBe("regular");   // 11:00 ET
    expect(getSessionState(new Date("2026-08-17T21:00:00Z")).session).toBe("afterhours");// 17:00 ET
    expect(getSessionState(new Date("2026-08-17T02:00:00Z")).session).toBe("closed");    // 22:00 ET Sun
  });

  it("knows weekends and holidays are closed", () => {
    expect(getSessionState(new Date("2026-08-15T15:00:00Z")).session).toBe("closed"); // Saturday
    const july4 = getSessionState(new Date("2026-07-03T15:00:00Z"));
    expect(july4.isHoliday).toBe(true);
    expect(july4.session).toBe("closed");
  });

  it("converts to ET correctly across DST", () => {
    expect(etParts(new Date("2026-01-15T15:00:00Z")).h).toBe(10); // EST = UTC-5
    expect(etParts(new Date("2026-07-15T15:00:00Z")).h).toBe(11); // EDT = UTC-4
  });

  it("rejects weekend trading days", () => {
    expect(isTradingDay("2026-08-15", 6)).toBe(false);
    expect(isTradingDay("2026-08-17", 1)).toBe(true);
  });
});

describe("float categories", () => {
  it("buckets by configurable thresholds", () => {
    expect(floatCategory(3_000_000)).toBe("ULTRA LOW FLOAT");
    expect(floatCategory(12_000_000)).toBe("LOW FLOAT");
    expect(floatCategory(40_000_000)).toBe("MODERATE FLOAT");
    expect(floatCategory(200_000_000)).toBe("HIGHER FLOAT");
  });
  it("never guesses when float is unknown", () => {
    expect(floatCategory(undefined)).toBe("UNKNOWN");
  });
});

describe("entitlements", () => {
  it("EOD-only providers expose just the eod entitlement", () => {
    const e = availableEntitlements({ intraday: false, quotes: false, halts: false, floatData: false, news: true });
    expect(e.has("eod")).toBe(true);
    expect(e.has("intraday")).toBe(false);
    expect(e.has("news")).toBe(true);
  });
});
