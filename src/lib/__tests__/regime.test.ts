import { describe, expect, it } from "vitest";
import { classifyRegime, regimeScore } from "../regime";

describe("classifyRegime", () => {
  const base = { spyAbove50d: true, qqqAbove50d: true, vix: 14, breadth: 75, spyWeekChangePct: 1 };

  it("strong bull needs both indices up, low vix, wide breadth", () => {
    expect(classifyRegime(base)).toBe("Strong Bull");
  });
  it("bull on moderate vix", () => {
    expect(classifyRegime({ ...base, vix: 17, breadth: 60 })).toBe("Bull");
  });
  it("risk-off overrides everything above vix 30", () => {
    expect(classifyRegime({ ...base, vix: 35 })).toBe("High Volatility Risk-Off");
  });
  it("bear when both indices below trend with elevated vix", () => {
    expect(
      classifyRegime({ spyAbove50d: false, qqqAbove50d: false, vix: 27, breadth: 35, spyWeekChangePct: -2 })
    ).toBe("Bear");
  });
  it("crash week with collapsed breadth is risk-off even at moderate vix", () => {
    expect(
      classifyRegime({ spyAbove50d: false, qqqAbove50d: false, vix: 24, breadth: 20, spyWeekChangePct: -6 })
    ).toBe("High Volatility Risk-Off");
  });
  it("mixed signals fall to neutral", () => {
    expect(
      classifyRegime({ spyAbove50d: true, qqqAbove50d: false, vix: 22, breadth: 50, spyWeekChangePct: 0 })
    ).toBe("Neutral");
  });
});

describe("regimeScore", () => {
  it("orders regimes from most to least trade-friendly", () => {
    expect(regimeScore("Strong Bull")).toBeGreaterThan(regimeScore("Bull"));
    expect(regimeScore("Bull")).toBeGreaterThan(regimeScore("Neutral"));
    expect(regimeScore("Neutral")).toBeGreaterThan(regimeScore("Bear"));
    expect(regimeScore("Bear")).toBeGreaterThan(regimeScore("High Volatility Risk-Off"));
  });
});
