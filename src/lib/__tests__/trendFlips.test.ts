import { describe, expect, it } from "vitest";
import { countTrendFlips } from "../intraday";

describe("countTrendFlips", () => {
  it("counts bull/bear switches and ignores neutral gaps", () => {
    expect(countTrendFlips(["Bearish", "Slightly Bearish", "Neutral", "Slightly Bullish", "Bullish", "Bearish"])).toBe(2);
    expect(countTrendFlips(["Bullish", "Neutral", "Bullish"])).toBe(0);
    expect(countTrendFlips([])).toBe(0);
  });
});
