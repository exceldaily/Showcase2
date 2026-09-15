// ─────────────────────────────────────────────────────────
// Contract classification, quality metrics and warnings (pure).
// The scorer (optionsScore.ts) ranks; this layer explains the ranking
// in trader terms and tags the chain:
//
//   BEST          top score on its side (the recommendation)
//   ALTERNATIVE   next two by score on that side
//   AGGRESSIVE    cheaper, lower delta, higher gamma than BEST
//   CONSERVATIVE  deeper in the money, higher delta than BEST
// ─────────────────────────────────────────────────────────

export type ContractTag = "BEST" | "ALTERNATIVE" | "AGGRESSIVE" | "CONSERVATIVE";

export interface RankableContract {
  symbol: string;
  side: "call" | "put";
  strike: number;
  expiry: string;
  dte: number;
  mid: number;
  spreadPct: number | null;
  volume: number;
  openInterest: number;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  score: number;
  stale: boolean;
  breakEven: number;
}

export interface ContractQuality {
  /** 0-100 from option volume and open interest. */
  liquidity: number;
  /** 0-100 from the spread against the profile's limit. */
  spreadQuality: number;
  /** Theta as a percent of the premium per day (positive number = decay). */
  thetaImpactPct: number | null;
  /** Estimated premium change per $1 move in the underlying, per share. */
  directionalSensitivity: number | null;
  /** The scorer's total. */
  overall: number;
}

export function contractQuality(c: RankableContract, maxSpreadPct: number): ContractQuality {
  const liq = Math.min(1, Math.log10(1 + c.volume) / 3.7) * 55 + Math.min(1, Math.log10(1 + c.openInterest) / 4) * 45;
  const spread = c.spreadPct === null ? 0 : Math.max(0, Math.min(100, (1 - c.spreadPct / (maxSpreadPct * 2)) * 100));
  const theta = c.theta !== null && c.mid > 0 ? Math.round((Math.abs(c.theta) / c.mid) * 1000) / 10 : null;
  const sens = c.delta !== null ? Math.round((Math.abs(c.delta) + (c.gamma ?? 0) * 0.5) * 100) / 100 : null;
  return { liquidity: Math.round(liq), spreadQuality: Math.round(spread), thetaImpactPct: theta, directionalSensitivity: sens, overall: c.score };
}

export interface ContractWarning {
  key: "spread" | "oi" | "volume" | "iv" | "liquidity" | "theta" | "premium" | "stale";
  text: string;
}

export function contractWarnings(c: RankableContract, maxSpreadPct: number, underlying: number | null): ContractWarning[] {
  const out: ContractWarning[] = [];
  if (c.stale) out.push({ key: "stale", text: "Stale quote" });
  if (c.spreadPct !== null && c.spreadPct > maxSpreadPct) out.push({ key: "spread", text: `Wide spread ${c.spreadPct}%` });
  if (c.openInterest < 100) out.push({ key: "oi", text: `Low open interest (${c.openInterest})` });
  if (c.volume < 50) out.push({ key: "volume", text: `Low volume (${c.volume})` });
  if (c.openInterest < 100 && c.volume < 50) out.push({ key: "liquidity", text: "Poor liquidity" });
  if (c.iv !== null && c.iv > 1.5) out.push({ key: "iv", text: `Extreme IV ${Math.round(c.iv * 100)}%` });
  if (c.theta !== null && c.mid > 0 && Math.abs(c.theta) / c.mid > 0.12) out.push({ key: "theta", text: `High theta decay (${Math.round((Math.abs(c.theta) / c.mid) * 100)}%/day)` });
  if (underlying && underlying > 0 && c.mid / underlying > 0.12) out.push({ key: "premium", text: "Excessive premium vs the stock" });
  return out;
}

/** Tags one side's contracts. `list` must be sorted by score, best first. */
export function tagContracts(list: RankableContract[]): Map<string, ContractTag> {
  const tags = new Map<string, ContractTag>();
  const best = list[0];
  if (!best) return tags;
  tags.set(best.symbol, "BEST");
  for (const c of list.slice(1, 3)) tags.set(c.symbol, "ALTERNATIVE");
  const pool = list.slice(0, 10).filter((c) => c.score >= 45 && c.expiry === best.expiry && !c.stale);
  const bd = Math.abs(best.delta ?? 0.5);
  // Aggressive: lower delta (further out), cheaper, still liquid enough to score.
  const aggressive = pool.filter((c) => c.symbol !== best.symbol && c.delta !== null && Math.abs(c.delta) < bd - 0.08 && c.mid < best.mid).sort((a, b) => (b.gamma ?? 0) - (a.gamma ?? 0))[0];
  // Conservative: higher delta (deeper in the money).
  const conservative = pool.filter((c) => c.symbol !== best.symbol && c.delta !== null && Math.abs(c.delta) > bd + 0.08).sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0))[0];
  if (aggressive && !tags.has(aggressive.symbol)) tags.set(aggressive.symbol, "AGGRESSIVE");
  if (conservative && !tags.has(conservative.symbol)) tags.set(conservative.symbol, "CONSERVATIVE");
  return tags;
}

/** Percent move in the underlying needed to reach the break-even at expiry. */
export function distanceToBreakEvenPct(c: Pick<RankableContract, "side" | "breakEven">, underlying: number | null): number | null {
  if (!underlying || underlying <= 0) return null;
  const d = ((c.breakEven - underlying) / underlying) * 100;
  return Math.round((c.side === "call" ? d : -d) * 100) / 100;
}
