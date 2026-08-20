import { describe, expect, it } from "vitest";
import { METRIC_GLOSSARY, VERDICT_CLASS, VERDICT_DOT, interpret } from "../interpret";

describe("metric interpretation", () => {
  it("labels heavy volume as good and quiet volume as caution", () => {
    expect(interpret("rvol", 4)!.verdict).toBe("good");
    expect(interpret("rvol", 1.0)!.verdict).toBe("neutral");
    expect(interpret("rvol", 0.4)!.verdict).toBe("caution");
  });

  it("treats being modestly above VWAP as good but stretched as caution", () => {
    expect(interpret("vwapDistancePct", 2)!.verdict).toBe("good");
    expect(interpret("vwapDistancePct", 12)!.verdict).toBe("caution");
    expect(interpret("vwapDistancePct", -8)!.verdict).toBe("bad");
  });

  it("flags extreme volatility as bad and a tradeable range as good", () => {
    expect(interpret("atrPct", 14)!.verdict).toBe("bad");
    expect(interpret("atrPct", 3.5)!.verdict).toBe("good");
    expect(interpret("atrPct", 0.7)!.verdict).toBe("neutral");
  });

  it("reads RSI bands correctly", () => {
    expect(interpret("rsi14", 62)!.verdict).toBe("good");
    expect(interpret("rsi14", 85)!.verdict).toBe("caution");
    expect(interpret("rsi14", 22)!.verdict).toBe("bad");
  });

  it("understands EMA structure strings", () => {
    expect(interpret("emaState", "9>20>50")!.verdict).toBe("good");
    expect(interpret("emaState", "Breakdown")!.verdict).toBe("bad");
    expect(interpret("emaState", "9<20")!.verdict).toBe("caution");
  });

  it("rewards a tight coil", () => {
    expect(interpret("coilPct", 3)!.verdict).toBe("good");
    expect(interpret("coilPct", 20)!.verdict).toBe("caution");
  });

  it("marks thin liquidity as caution", () => {
    expect(interpret("dollarVolume", 80e6)!.verdict).toBe("good");
    expect(interpret("dollarVolume", 400e3)!.verdict).toBe("caution");
  });

  it("treats ultra-low float as caution, not a free win", () => {
    // Thin supply amplifies moves in BOTH directions — the app should
    // never present it as unambiguously good.
    expect(interpret("floatShares", 3e6)!.verdict).toBe("caution");
    expect(interpret("floatShares", 15e6)!.verdict).toBe("ok");
  });

  it("returns null for missing values instead of guessing", () => {
    expect(interpret("rvol", null)).toBeNull();
    expect(interpret("rvol", undefined)).toBeNull();
    expect(interpret("unknownMetric", 5)).toBeNull();
  });

  it("always supplies a label and a meaning sentence", () => {
    for (const [key, val] of [["rvol", 3], ["rsi14", 60], ["atrPct", 4], ["changePct", 5]] as const) {
      const i = interpret(key, val)!;
      expect(i.label.length).toBeGreaterThan(0);
      expect(i.meaning.length).toBeGreaterThan(10);
    }
  });
});

describe("glossary", () => {
  it("documents what/good/bad for every explained metric", () => {
    for (const [key, g] of Object.entries(METRIC_GLOSSARY)) {
      expect(g.title.length, key).toBeGreaterThan(0);
      expect(g.what.length, key).toBeGreaterThan(20);
      expect(g.goodWhen.length, key).toBeGreaterThan(10);
      expect(g.badWhen.length, key).toBeGreaterThan(10);
    }
  });

  it("has a colour class and dot for every verdict", () => {
    for (const v of ["good", "ok", "caution", "bad", "neutral"] as const) {
      expect(VERDICT_CLASS[v]).toBeTruthy();
      expect(VERDICT_DOT[v]).toBeTruthy();
    }
  });
});
