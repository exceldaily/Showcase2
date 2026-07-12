// ─────────────────────────────────────────────────────────
// Mock data — lets the entire UI render before any API keys exist.
// Every object here mirrors the real types, so swapping in live data
// later is a drop-in replacement. Numbers are illustrative only.
// ─────────────────────────────────────────────────────────

import { buildScoreBreakdown, computeRiskReward, computeSmartMoneyScore } from "@/lib/scoring";
import type {
  RegimeSnapshot,
  SectorStrength,
  TradeSetup,
} from "@/lib/types";

export const MOCK_REGIME: RegimeSnapshot = {
  regime: "Bull",
  spyTrend: "up",
  qqqTrend: "up",
  vix: 16.4,
  breadth: 63,
  tradeGate: "Favor growth, AI, semis, crypto, energy momentum",
  note: "Healthy uptrend with normal volatility. Standard playbook applies.",
  updatedAt: new Date().toISOString(),
};

export const MOCK_SECTORS: SectorStrength[] = [
  { sector: "AI", score: 88, rank: 1, momentum5d: 4.2, momentum20d: 11.8 },
  { sector: "Semiconductors", score: 84, rank: 2, momentum5d: 3.6, momentum20d: 9.4 },
  { sector: "Crypto", score: 79, rank: 3, momentum5d: 6.1, momentum20d: 14.2 },
  { sector: "Energy", score: 72, rank: 4, momentum5d: 1.9, momentum20d: 5.1 },
  { sector: "Oil", score: 68, rank: 5, momentum5d: 1.2, momentum20d: 3.3 },
  { sector: "Biotech", score: 61, rank: 6, momentum5d: -0.4, momentum20d: 2.0 },
  { sector: "Pharmaceuticals", score: 54, rank: 7, momentum5d: -1.1, momentum20d: 0.6 },
];

function sm(p: Parameters<typeof computeSmartMoneyScore>[0]) {
  return computeSmartMoneyScore(p);
}

export const MOCK_SETUPS: TradeSetup[] = [
  (() => {
    const plan = {
      entryZoneLow: 182.5,
      entryZoneHigh: 185.0,
      entryAggressive: 185.4,
      entryConservative: 183.2,
      stopLoss: 176.8,
      stopBasis: "Below 20 EMA + prior breakout pivot",
      target1: 194.0,
      target2: 203.5,
      target3: 215.0,
      expectedPctMove: 11.1,
      expectedHoldDays: 9,
      riskReward: 0,
    };
    plan.riskReward = computeRiskReward(plan);
    const scores = buildScoreBreakdown({
      catalyst: 88,
      smartMoney: 86,
      technical: 82,
      sectorStrength: 88,
      marketRegime: 80,
    });
    return {
      id: "nvda-breakout",
      ticker: "NVDA",
      company: "NVIDIA Corp.",
      sector: "Semiconductors",
      opportunityType: "Established Leader",
      setupType: "Breakout",
      currentPrice: 184.2,
      priceAsOf: null,
      priceLabel: "Demo data",
      marketRegime: "Bull",
      catalyst: {
        headline: "NVIDIA signs multi-year data-center GPU supply agreement with major hyperscaler",
        source: "Benzinga",
        publishedAt: new Date(Date.now() - 6 * 3600e3).toISOString(),
        level: 4,
        type: "Large Contract Award",
        summary:
          "Multi-year accelerator commitment expands visibility into FY27 data-center revenue and reinforces AI infrastructure demand. Transformational for forward estimates.",
      },
      scores,
      smartMoney: sm({
        institutionalAccumulation: 23,
        revenueGrowth: 19,
        earningsGrowth: 14,
        relativeVolume: 13,
        insiderBuying: 4,
        newsCatalyst: 9,
        sectorStrength: 5,
      }),
      plan,
      riskRating: "Medium",
      bullThesis:
        "Breaking out of a multi-week base on a transformational supply contract, with sector leadership and institutional accumulation behind it. Clean structure, defined risk under the 20 EMA.",
      bearThesis:
        "Extended from the 200 EMA and richly valued — a broad-market risk-off or a single AI-capex headline could trigger fast mean reversion.",
      decision: "Buy Now",
      generatedAt: new Date().toISOString(),
    } as TradeSetup;
  })(),

  (() => {
    const plan = {
      entryZoneLow: 41.2,
      entryZoneHigh: 42.6,
      entryAggressive: 42.9,
      entryConservative: 41.6,
      stopLoss: 38.4,
      stopBasis: "Below VWAP reclaim low",
      target1: 46.0,
      target2: 51.5,
      target3: 57.0,
      expectedPctMove: 18.4,
      expectedHoldDays: 12,
      riskReward: 0,
    };
    plan.riskReward = computeRiskReward(plan);
    const scores = buildScoreBreakdown({
      catalyst: 82,
      smartMoney: 80,
      technical: 84,
      sectorStrength: 79,
      marketRegime: 80,
    });
    return {
      id: "coin-vwap",
      ticker: "COIN",
      company: "Coinbase Global",
      sector: "Crypto",
      opportunityType: "Emerging Growth",
      setupType: "VWAP Reclaim",
      currentPrice: 41.9,
      priceAsOf: null,
      priceLabel: "Demo data",
      marketRegime: "Bull",
      catalyst: {
        headline: "Spot crypto ETF inflows hit record week; exchange volumes surge",
        source: "NewsAPI",
        publishedAt: new Date(Date.now() - 14 * 3600e3).toISOString(),
        level: 3,
        type: "Crypto ETF Development",
        summary:
          "Record ETF inflows drive exchange transaction revenue. Major catalyst for crypto-linked equities as on-chain activity accelerates.",
      },
      scores,
      smartMoney: sm({
        institutionalAccumulation: 18,
        revenueGrowth: 18,
        earningsGrowth: 11,
        relativeVolume: 12,
        insiderBuying: 6,
        newsCatalyst: 8,
        sectorStrength: 4,
      }),
      plan,
      riskRating: "High",
      bullThesis:
        "Reclaimed VWAP on heavy volume into a crypto ETF inflow catalyst, with revenue re-accelerating. Strong reward/risk if BTC holds its trend.",
      bearThesis:
        "High-beta proxy for crypto — a sharp BTC pullback would drag it well below the stop. Regulatory headline risk is ever-present.",
      decision: "Buy Now",
      generatedAt: new Date().toISOString(),
    } as TradeSetup;
  })(),

  (() => {
    const plan = {
      entryZoneLow: 28.4,
      entryZoneHigh: 29.3,
      entryAggressive: 29.5,
      entryConservative: 28.7,
      stopLoss: 26.6,
      stopBasis: "Below IPO base low",
      target1: 32.0,
      target2: 36.5,
      target3: 41.0,
      expectedPctMove: 22.5,
      expectedHoldDays: 15,
      riskReward: 0,
    };
    plan.riskReward = computeRiskReward(plan);
    const scores = buildScoreBreakdown({
      catalyst: 80,
      smartMoney: 78,
      technical: 86,
      sectorStrength: 84,
      marketRegime: 80,
    });
    return {
      id: "arm-ipobase",
      ticker: "ARM",
      company: "Arm Holdings",
      sector: "Semiconductors",
      opportunityType: "Fresh IPO",
      setupType: "IPO Base Breakout",
      currentPrice: 29.0,
      priceAsOf: null,
      priceLabel: "Demo data",
      marketRegime: "Bull",
      catalyst: {
        headline: "Arm raises licensing guidance on AI edge-compute design wins",
        source: "Benzinga",
        publishedAt: new Date(Date.now() - 20 * 3600e3).toISOString(),
        level: 3,
        type: "Earnings / Guidance Raise",
        summary:
          "Guidance raise driven by AI edge-compute royalty design wins. Strong relative strength building as the post-IPO base resolves higher.",
      },
      scores,
      smartMoney: sm({
        institutionalAccumulation: 17,
        revenueGrowth: 19,
        earningsGrowth: 12,
        relativeVolume: 11,
        insiderBuying: 3,
        newsCatalyst: 8,
        sectorStrength: 5,
      }),
      plan,
      riskRating: "High",
      bullThesis:
        "Breaking out of its first clean post-IPO base into a guidance raise, with institutions building positions and the semis sector leading.",
      bearThesis:
        "Thin trading history, lockup-driven supply overhang, and rich multiple mean any growth wobble gets punished hard.",
      decision: "Wait For Pullback",
      generatedAt: new Date().toISOString(),
    } as TradeSetup;
  })(),
];

export function getMockSetupById(id: string): TradeSetup | undefined {
  return MOCK_SETUPS.find((s) => s.id === id);
}
