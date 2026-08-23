import { describe, expect, it } from "vitest";
import { evaluateCondition, evaluateGroup, hardFieldsUsed, fieldsUsed, runScanner, type MetricRow, type RuleGroup } from "../scannerRules";
import { QUICK_FILTERS, QUICK_SORTS, applyQuickFilters, applyQuickSort } from "../quickFilterDefs";
import { FIELD_BY_KEY } from "../fields";

const row: MetricRow = {
  symbol: "TEST", price: 7.5, changePct: 14.2, rvol: 6.1, volume: 3_000_000, dollarVolume: 22_500_000,
  vwapDistancePct: 2.3, emaState: "9>20>50", coilPct: 4.1, rsi14: 61, atrPct: 5.2, setupScore: 74,
  macdState: "Expanding", sector: "Technology", aboveSma200: true,
};

describe("rule engine operators", () => {
  it("gt / gte / lt / lte", () => {
    expect(evaluateCondition({ field: "price", op: "gt", value: 7 }, row).pass).toBe(true);
    expect(evaluateCondition({ field: "price", op: "gt", value: 7.5 }, row).pass).toBe(false);
    expect(evaluateCondition({ field: "price", op: "gte", value: 7.5 }, row).pass).toBe(true);
    expect(evaluateCondition({ field: "price", op: "lt", value: 8 }, row).pass).toBe(true);
    expect(evaluateCondition({ field: "price", op: "lte", value: 7.4 }, row).pass).toBe(false);
  });
  it("between is inclusive on both ends", () => {
    expect(evaluateCondition({ field: "price", op: "between", value: 2, value2: 20 }, row).pass).toBe(true);
    expect(evaluateCondition({ field: "price", op: "between", value: 7.5, value2: 7.5 }, row).pass).toBe(true);
    expect(evaluateCondition({ field: "price", op: "between", value: 8, value2: 20 }, row).pass).toBe(false);
  });
  it("eq / neq / in on strings", () => {
    expect(evaluateCondition({ field: "emaState", op: "eq", value: "9>20>50" }, row).pass).toBe(true);
    expect(evaluateCondition({ field: "emaState", op: "neq", value: "Breakdown" }, row).pass).toBe(true);
    expect(evaluateCondition({ field: "emaState", op: "in", values: ["9>20", "9>20>50"] }, row).pass).toBe(true);
    expect(evaluateCondition({ field: "emaState", op: "in", values: ["Breakdown"] }, row).pass).toBe(false);
  });
  it("isTrue / isFalse", () => {
    expect(evaluateCondition({ field: "aboveSma200", op: "isTrue" }, row).pass).toBe(true);
    expect(evaluateCondition({ field: "aboveSma200", op: "isFalse" }, row).pass).toBe(false);
  });
  it("missing data FAILS CLOSED and is flagged missing", () => {
    const r = evaluateCondition({ field: "floatShares", op: "lt", value: 20e6 }, row);
    expect(r.pass).toBe(false);
    expect(r.missing).toBe(true);
  });
});

describe("AND / OR groups and soft (preferred) criteria", () => {
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

  it("passes when all HARD rules pass even if soft rules are unknown", () => {
    const res = evaluateGroup(fivePoint, row);
    expect(res.pass).toBe(true);
    expect(res.criteriaTotal).toBe(5);
    expect(res.criteriaMet).toBe(3);
    expect(res.criteriaUnknown).toBe(2);
    expect(res.missingFields.sort()).toEqual(["catalystStatus", "floatShares"]);
  });

  it("fails when a HARD rule fails regardless of soft rules", () => {
    const res = evaluateGroup(fivePoint, { ...row, rvol: 1.2 });
    expect(res.pass).toBe(false);
  });

  it("counts a met soft rule without changing pass/fail", () => {
    const res = evaluateGroup(fivePoint, { ...row, floatShares: 8_000_000, catalystStatus: "None" });
    expect(res.pass).toBe(true);
    expect(res.criteriaMet).toBe(4); // 3 hard + float
    expect(res.criteriaUnknown).toBe(0);
  });

  it("OR logic passes on any hard rule", () => {
    const g: RuleGroup = { logic: "OR", conditions: [{ field: "rvol", op: "gte", value: 100 }, { field: "changePct", op: "gte", value: 10 }] };
    expect(evaluateGroup(g, row).pass).toBe(true);
  });

  it("nested groups evaluate recursively", () => {
    const g: RuleGroup = {
      logic: "AND",
      conditions: [{ field: "price", op: "gte", value: 1 }],
      groups: [{ logic: "OR", conditions: [{ field: "rsi14", op: "gte", value: 90 }, { field: "coilPct", op: "lte", value: 6 }] }],
    };
    expect(evaluateGroup(g, row).pass).toBe(true);
  });

  it("distinguishes hard fields from all fields for entitlement checks", () => {
    expect(hardFieldsUsed(fivePoint).sort()).toEqual(["changePct", "price", "rvol"]);
    expect(fieldsUsed(fivePoint)).toHaveLength(5);
  });

  it("explain marks soft and unknown per rule", () => {
    const res = evaluateGroup(fivePoint, row);
    const floatLine = res.explain.find((e) => e.field === "floatShares")!;
    expect(floatLine.soft).toBe(true);
    expect(floatLine.unknown).toBe(true);
    const priceLine = res.explain.find((e) => e.field === "price")!;
    expect(priceLine.soft).toBe(false);
    expect(priceLine.pass).toBe(true);
  });

  it("runScanner returns only passing rows", () => {
    const out = runScanner([row, { ...row, symbol: "LOSER", changePct: 1 }], fivePoint);
    expect(out.map((o) => o.row.symbol)).toEqual(["TEST"]);
  });
});

describe("quick filters — every predicate", () => {
  const pass: Record<string, MetricRow> = {
    under20: { price: 10 },
    up10: { changePct: 12 },
    rvol5: { rvol: 5 },
    lowFloat: { floatShares: 10e6 },
    catalyst: { catalystStatus: "Found" },
    heavyVol: { rvol: 2 },
    green: { changePct: 0.1 },
    aboveVwap: { vwapDistancePct: 0 },
    stacked: { emaState: "9>20>50" },
    coiled: { coilPct: 6 },
    liquid: { dollarVolume: 10e6 },
    notExtended: { vwapDistancePct: 5.9 },
    healthyRsi: { rsi14: 60 },
    gradeAB: { setupScore: 70 },
  };
  const fail: Record<string, MetricRow> = {
    under20: { price: 25 },
    up10: { changePct: 9.9 },
    rvol5: { rvol: 4.9 },
    lowFloat: { floatShares: 30e6 },
    catalyst: { catalystStatus: "None" },
    heavyVol: { rvol: 1.9 },
    green: { changePct: -0.1 },
    aboveVwap: { vwapDistancePct: -0.1 },
    stacked: { emaState: "9<20" },
    coiled: { coilPct: 6.1 },
    liquid: { dollarVolume: 9.9e6 },
    notExtended: { vwapDistancePct: 6 },
    healthyRsi: { rsi14: 80 },
    gradeAB: { setupScore: 69 },
  };

  for (const f of QUICK_FILTERS) {
    it(`${f.key}: passes a matching row and rejects a non-matching one`, () => {
      expect(pass[f.key], `missing pass fixture for ${f.key}`).toBeDefined();
      expect(fail[f.key], `missing fail fixture for ${f.key}`).toBeDefined();
      expect(f.test(pass[f.key])).toBe(true);
      expect(f.test(fail[f.key])).toBe(false);
    });
  }

  it("every filter has a label and a hint", () => {
    for (const f of QUICK_FILTERS) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.hint.length).toBeGreaterThan(15);
    }
  });

  it("missing data never satisfies a filter", () => {
    const empty: MetricRow = {};
    for (const f of QUICK_FILTERS) {
      expect(f.test(empty), `${f.key} passed an empty row`).toBe(false);
    }
  });

  it("EMA Stacked tolerates spacing variants", () => {
    const f = QUICK_FILTERS.find((x) => x.key === "stacked")!;
    expect(f.test({ emaState: "9 > 20 > 50 (stacked)" })).toBe(true);
    expect(f.test({ emaState: "9>20>50" })).toBe(true);
  });

  it("stacking filters ANDs them", () => {
    const rows: MetricRow[] = [
      { symbol: "A", rvol: 3, changePct: 5 },
      { symbol: "B", rvol: 3, changePct: -1 },
      { symbol: "C", rvol: 1, changePct: 5 },
    ];
    expect(applyQuickFilters(rows, ["heavyVol", "green"]).map((r) => r.symbol)).toEqual(["A"]);
  });
});

describe("quick sorts", () => {
  it("every sort key is a registered field", () => {
    for (const s of QUICK_SORTS) expect(FIELD_BY_KEY.has(s.key), s.key).toBe(true);
  });

  it("sorts descending by default and sinks missing values to the bottom either way", () => {
    const rows: MetricRow[] = [{ symbol: "A", rvol: 2 }, { symbol: "B" }, { symbol: "C", rvol: 5 }];
    expect(applyQuickSort(rows, "rvol", false).map((r) => r.symbol)).toEqual(["C", "A", "B"]);
    expect(applyQuickSort(rows, "rvol", true).map((r) => r.symbol)).toEqual(["A", "C", "B"]);
  });
});
