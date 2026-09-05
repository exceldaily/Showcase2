// ─────────────────────────────────────────────────────────
// Option contract scoring (pure, unit-tested).
// 0-100 per contract with a full "why" breakdown. The goal is the
// best COMBINATION of liquidity, delta, spread, DTE and reachability
// — never simply the cheapest strike. Weights are configurable and
// ship with four documented profiles. A stale quote hard-caps the
// score: we do not rank a contract on data we do not trust.
// ─────────────────────────────────────────────────────────

import { dte as dteOf, moneyness, spreadPct, type Moneyness, type OptionSide } from "./optionsMath";

export interface ContractFacts {
  symbol: string;
  side: OptionSide;
  strike: number;
  expiry: string;
  bid: number;
  ask: number;
  last: number | null;
  volume: number;
  openInterest: number;
  iv: number | null;          // decimal
  delta: number | null;
  gamma: number | null;
  theta: number | null;       // per day, negative for longs
  vega: number | null;
  greeksSource: "alpaca" | "calculated" | "none";
  quoteTs: number | null;
  underlying: number;
  /** ATR-based expected favorable move to T1, in dollars. */
  expectedMove: number | null;
  stale: boolean;
}

export interface ScoreWeights {
  delta: number;
  spread: number;
  liquidity: number;   // volume + OI
  dte: number;
  moneyness: number;
  premium: number;     // affordability vs underlying (avoid lotto + avoid overpriced)
  reachability: number; // can the underlying's expected move actually pay
  gamma: number;
  theta: number;
}

export interface ScoreProfile {
  name: string;
  weights: ScoreWeights;
  idealDelta: number;
  dteRange: [number, number];
  maxSpreadPct: number;
}

/** Documented profiles; the active one is a setting. */
export const SCORE_PROFILES: Record<string, ScoreProfile> = {
  CONSERVATIVE: {
    name: "CONSERVATIVE",
    weights: { delta: 18, spread: 16, liquidity: 18, dte: 12, moneyness: 10, premium: 6, reachability: 12, gamma: 2, theta: 6 },
    idealDelta: 0.65, dteRange: [7, 45], maxSpreadPct: 6,
  },
  BALANCED: {
    name: "BALANCED",
    weights: { delta: 16, spread: 15, liquidity: 16, dte: 10, moneyness: 10, premium: 8, reachability: 14, gamma: 5, theta: 6 },
    idealDelta: 0.55, dteRange: [3, 30], maxSpreadPct: 8,
  },
  AGGRESSIVE: {
    name: "AGGRESSIVE",
    weights: { delta: 14, spread: 12, liquidity: 14, dte: 8, moneyness: 12, premium: 10, reachability: 16, gamma: 8, theta: 6 },
    idealDelta: 0.42, dteRange: [1, 21], maxSpreadPct: 10,
  },
  SCALP: {
    name: "SCALP",
    weights: { delta: 16, spread: 20, liquidity: 20, dte: 6, moneyness: 14, premium: 6, reachability: 8, gamma: 8, theta: 2 },
    idealDelta: 0.5, dteRange: [0, 7], maxSpreadPct: 5,
  },
};

export interface ContractScore {
  total: number;
  parts: { name: string; score: number; max: number; detail: string }[];
  penalties: string[];
  moneyness: Moneyness;
  stale: boolean;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function scoreContract(c: ContractFacts, profile: ScoreProfile = SCORE_PROFILES.BALANCED): ContractScore {
  const w = profile.weights;
  const parts: ContractScore["parts"] = [];
  const penalties: string[] = [];
  const add = (name: string, v01: number, max: number, detail: string) => {
    parts.push({ name, score: Math.round(clamp01(v01) * max * 10) / 10, max, detail });
  };

  const mny = moneyness(c.side, c.strike, c.underlying);
  const sp = spreadPct(c.bid, c.ask);
  const days = dteOf(c.expiry);
  const midPrice = (c.bid + c.ask) / 2;

  // Delta: closeness to the profile's ideal |delta|.
  if (c.delta !== null) {
    const d = Math.abs(c.delta);
    add("Delta", 1 - Math.min(1, Math.abs(d - profile.idealDelta) / 0.35), w.delta, `Δ ${d.toFixed(2)} vs ideal ${profile.idealDelta}`);
  } else {
    add("Delta", 0.3, w.delta, "delta unavailable");
    penalties.push("No delta available (Alpaca + local fallback both missing)");
  }

  // Spread: 0% -> full credit, at maxSpreadPct -> zero.
  if (sp !== null) {
    add("Spread", 1 - Math.min(1, sp / profile.maxSpreadPct), w.spread, `${sp.toFixed(1)}% bid/ask spread`);
    if (sp > profile.maxSpreadPct) penalties.push(`Spread ${sp.toFixed(1)}% exceeds the ${profile.maxSpreadPct}% profile cap`);
  } else {
    add("Spread", 0, w.spread, "no two-sided quote");
    penalties.push("No two-sided quote");
  }

  // Liquidity: log-scaled volume + open interest.
  const volScore = clamp01(Math.log10(1 + c.volume) / 3.7);   // ~5000 -> 1
  const oiScore = clamp01(Math.log10(1 + c.openInterest) / 4); // ~10000 -> 1
  add("Liquidity", volScore * 0.55 + oiScore * 0.45, w.liquidity, `vol ${c.volume.toLocaleString()}, OI ${c.openInterest.toLocaleString()}`);
  if (c.volume < 50) penalties.push("Very low option volume today");
  if (c.openInterest < 100) penalties.push("Thin open interest");

  // DTE: inside the profile window, tapering at the edges.
  const [dLo, dHi] = profile.dteRange;
  const dteScore = days < dLo ? clamp01(days / Math.max(0.5, dLo)) : days > dHi ? clamp01(1 - (days - dHi) / dHi) : 1;
  add("DTE", dteScore, w.dte, `${days.toFixed(1)} DTE (profile ${dLo}-${dHi})`);
  if (days < 1) penalties.push("Same-day expiry: gamma/theta are extreme");

  // Moneyness: ATM best, near-ATM fine, far OTM punished.
  const distPct = c.underlying > 0 ? (Math.abs(c.strike - c.underlying) / c.underlying) * 100 : 100;
  add("Moneyness", mny === "ATM" ? 1 : 1 - Math.min(1, distPct / 6), w.moneyness, `${mny}, ${distPct.toFixed(1)}% from spot`);
  if (mny === "OTM" && distPct > 6) penalties.push("Far OTM lottery-ticket territory");

  // Premium sanity: reward mid premiums, punish near-zero (pure theta
  // bets) and extremely expensive relative to the underlying.
  const premPctOfSpot = c.underlying > 0 ? (midPrice / c.underlying) * 100 : 0;
  add("Premium", midPrice < 0.1 ? 0.1 : premPctOfSpot > 12 ? 0.3 : 1 - Math.abs(premPctOfSpot - 2.2) / 12, w.premium, `$${midPrice.toFixed(2)} (${premPctOfSpot.toFixed(1)}% of spot)`);

  // Reachability: expected favorable move vs what the premium demands.
  if (c.expectedMove !== null && c.delta !== null && midPrice > 0) {
    const optionGain = Math.abs(c.delta) * c.expectedMove; // first-order
    add("Reachability", clamp01(optionGain / midPrice / 0.6), w.reachability, `Δ×move ≈ $${optionGain.toFixed(2)} vs $${midPrice.toFixed(2)} premium`);
  } else {
    add("Reachability", 0.4, w.reachability, "expected move unknown");
  }

  // Gamma: responsiveness (scalps love it).
  if (c.gamma !== null) add("Gamma", clamp01(c.gamma * c.underlying * 0.5), w.gamma, `γ ${c.gamma.toFixed(3)}`);
  else add("Gamma", 0.3, w.gamma, "gamma unavailable");

  // Theta burden relative to premium (per-day decay share).
  if (c.theta !== null && midPrice > 0) {
    const dailyBurn = Math.abs(c.theta) / midPrice;
    add("Theta", 1 - clamp01(dailyBurn / 0.12), w.theta, `${(dailyBurn * 100).toFixed(1)}%/day decay`);
    if (dailyBurn > 0.12) penalties.push("Theta burns >12% of premium per day");
  } else {
    add("Theta", 0.4, w.theta, "theta unavailable");
  }

  let total = parts.reduce((a, p) => a + p.score, 0);
  const maxTotal = Object.values(w).reduce((a, b) => a + b, 0);
  total = (total / maxTotal) * 100;

  if (c.stale) {
    total = Math.min(total, 25);
    penalties.push("QUOTE STALE — score capped until fresh data resumes");
  }
  if (c.greeksSource === "calculated") penalties.push("Greeks locally calculated (Black-Scholes), not exchange-supplied");

  return { total: Math.round(total), parts, penalties, moneyness: mny, stale: c.stale };
}

/** Human "why this contract" summary from the score parts. */
export function whyContract(score: ContractScore): string[] {
  const strong = score.parts.filter((p) => p.max > 0 && p.score / p.max >= 0.75).map((p) => `${p.name}: ${p.detail}`);
  return [...strong, ...score.penalties.map((p) => `⚠ ${p}`)];
}
