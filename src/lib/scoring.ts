// ─────────────────────────────────────────────────────────
// AlphaForge scoring engine
// All weighted formulas from the approved plan live here so the
// logic is in ONE place and the self-learning engine can tune it.
// ─────────────────────────────────────────────────────────

import type {
  CatalystLevel,
  Decision,
  PositionSizing,
  ScoreBreakdown,
  SmartMoneyBreakdown,
  TradePlan,
} from "./types";

// ── AlphaForge final weighting (full model, Phase 2+) ──
// Used once the news catalyst + institutional engines are live.
export const ALPHAFORGE_WEIGHTS = {
  catalyst: 0.3,
  smartMoney: 0.25,
  technical: 0.2,
  sectorStrength: 0.15,
  marketRegime: 0.1,
} as const;

// ── V1 weighting (Phase 1) ──
// Scores only what the scanner actually measures today: price/volume
// structure, sector momentum, participation, and regime. Prevents the
// stubbed Phase 2 pillars (news, 13F) from deflating every score.
export const V1_WEIGHTS = {
  technical: 0.4,
  sectorStrength: 0.25,
  momentum: 0.25, // volume/momentum proxy (labeled, not news)
  marketRegime: 0.1,
} as const;

export function computeAlphaForgeScoreV1(parts: {
  technical: number;
  sectorStrength: number;
  momentum: number;
  marketRegime: number;
}): number {
  const w = V1_WEIGHTS;
  const raw =
    parts.technical * w.technical +
    parts.sectorStrength * w.sectorStrength +
    parts.momentum * w.momentum +
    parts.marketRegime * w.marketRegime;
  return Math.round(clamp(raw, 0, 100));
}

export function computeConfidenceV1(parts: {
  technical: number;
  sectorStrength: number;
  momentum: number;
  marketRegime: number;
}): number {
  const vals = Object.values(parts);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  const stdev = Math.sqrt(variance);
  return Math.round(clamp(mean - stdev * 0.8, 0, 100));
}

// Minimum AlphaForge score to surface a setup as actionable.
export const SCORE_GATE = 80;

// Minimum reward/risk to allow a trade at all.
export const MIN_RISK_REWARD = 3;

export function computeAlphaForgeScore(parts: {
  catalyst: number;
  smartMoney: number;
  technical: number;
  sectorStrength: number;
  marketRegime: number;
}): number {
  const w = ALPHAFORGE_WEIGHTS;
  const raw =
    parts.catalyst * w.catalyst +
    parts.smartMoney * w.smartMoney +
    parts.technical * w.technical +
    parts.sectorStrength * w.sectorStrength +
    parts.marketRegime * w.marketRegime;
  return Math.round(clamp(raw, 0, 100));
}

// ── Catalyst score from classified level ──
export function catalystScoreFromLevel(
  level: CatalystLevel,
  opts: { convergingCatalysts?: boolean; hoursOld?: number; alreadyMovedPct?: number } = {}
): number {
  let base: number;
  switch (level) {
    case 4:
      base = 95;
      break;
    case 3:
      base = 77;
      break;
    case 2:
      base = 47;
      break;
    default:
      base = 15;
  }
  if (opts.convergingCatalysts) base += 10;
  if (opts.hoursOld !== undefined && opts.hoursOld < 24) base += 8;
  if (opts.alreadyMovedPct !== undefined && opts.alreadyMovedPct > 15) base -= 10;
  return Math.round(clamp(base, 0, 100));
}

// ── Smart Money Score (0-100) ──
// Sub-weights: Inst 25, Rev 20, Earn 15, RelVol 15, Insider 10, News 10, Sector 5
export function computeSmartMoneyScore(sub: {
  institutionalAccumulation: number; // 0-25
  revenueGrowth: number; // 0-20
  earningsGrowth: number; // 0-15
  relativeVolume: number; // 0-15
  insiderBuying: number; // 0-10
  newsCatalyst: number; // 0-10
  sectorStrength: number; // 0-5
}): SmartMoneyBreakdown {
  const total =
    sub.institutionalAccumulation +
    sub.revenueGrowth +
    sub.earningsGrowth +
    sub.relativeVolume +
    sub.insiderBuying +
    sub.newsCatalyst +
    sub.sectorStrength;
  return { ...sub, total: Math.round(clamp(total, 0, 100)) };
}

// ── Confidence: agreement across the five pillars ──
// High when the pillars cluster tightly and high; low when they disagree.
export function computeConfidence(parts: {
  catalyst: number;
  smartMoney: number;
  technical: number;
  sectorStrength: number;
  marketRegime: number;
}): number {
  const vals = Object.values(parts);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  const stdev = Math.sqrt(variance);
  // Penalize disagreement: every point of stdev shaves confidence.
  const confidence = mean - stdev * 0.8;
  return Math.round(clamp(confidence, 0, 100));
}

export function buildScoreBreakdown(parts: {
  catalyst: number;
  smartMoney: number;
  technical: number;
  sectorStrength: number;
  marketRegime: number;
}): ScoreBreakdown {
  return {
    ...parts,
    alphaforge: computeAlphaForgeScore(parts),
    confidence: computeConfidence(parts),
  };
}

// ── Trade plan validation + R/R ──
export function computeRiskReward(plan: {
  entryConservative: number;
  stopLoss: number;
  target2: number; // use T2 as the representative target
}): number {
  const risk = plan.entryConservative - plan.stopLoss;
  const reward = plan.target2 - plan.entryConservative;
  if (risk <= 0) return 0;
  return round2(reward / risk);
}

export function passesRiskReward(plan: TradePlan): boolean {
  return plan.riskReward >= MIN_RISK_REWARD;
}

// ── Decision logic ──
export function deriveDecision(
  alphaforgeScore: number,
  plan: TradePlan,
  currentPrice: number
): Decision {
  if (alphaforgeScore < 60 || plan.riskReward < MIN_RISK_REWARD) return "Avoid";
  if (alphaforgeScore < SCORE_GATE) return "Watchlist Only";

  // Price already inside or above the entry zone → buy; below → wait for pullback.
  if (currentPrice <= plan.entryZoneHigh && currentPrice >= plan.entryZoneLow) {
    return "Buy Now";
  }
  if (currentPrice < plan.entryZoneLow) return "Wait For Pullback";
  // Extended above the zone — wait for it to come back.
  return "Wait For Pullback";
}

// ── Position sizing / risk math ──
export function computePositionSizing(
  positionSize: number,
  entry: number,
  stop: number,
  target: number
): PositionSizing {
  const shares = Math.floor(positionSize / entry);
  const riskPerShare = entry - stop;
  const rewardPerShare = target - entry;
  return {
    positionSize,
    shares,
    dollarRisk: round2(riskPerShare * shares),
    dollarReward: round2(rewardPerShare * shares),
    maxLoss: round2(riskPerShare * shares),
    expectedGain: round2(rewardPerShare * shares),
  };
}

// ── helpers ──
export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
