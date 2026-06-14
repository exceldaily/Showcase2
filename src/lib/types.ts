// ─────────────────────────────────────────────────────────
// AlphaForge core domain types
// ─────────────────────────────────────────────────────────

export type Sector =
  | "AI"
  | "Semiconductors"
  | "Oil"
  | "Energy"
  | "Crypto"
  | "Biotech"
  | "Pharmaceuticals";

export const SECTORS: Sector[] = [
  "AI",
  "Semiconductors",
  "Oil",
  "Energy",
  "Crypto",
  "Biotech",
  "Pharmaceuticals",
];

export type OpportunityType =
  | "Established Leader"
  | "Emerging Growth"
  | "Fresh IPO"
  | "High Risk Speculative";

export type SetupType =
  | "Breakout"
  | "Pullback"
  | "VWAP Reclaim"
  | "Opening Range Breakout"
  | "News Momentum"
  | "Earnings Continuation"
  | "Sector Rotation"
  | "IPO Base Breakout";

export type MarketRegime =
  | "Strong Bull"
  | "Bull"
  | "Neutral"
  | "Bear"
  | "High Volatility Risk-Off";

export type Decision =
  | "Buy Now"
  | "Wait For Pullback"
  | "Watchlist Only"
  | "Avoid";

export type RiskRating = "Low" | "Medium" | "High";

export type CatalystLevel = 1 | 2 | 3 | 4; // Noise | Relevant | Major | Transformational

export interface CatalystEvent {
  headline: string;
  source: string;
  publishedAt: string;
  level: CatalystLevel;
  type: string;
  summary: string;
}

export interface ScoreBreakdown {
  catalyst: number; // 0-100
  smartMoney: number; // 0-100
  technical: number; // 0-100
  sectorStrength: number; // 0-100
  marketRegime: number; // 0-100
  alphaforge: number; // 0-100 weighted final
  confidence: number; // 0-100
}

export interface SmartMoneyBreakdown {
  institutionalAccumulation: number;
  revenueGrowth: number;
  earningsGrowth: number;
  relativeVolume: number;
  insiderBuying: number;
  newsCatalyst: number;
  sectorStrength: number;
  total: number; // 0-100
}

export interface TradePlan {
  entryZoneLow: number;
  entryZoneHigh: number;
  entryAggressive: number;
  entryConservative: number;
  stopLoss: number;
  stopBasis: string;
  target1: number;
  target2: number;
  target3: number;
  expectedPctMove: number;
  expectedHoldDays: number;
  riskReward: number;
}

export interface TradeSetup {
  id: string;
  ticker: string;
  company: string;
  sector: Sector;
  opportunityType: OpportunityType;
  setupType: SetupType;
  currentPrice: number;
  marketRegime: MarketRegime;
  catalyst: CatalystEvent;
  scores: ScoreBreakdown;
  smartMoney: SmartMoneyBreakdown;
  plan: TradePlan;
  riskRating: RiskRating;
  bullThesis: string;
  bearThesis: string;
  decision: Decision;
  generatedAt: string;
}

export interface SectorStrength {
  sector: Sector;
  score: number; // 0-100
  rank: number;
  momentum5d: number;
  momentum20d: number;
}

export interface RegimeSnapshot {
  regime: MarketRegime;
  spyTrend: "up" | "down" | "flat";
  qqqTrend: "up" | "down" | "flat";
  vix: number;
  breadth: number; // 0-100 (% advancing)
  tradeGate: string;
  note: string;
  updatedAt: string;
}

// Risk math helper for position sizing
export interface PositionSizing {
  positionSize: number; // dollars
  shares: number;
  dollarRisk: number;
  dollarReward: number;
  maxLoss: number;
  expectedGain: number;
}
