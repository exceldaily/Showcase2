import { describe, expect, it } from "vitest";
import { DEFAULT_RISK, evaluateRisk, maxContractsWithinRisk, parseRiskSettings, type RiskInput } from "../riskEngine";

const settings = { ...DEFAULT_RISK, accountSize: 10_000 };
const base: RiskInput = {
  settings, premium: 1.88, contracts: 1, valueAtInvalidation: 0.9, valuesAtTargets: [3.1, 4.2, 5.5], is0dte: true,
  openPositions: [], realizedToday: 0, unrealizedToday: 0,
};

describe("risk engine", () => {
  it("computes exposure, loss at invalidation, rewards and R multiple deterministically", () => {
    const r = evaluateRisk(base);
    expect(r.configured).toBe(true);
    expect(r.exposureDollars).toBe(188);
    expect(r.exposurePct).toBe(1.88);
    expect(r.lossAtInvalidation).toBe(98);
    expect(r.rewardAtTargets).toEqual([122, 232, 362]);
    expect(r.riskReward).toBe(1.24);
    expect(r.allowedRiskDollars).toBe(100);
    expect(r.breaches).toEqual([]);
    expect(evaluateRisk({ ...base, premium: 4, valueAtInvalidation: 3.2 }).breaches.map((b) => b.key)).toEqual(["premium-loss"]);
  });
  it("flags the spec example: $188 premium against a $100 allowed risk when it can go to zero", () => {
    const r = evaluateRisk({ ...base, valueAtInvalidation: null });
    expect(r.breaches.find((b) => b.key === "risk-per-trade")?.blocking).toBe(true);
    expect(r.breaches.find((b) => b.key === "risk-per-trade")?.message).toMatch(/\$188 exceeds the 1% max risk \(\$100\)/);
  });
  it("blocks on daily loss, contracts, 0DTE cap, simultaneous and correlated limits", () => {
    const r = evaluateRisk({
      ...base, contracts: 6, realizedToday: -250, unrealizedToday: -60,
      openPositions: [{ premiumTotal: 400, is0dte: true, correlated: true }, { premiumTotal: 300, is0dte: false, correlated: false }],
    });
    const keys = r.breaches.map((b) => b.key);
    expect(keys).toContain("daily-loss");
    expect(keys).toContain("contracts");
    expect(keys).toContain("0dte");
    expect(keys).toContain("simultaneous");
    expect(r.dailyLossRemaining).toBe(0);
    expect(r.totalOpenExposure).toBe(700);
    const c = evaluateRisk({ ...base, contracts: 1, openPositions: [{ premiumTotal: 900, is0dte: false, correlated: true }] });
    expect(c.breaches.map((b) => b.key)).toContain("correlated");
  });
  it("reports NOT CONFIGURED without an account size and never blocks", () => {
    const r = evaluateRisk({ ...base, settings: DEFAULT_RISK });
    expect(r.configured).toBe(false);
    expect(r.breaches).toEqual([{ key: "not-configured", message: "Account size not set; risk limits are not being checked", blocking: false }]);
    expect(r.exposureDollars).toBe(188);
  });
  it("sizes the largest position inside the limit", () => {
    expect(maxContractsWithinRisk(settings, 1.88, 0.9)).toBe(1);
    expect(maxContractsWithinRisk(settings, 0.4, null)).toBe(2);
    expect(maxContractsWithinRisk(settings, 3, null)).toBe(0);
    expect(maxContractsWithinRisk(DEFAULT_RISK, 1, null)).toBeNull();
  });
  it("parses and clamps stored settings", () => {
    const s = parseRiskSettings({ accountSize: 25000.7, maxRiskPct: 99, maxContracts: 0, bogus: 1 });
    expect(s.accountSize).toBe(25001);
    expect(s.maxRiskPct).toBe(25);
    expect(s.maxContracts).toBe(1);
    expect(parseRiskSettings(null).accountSize).toBeNull();
  });
});
