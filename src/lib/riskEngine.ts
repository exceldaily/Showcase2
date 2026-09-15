// ─────────────────────────────────────────────────────────
// Deterministic risk engine (pure, unit-tested). Configured limits are
// hard rules: no score, confidence or model estimate can override
// them. Every number is arithmetic on the inputs; nothing is guessed.
// Option value estimates at the levels come from the caller (the
// Black-Scholes scenario model) and are labelled estimates.
// ─────────────────────────────────────────────────────────

export interface RiskSettings {
  /** Null until the trader sets it; risk rules then report NOT CONFIGURED. */
  accountSize: number | null;
  /** Max loss per trade as a percent of the account. */
  maxRiskPct: number;
  /** Max realized + unrealized loss for the day as a percent of the account. */
  maxDailyLossPct: number;
  /** Max contracts in one position. */
  maxContracts: number;
  /** Max premium tied up in same-day (0DTE) contracts as a percent of the account. */
  max0dtePct: number;
  /** Max simultaneous open positions. */
  maxSimultaneous: number;
  /** Max premium across positions on correlated names (same sector/index) as a percent of the account. */
  maxCorrelatedPct: number;
}

export const DEFAULT_RISK: RiskSettings = {
  accountSize: null, maxRiskPct: 1, maxDailyLossPct: 3, maxContracts: 5, max0dtePct: 5, maxSimultaneous: 2, maxCorrelatedPct: 10,
};

export interface RiskInput {
  settings: RiskSettings;
  /** Premium per share paid (or planned). */
  premium: number;
  contracts: number;
  /** Estimated option value per share at the invalidation level (model). */
  valueAtInvalidation: number | null;
  /** Estimated option value per share at each target (model). */
  valuesAtTargets: (number | null)[];
  /** Same-day expiry contract. */
  is0dte: boolean;
  /** Other open positions the trader has recorded. */
  openPositions: { premiumTotal: number; is0dte: boolean; correlated: boolean }[];
  /** Realized P&L today in dollars (manual journal). */
  realizedToday: number;
  /** Unrealized P&L on open positions in dollars. */
  unrealizedToday: number;
}

export interface RiskBreach {
  key: "not-configured" | "risk-per-trade" | "daily-loss" | "contracts" | "0dte" | "simultaneous" | "correlated" | "premium-loss";
  message: string;
  /** True when the rule should block a new entry. */
  blocking: boolean;
}

export interface RiskEvaluation {
  configured: boolean;
  /** Total premium at risk: premium x 100 x contracts. */
  exposureDollars: number;
  exposurePct: number | null;
  /** Worst case: the whole premium. */
  maxLoss: number;
  /** Estimated loss if the underlying reaches the invalidation level. */
  lossAtInvalidation: number | null;
  /** Estimated reward at each target. */
  rewardAtTargets: (number | null)[];
  /** Reward at target 1 over the estimated loss at invalidation. */
  riskReward: number | null;
  allowedRiskDollars: number | null;
  dailyLossRemaining: number | null;
  totalOpenExposure: number;
  breaches: RiskBreach[];
}

const round = (n: number) => Math.round(n * 100) / 100;

export function evaluateRisk(i: RiskInput): RiskEvaluation {
  const s = i.settings;
  const contracts = Math.max(0, Math.floor(i.contracts));
  const exposureDollars = round(i.premium * 100 * contracts);
  const lossAtInvalidation = i.valueAtInvalidation === null ? null : round(Math.max(0, (i.premium - i.valueAtInvalidation) * 100 * contracts));
  const rewardAtTargets = i.valuesAtTargets.map((v) => (v === null ? null : round((v - i.premium) * 100 * contracts)));
  const r1 = rewardAtTargets[0] ?? null;
  const riskReward = r1 !== null && lossAtInvalidation !== null && lossAtInvalidation > 0 ? round(r1 / lossAtInvalidation) : null;
  const totalOpenExposure = round(i.openPositions.reduce((a, p) => a + p.premiumTotal, 0));
  const breaches: RiskBreach[] = [];

  if (s.accountSize === null || !(s.accountSize > 0)) {
    breaches.push({ key: "not-configured", message: "Account size not set; risk limits are not being checked", blocking: false });
    return { configured: false, exposureDollars, exposurePct: null, maxLoss: exposureDollars, lossAtInvalidation, rewardAtTargets, riskReward, allowedRiskDollars: null, dailyLossRemaining: null, totalOpenExposure, breaches };
  }
  const acct = s.accountSize;
  const exposurePct = round((exposureDollars / acct) * 100);
  const allowedRiskDollars = round((acct * s.maxRiskPct) / 100);
  const dailyLimit = (acct * s.maxDailyLossPct) / 100;
  const dailyLossRemaining = round(Math.max(0, dailyLimit + Math.min(0, i.realizedToday + i.unrealizedToday)));

  // The planned loss is the estimate at invalidation when it exists, but a
  // same-day option can go to zero, so the full premium is checked too.
  const plannedLoss = lossAtInvalidation ?? exposureDollars;
  if (plannedLoss > allowedRiskDollars) breaches.push({ key: "risk-per-trade", message: `Estimated loss ${fmt(plannedLoss)} exceeds the ${s.maxRiskPct}% max risk (${fmt(allowedRiskDollars)})`, blocking: true });
  if (exposureDollars > allowedRiskDollars * 3) breaches.push({ key: "premium-loss", message: `Full premium ${fmt(exposureDollars)} is more than three times the allowed risk; a same-day option can expire worthless`, blocking: false });
  if (dailyLossRemaining <= 0) breaches.push({ key: "daily-loss", message: `Daily loss limit reached (${fmt(dailyLimit)})`, blocking: true });
  else if (plannedLoss > dailyLossRemaining) breaches.push({ key: "daily-loss", message: `Estimated loss ${fmt(plannedLoss)} exceeds today's remaining loss budget ${fmt(dailyLossRemaining)}`, blocking: true });
  if (contracts > s.maxContracts) breaches.push({ key: "contracts", message: `${contracts} contracts exceeds the max of ${s.maxContracts}`, blocking: true });
  if (i.is0dte) {
    const open0 = i.openPositions.filter((p) => p.is0dte).reduce((a, p) => a + p.premiumTotal, 0);
    const cap = (acct * s.max0dtePct) / 100;
    if (open0 + exposureDollars > cap) breaches.push({ key: "0dte", message: `Same-day premium ${fmt(open0 + exposureDollars)} exceeds the ${s.max0dtePct}% 0DTE cap (${fmt(cap)})`, blocking: true });
  }
  if (i.openPositions.length >= s.maxSimultaneous) breaches.push({ key: "simultaneous", message: `${i.openPositions.length} open positions; max simultaneous is ${s.maxSimultaneous}`, blocking: true });
  const corr = i.openPositions.filter((p) => p.correlated).reduce((a, p) => a + p.premiumTotal, 0);
  const corrCap = (acct * s.maxCorrelatedPct) / 100;
  if (corr > 0 && corr + exposureDollars > corrCap) breaches.push({ key: "correlated", message: `Correlated exposure ${fmt(corr + exposureDollars)} exceeds the ${s.maxCorrelatedPct}% cap (${fmt(corrCap)})`, blocking: true });

  return { configured: true, exposureDollars, exposurePct, maxLoss: exposureDollars, lossAtInvalidation, rewardAtTargets, riskReward, allowedRiskDollars, dailyLossRemaining, totalOpenExposure, breaches };
}

/** Largest contract count that keeps the planned loss inside the per-trade limit (0 when none fits). */
export function maxContractsWithinRisk(settings: RiskSettings, premium: number, valueAtInvalidation: number | null): number | null {
  if (settings.accountSize === null || !(settings.accountSize > 0) || premium <= 0) return null;
  const allowed = (settings.accountSize * settings.maxRiskPct) / 100;
  const lossPer = valueAtInvalidation === null ? premium * 100 : Math.max(0, premium - valueAtInvalidation) * 100;
  if (lossPer <= 0) return settings.maxContracts;
  return Math.max(0, Math.min(settings.maxContracts, Math.floor(allowed / lossPer)));
}

const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

// ── Device storage ──
const KEY = "af_risk";

export function parseRiskSettings(raw: unknown): RiskSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<RiskSettings>;
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  return {
    accountSize: typeof r.accountSize === "number" && r.accountSize > 0 ? Math.round(r.accountSize) : null,
    maxRiskPct: num(r.maxRiskPct, 0.1, 25, DEFAULT_RISK.maxRiskPct),
    maxDailyLossPct: num(r.maxDailyLossPct, 0.1, 50, DEFAULT_RISK.maxDailyLossPct),
    maxContracts: Math.round(num(r.maxContracts, 1, 100, DEFAULT_RISK.maxContracts)),
    max0dtePct: num(r.max0dtePct, 0.1, 100, DEFAULT_RISK.max0dtePct),
    maxSimultaneous: Math.round(num(r.maxSimultaneous, 1, 20, DEFAULT_RISK.maxSimultaneous)),
    maxCorrelatedPct: num(r.maxCorrelatedPct, 0.1, 100, DEFAULT_RISK.maxCorrelatedPct),
  };
}

export function loadRiskSettings(): RiskSettings {
  if (typeof window === "undefined") return DEFAULT_RISK;
  try {
    return parseRiskSettings(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
  } catch {
    return DEFAULT_RISK;
  }
}

export function saveRiskSettings(s: RiskSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(parseRiskSettings(s)));
    window.dispatchEvent(new CustomEvent("af-risk"));
  } catch { /* ignore */ }
}

export function onRiskSettings(cb: (s: RiskSettings) => void): () => void {
  const fire = () => cb(loadRiskSettings());
  window.addEventListener("af-risk", fire);
  window.addEventListener("storage", fire);
  return () => {
    window.removeEventListener("af-risk", fire);
    window.removeEventListener("storage", fire);
  };
}
