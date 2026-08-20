// ─────────────────────────────────────────────────────────
// Position sizing / risk calculator (spec §41).
// Decision support only: real fills slip, halts gap, and liquidity
// disappears. The output states that plainly rather than implying
// risk is contained.
// ─────────────────────────────────────────────────────────

import { round2 } from "./scoring";

export interface RiskInputs {
  accountSize: number;
  /** Either an explicit dollar cap or a % of account (spec §24 default 0.25–0.50%). */
  maxRiskDollars?: number;
  maxRiskPct?: number;
  entry: number;
  stop: number;
  target?: number;
  /** Optional cap so one idea can't consume the account. */
  maxPositionPct?: number;
}

export interface RiskResult {
  valid: boolean;
  error?: string;
  direction: "Long" | "Short";
  riskPerShare: number;
  riskBudget: number;
  shares: number;
  positionValue: number;
  positionPctOfAccount: number;
  maxLoss: number;
  potentialGain: number | null;
  riskReward: number | null;
  stopDistancePct: number;
  /** Warnings that do not block the calculation but matter. */
  warnings: string[];
}

export function calculateRisk(i: RiskInputs): RiskResult {
  const warnings: string[] = [];
  const direction: "Long" | "Short" = i.stop < i.entry ? "Long" : "Short";

  const base: RiskResult = {
    valid: false,
    direction,
    riskPerShare: 0,
    riskBudget: 0,
    shares: 0,
    positionValue: 0,
    positionPctOfAccount: 0,
    maxLoss: 0,
    potentialGain: null,
    riskReward: null,
    stopDistancePct: 0,
    warnings,
  };

  if (!(i.entry > 0)) return { ...base, error: "Entry price must be greater than zero." };
  if (!(i.stop > 0)) return { ...base, error: "Stop price must be greater than zero." };
  if (i.entry === i.stop) return { ...base, error: "Stop cannot equal entry — there would be no defined risk." };
  if (!(i.accountSize > 0)) return { ...base, error: "Account size must be greater than zero." };

  // Round to cents BEFORE dividing: prices are quoted in cents, and raw
  // float subtraction (3.20 - 3.05 = 0.15000000000000036) silently costs
  // a share on the floor division below.
  const riskPerShare = Math.round(Math.abs(i.entry - i.stop) * 100) / 100;
  const stopDistancePct = round2((riskPerShare / i.entry) * 100);

  // Risk budget: explicit dollars win; otherwise % of account.
  const pctBudget = i.maxRiskPct !== undefined ? (i.maxRiskPct / 100) * i.accountSize : undefined;
  const riskBudget = round2(
    i.maxRiskDollars !== undefined && pctBudget !== undefined
      ? Math.min(i.maxRiskDollars, pctBudget)
      : (i.maxRiskDollars ?? pctBudget ?? 0)
  );
  if (!(riskBudget > 0)) return { ...base, error: "Set a dollar risk cap or a risk percentage." };

  let shares = Math.floor(riskBudget / riskPerShare);

  // Position-size cap (never let one idea eat the account, spec §24).
  const maxPositionPct = i.maxPositionPct ?? 25;
  const maxPositionValue = (maxPositionPct / 100) * i.accountSize;
  if (shares * i.entry > maxPositionValue) {
    shares = Math.floor(maxPositionValue / i.entry);
    warnings.push(
      `Size reduced to respect the ${maxPositionPct}% max position cap — the stop is tight enough that full risk sizing would concentrate too much capital in one idea.`
    );
  }

  if (shares < 1) {
    return {
      ...base,
      riskPerShare: round2(riskPerShare),
      riskBudget,
      stopDistancePct,
      error: "Risk budget is smaller than the risk on a single share. Widen the budget or tighten the stop.",
    };
  }

  const positionValue = round2(shares * i.entry);
  const maxLoss = round2(shares * riskPerShare);
  const potentialGain = i.target !== undefined ? round2(shares * Math.abs(i.target - i.entry)) : null;
  const riskReward = i.target !== undefined ? round2(Math.abs(i.target - i.entry) / riskPerShare) : null;

  if (stopDistancePct > 15) {
    warnings.push(`Stop is ${stopDistancePct}% away — wide stops mean a small share count and low tolerance for being early.`);
  }
  if (stopDistancePct < 1) {
    warnings.push(`Stop is only ${stopDistancePct}% away — inside typical daily noise, so a normal wiggle can stop you out.`);
  }
  if (riskReward !== null && riskReward < 2) {
    warnings.push(`Reward-to-risk is ${riskReward}:1 — below the 2:1 many traders treat as a floor.`);
  }
  if (positionValue > i.accountSize) {
    warnings.push("Position value exceeds account size — this would require margin.");
  }

  return {
    valid: true,
    direction,
    riskPerShare: round2(riskPerShare),
    riskBudget,
    shares,
    positionValue,
    positionPctOfAccount: round2((positionValue / i.accountSize) * 100),
    maxLoss,
    potentialGain,
    riskReward,
    stopDistancePct,
    warnings,
  };
}

/** Standard disclaimer shown with every calculation (spec §41, §52). */
export const RISK_DISCLAIMER =
  "Decision support only. Actual losses can exceed the calculated maximum due to slippage, gaps, halts, and thin liquidity. A stop is an order, not a guarantee.";
