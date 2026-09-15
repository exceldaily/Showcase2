import { describe, expect, it } from "vitest";
import { effectiveToggles, parseChartPrefs, PRESETS, setPreset, toggleIndicator } from "../chartPrefs";

describe("chart prefs", () => {
  it("presets are complete toggle sets", () => {
    expect(PRESETS.CLEAN.ema50).toBe(false);
    expect(PRESETS.TREND.ema200).toBe(true);
    expect(PRESETS.MOMENTUM.macd).toBe(true);
    expect(PRESETS.LEVELS.prevDay).toBe(true);
    expect(PRESETS.FULL.rsi).toBe(true);
  });
  it("overrides sit on top of the preset and a new preset clears them", () => {
    let p = parseChartPrefs({ preset: "CLEAN", overrides: { macd: true } });
    expect(effectiveToggles(p).macd).toBe(true);
    p = toggleIndicator(p, "macd");
    expect(effectiveToggles(p).macd).toBe(false);
    p = toggleIndicator(p, "ema200");
    expect(effectiveToggles(p).ema200).toBe(true);
    expect(effectiveToggles(setPreset(p, "TREND"))).toEqual(PRESETS.TREND);
  });
  it("ignores junk", () => {
    expect(parseChartPrefs({ preset: "X", overrides: { macd: "yes", bogus: true } })).toEqual({ preset: "CLEAN", overrides: {} });
    expect(parseChartPrefs(null).preset).toBe("CLEAN");
  });
});
