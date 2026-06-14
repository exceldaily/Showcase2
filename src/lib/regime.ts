// ─────────────────────────────────────────────────────────
// Market Regime Engine
// Classifies the overall market BEFORE any trades are generated.
// Gates trade aggressiveness per the approved plan rules.
// ─────────────────────────────────────────────────────────

import type { MarketRegime, RegimeSnapshot } from "./types";

export interface RegimeInputs {
  spyAbove50d: boolean;
  qqqAbove50d: boolean;
  vix: number;
  breadth: number; // 0-100, % of stocks advancing
  spyWeekChangePct: number;
}

export function classifyRegime(inputs: RegimeInputs): MarketRegime {
  const { spyAbove50d, qqqAbove50d, vix, breadth, spyWeekChangePct } = inputs;

  // Risk-Off takes priority — capital preservation first.
  if (vix > 30 || (spyWeekChangePct <= -5 && breadth < 30)) {
    return "High Volatility Risk-Off";
  }
  if (spyAbove50d && qqqAbove50d && vix < 15 && breadth > 70) {
    return "Strong Bull";
  }
  if (spyAbove50d && qqqAbove50d && vix >= 15 && vix <= 20) {
    return "Bull";
  }
  if (!spyAbove50d && !qqqAbove50d && vix > 25) {
    return "Bear";
  }
  return "Neutral";
}

export function regimeScore(regime: MarketRegime): number {
  switch (regime) {
    case "Strong Bull":
      return 95;
    case "Bull":
      return 80;
    case "Neutral":
      return 55;
    case "Bear":
      return 30;
    case "High Volatility Risk-Off":
      return 12;
  }
}

export function tradeGate(regime: MarketRegime): string {
  switch (regime) {
    case "Strong Bull":
      return "Aggressive growth & breakout trades allowed";
    case "Bull":
      return "Favor growth, AI, semis, crypto, energy momentum";
    case "Neutral":
      return "Require stronger setups — be selective";
    case "Bear":
      return "Reduce trade frequency — defense first";
    case "High Volatility Risk-Off":
      return "Avoid new swing trades unless exceptional";
  }
}

export function regimeNote(regime: MarketRegime): string {
  switch (regime) {
    case "Strong Bull":
      return "Broad participation, low fear. Trend-following edge is strongest here.";
    case "Bull":
      return "Healthy uptrend with normal volatility. Standard playbook applies.";
    case "Neutral":
      return "Mixed signals. Only the cleanest, highest-conviction setups clear the bar.";
    case "Bear":
      return "Downtrend in major indices. Counter-trend longs are low-probability.";
    case "High Volatility Risk-Off":
      return "Elevated fear. Correlations spike to 1. Sit on hands unless a setup is exceptional.";
  }
}

export function buildRegimeSnapshot(inputs: RegimeInputs): RegimeSnapshot {
  const regime = classifyRegime(inputs);
  return {
    regime,
    spyTrend: inputs.spyAbove50d ? "up" : "down",
    qqqTrend: inputs.qqqAbove50d ? "up" : "down",
    vix: inputs.vix,
    breadth: inputs.breadth,
    tradeGate: tradeGate(regime),
    note: regimeNote(regime),
    updatedAt: new Date().toISOString(),
  };
}
