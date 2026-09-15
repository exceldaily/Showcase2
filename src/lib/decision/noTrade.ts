// ─────────────────────────────────────────────────────────
// Explicit NO TRADE rules (pure, unit-tested). Each rule is a named
// check with a plain reason. Hard rules turn any verdict into NO
// TRADE; soft rules downgrade TRADE to WAIT. Not trading is a valid
// and frequent output, and the panel always says why.
// ─────────────────────────────────────────────────────────

import type { Alignment } from "../timeframeMatrix";
import type { RoomResult, TradePlan } from "../setupMachine";

export interface NoTradeRule {
  key: string;
  /** Hard rules block outright; soft rules ask for patience. */
  severity: "hard" | "soft";
  reason: string;
}

export interface NoTradeInput {
  plan: TradePlan | null;
  price: number | null;
  rvol: number | null;
  choppy: boolean;
  align: Alignment | null;
  room: RoomResult | null;
  contract: { score: number; spreadPct: number | null; volume: number; openInterest: number; iv: number | null } | null;
  maxSpreadPct: number;
  /** Minutes until the next high-impact scheduled event, null when unknown or none. */
  minutesToEvent: number | null;
  /** The trader's configured no-entry window before an event, in minutes. */
  eventBufferMinutes: number;
  /** Set when the risk engine says the proposed size breaks a configured limit. */
  riskLimitBreached: string | null;
  marketOpen: boolean;
}

export function noTradeRules(i: NoTradeInput): NoTradeRule[] {
  const out: NoTradeRule[] = [];
  const push = (key: string, severity: NoTradeRule["severity"], reason: string) => out.push({ key, severity, reason });

  if (!i.marketOpen) push("closed", "hard", "Market is closed");
  if (!i.plan) push("no-level", "hard", "No valid trigger level");
  else {
    if (!(i.plan.invalidation > 0) || i.plan.invalidation === i.plan.trigger) push("no-invalidation", "hard", "No valid invalidation level");
    const rr = i.plan.rewardToTargets[0]?.rr ?? 0;
    if (rr < 1.5) push("poor-rr", "soft", `Poor risk/reward (${rr.toFixed(1)}R to target 1)`);
    if (i.price !== null && i.plan.targets[0] !== undefined) {
      // Price sitting between the trigger and the first target, or between
      // the invalidation and the trigger, is between major levels.
      const lo = Math.min(i.plan.invalidation, i.plan.targets[0]);
      const hi = Math.max(i.plan.invalidation, i.plan.targets[0]);
      const far = Math.abs(i.price - i.plan.trigger) / i.price > 0.006;
      if (i.price > lo && i.price < hi && far) push("between-levels", "soft", "Price is between major levels, not at the trigger");
    }
  }
  if (i.rvol !== null && i.rvol < 0.7) push("volume", "soft", `Insufficient volume (RVOL ${i.rvol.toFixed(2)}x)`);
  if (i.choppy) push("choppy", "soft", "Choppy market on the 5-minute chart");
  if (i.align && i.align.conflict) push("conflict", "soft", `Conflicting timeframes (${i.align.against.join(", ") || "split"} against)`);
  if (i.room && i.room.grade === "POOR") push("room", "soft", "Major level in the way, no room to run");
  if (i.contract) {
    if (i.contract.spreadPct !== null && i.contract.spreadPct > i.maxSpreadPct) push("spread", "hard", `Wide option spread (${i.contract.spreadPct}%)`);
    if (i.contract.openInterest < 100 && i.contract.volume < 50) push("liquidity", "hard", "Low option liquidity (thin open interest and volume)");
    if (i.contract.score < 45) push("chain-quality", "hard", `Insufficient option chain quality (best contract ${i.contract.score}/100)`);
    if (i.contract.iv !== null && i.contract.iv > 2) push("iv", "soft", `Extreme implied volatility (${Math.round(i.contract.iv * 100)}%)`);
  } else if (i.plan) push("no-contract", "hard", "No scored contract on the chain");
  if (i.minutesToEvent !== null && i.minutesToEvent >= 0 && i.minutesToEvent <= i.eventBufferMinutes) push("event", "soft", `High-impact event in ${Math.round(i.minutesToEvent)} minutes`);
  if (i.riskLimitBreached) push("risk", "hard", i.riskLimitBreached);
  return out;
}

export const hasHard = (rules: NoTradeRule[]) => rules.some((r) => r.severity === "hard");
