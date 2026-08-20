// ─────────────────────────────────────────────────────────
// Interpretation layer: what each number MEANS.
//
// One place that turns a raw metric into a verdict (good / caution /
// bad / neutral) plus a plain-English explanation. Shared by the
// scanner table, the stock detail rail, and the glossary so the
// wording can never drift between screens.
//
// Verdicts are contextual guidance, not predictions. "Good" means the
// reading is constructive for a long setup, not that the trade works.
// ─────────────────────────────────────────────────────────

export type Verdict = "good" | "ok" | "caution" | "bad" | "neutral";

export interface Interpretation {
  verdict: Verdict;
  /** Short badge text, e.g. "Heavy volume". */
  label: string;
  /** One sentence explaining what the number means. */
  meaning: string;
}

export const VERDICT_CLASS: Record<Verdict, string> = {
  good: "text-bull",
  ok: "text-brand-glow",
  caution: "text-warn",
  bad: "text-bear",
  neutral: "text-ink-muted",
};

export const VERDICT_DOT: Record<Verdict, string> = {
  good: "bg-bull",
  ok: "bg-brand-glow",
  caution: "bg-warn",
  bad: "bg-bear",
  neutral: "bg-ink-faint",
};

/** What the metric measures, independent of its current value. */
export const METRIC_GLOSSARY: Record<string, { title: string; what: string; goodWhen: string; badWhen: string }> = {
  rvol: {
    title: "RVOL (Relative Volume)",
    what: "Today's volume compared with this stock's own 30-day average. 3x means three times its normal participation.",
    goodWhen: "Above 2x — unusual attention, moves are more likely to follow through.",
    badWhen: "Below 1x — quieter than normal, so a price move lacks conviction behind it.",
  },
  changePct: {
    title: "Day Change %",
    what: "Percentage move from the previous session's close.",
    goodWhen: "Positive with volume confirming it.",
    badWhen: "Large gains on low volume, which often fade.",
  },
  vwapDistancePct: {
    title: "VWAP Distance",
    what: "How far price sits from the volume-weighted average price since the recent base. VWAP is roughly what the average buyer paid.",
    goodWhen: "Slightly above (0-4%) — buyers are in profit and tend to defend the level.",
    badWhen: "Far above (8%+) means chasing; below zero means the average buyer is underwater.",
  },
  atrPct: {
    title: "ATR % (Volatility)",
    what: "Average daily range as a percentage of price. A 5% ATR means this stock typically swings 5% a day.",
    goodWhen: "2-6% — enough movement to profit from, still manageable risk.",
    badWhen: "Above 10% — stops must be very wide, and gaps can blow through them.",
  },
  rsi14: {
    title: "RSI (14)",
    what: "Momentum oscillator from 0-100 measuring the speed of recent gains versus losses.",
    goodWhen: "55-70 — strong momentum that isn't yet exhausted.",
    badWhen: "Above 80 is overbought and prone to pausing; below 30 means sellers are in control.",
  },
  emaState: {
    title: "EMA Structure",
    what: "The relationship between the 9, 20 and 50 exponential moving averages.",
    goodWhen: "9 > 20 > 50 (stacked) — every timeframe agrees the trend is up.",
    badWhen: "9 < 20 with price below both — the short-term trend has broken down.",
  },
  macdState: {
    title: "MACD",
    what: "Trend/momentum indicator comparing a fast and slow moving average, with a signal line.",
    goodWhen: "Bullish and expanding — momentum is building.",
    badWhen: "Bearish, or bullish but contracting, which signals momentum fading.",
  },
  coilPct: {
    title: "Coil Tightness",
    what: "How wide the last 8 sessions' range is. A tight coil means price is compressing.",
    goodWhen: "Under 6% — energy building for a decisive move, usually in the trend's direction.",
    badWhen: "Above 12% — no compression, so there is no clear level to trade against.",
  },
  dollarVolume: {
    title: "Dollar Volume",
    what: "Shares traded multiplied by price: the actual money flowing through the stock.",
    goodWhen: "Above $10M/day — you can enter and exit without moving the price.",
    badWhen: "Under $1M/day — thin, with wide spreads and real slippage risk.",
  },
  floatShares: {
    title: "Float",
    what: "Shares actually available to trade, excluding insider and restricted holdings.",
    goodWhen: "Under 20M with a catalyst — thin supply means demand moves price fast.",
    badWhen: "Low float cuts both ways: the same thin supply makes reversals violent.",
  },
  marketCap: {
    title: "Market Cap",
    what: "Total company value: share price times shares outstanding.",
    goodWhen: "Matched to your strategy — large caps trend steadily, small caps move faster.",
    badWhen: "Micro caps under $300M carry higher dilution and delisting risk.",
  },
  setupScore: {
    title: "Setup Score",
    what: "Our transparent 0-100 rating summing momentum, volume, VWAP, structure, liquidity and health, minus extension risk.",
    goodWhen: "70+ (grade A/B) — most components are aligned.",
    badWhen: "Below 55 — the pieces disagree with each other.",
  },
  gapPct: {
    title: "Gap %",
    what: "How far the open moved from the prior close, usually caused by overnight news.",
    goodWhen: "A modest gap up that holds and builds through the session.",
    badWhen: "A large gap that immediately fades, trapping buyers.",
  },
};

/** Turn a metric value into a verdict + explanation. */
export function interpret(key: string, value: unknown): Interpretation | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);

  switch (key) {
    case "rvol": {
      if (n >= 5) return { verdict: "good", label: "Explosive volume", meaning: `${n.toFixed(1)}x normal volume — major participation.` };
      if (n >= 2) return { verdict: "good", label: "Heavy volume", meaning: `${n.toFixed(1)}x normal volume — real interest behind the move.` };
      if (n >= 1.3) return { verdict: "ok", label: "Above average", meaning: `${n.toFixed(1)}x normal volume — mild pickup in activity.` };
      if (n >= 0.8) return { verdict: "neutral", label: "Normal", meaning: "Volume in line with this stock's average." };
      return { verdict: "caution", label: "Quiet", meaning: `Only ${n.toFixed(1)}x normal volume — moves lack conviction.` };
    }
    case "changePct": {
      if (n >= 10) return { verdict: "good", label: "Big gainer", meaning: `Up ${n.toFixed(1)}% today.` };
      if (n >= 2) return { verdict: "good", label: "Green", meaning: `Up ${n.toFixed(1)}% today.` };
      if (n > -2) return { verdict: "neutral", label: "Flat", meaning: "Little net movement today." };
      if (n > -10) return { verdict: "caution", label: "Red", meaning: `Down ${Math.abs(n).toFixed(1)}% today.` };
      return { verdict: "bad", label: "Heavy selling", meaning: `Down ${Math.abs(n).toFixed(1)}% today.` };
    }
    case "vwapDistancePct": {
      if (n >= 8) return { verdict: "caution", label: "Extended", meaning: `${n.toFixed(1)}% above VWAP — stretched; chasing here is expensive.` };
      if (n >= 0) return { verdict: "good", label: "Above VWAP", meaning: `${n.toFixed(1)}% above VWAP — buyers since the base are in profit.` };
      if (n >= -3) return { verdict: "caution", label: "Below VWAP", meaning: `${Math.abs(n).toFixed(1)}% under VWAP — average buyer is slightly underwater.` };
      return { verdict: "bad", label: "Well below VWAP", meaning: `${Math.abs(n).toFixed(1)}% under VWAP — sellers control the tape.` };
    }
    case "atrPct": {
      if (n >= 10) return { verdict: "bad", label: "Extreme volatility", meaning: `Swings ~${n.toFixed(1)}% daily — stops must be very wide.` };
      if (n >= 6) return { verdict: "caution", label: "High volatility", meaning: `Swings ~${n.toFixed(1)}% daily — size down accordingly.` };
      if (n >= 2) return { verdict: "good", label: "Tradeable range", meaning: `Swings ~${n.toFixed(1)}% daily — workable movement.` };
      return { verdict: "neutral", label: "Low volatility", meaning: `Only ~${n.toFixed(1)}% daily range — limited room to profit.` };
    }
    case "rsi14": {
      if (n >= 80) return { verdict: "caution", label: "Overbought", meaning: `RSI ${n.toFixed(0)} — extended; pullback risk elevated.` };
      if (n >= 55) return { verdict: "good", label: "Strong momentum", meaning: `RSI ${n.toFixed(0)} — strong but not exhausted.` };
      if (n >= 45) return { verdict: "neutral", label: "Neutral", meaning: `RSI ${n.toFixed(0)} — no clear momentum edge.` };
      if (n >= 30) return { verdict: "caution", label: "Weak", meaning: `RSI ${n.toFixed(0)} — sellers have the upper hand.` };
      return { verdict: "bad", label: "Oversold", meaning: `RSI ${n.toFixed(0)} — heavily sold; bounces are counter-trend.` };
    }
    case "coilPct": {
      if (n <= 4) return { verdict: "good", label: "Tight coil", meaning: `${n.toFixed(1)}% 8-day range — heavy compression, energy building.` };
      if (n <= 8) return { verdict: "ok", label: "Compressing", meaning: `${n.toFixed(1)}% 8-day range — narrowing.` };
      if (n <= 15) return { verdict: "neutral", label: "Normal range", meaning: `${n.toFixed(1)}% 8-day range.` };
      return { verdict: "caution", label: "Wide range", meaning: `${n.toFixed(1)}% 8-day range — choppy, no clean level.` };
    }
    case "dollarVolume": {
      if (n >= 50e6) return { verdict: "good", label: "Very liquid", meaning: `$${(n / 1e6).toFixed(0)}M traded — fills easily.` };
      if (n >= 10e6) return { verdict: "good", label: "Liquid", meaning: `$${(n / 1e6).toFixed(0)}M traded — comfortable size.` };
      if (n >= 2e6) return { verdict: "ok", label: "Adequate", meaning: `$${(n / 1e6).toFixed(1)}M traded — expect some slippage.` };
      return { verdict: "caution", label: "Thin", meaning: `Only $${(n / 1e6).toFixed(2)}M traded — wide spreads and slippage risk.` };
    }
    case "floatShares": {
      if (n < 5e6) return { verdict: "caution", label: "Ultra low float", meaning: `${(n / 1e6).toFixed(1)}M shares — explosive both directions.` };
      if (n < 20e6) return { verdict: "ok", label: "Low float", meaning: `${(n / 1e6).toFixed(1)}M shares — thin supply amplifies moves.` };
      if (n < 50e6) return { verdict: "neutral", label: "Moderate float", meaning: `${(n / 1e6).toFixed(0)}M shares.` };
      return { verdict: "neutral", label: "Large float", meaning: `${(n / 1e6).toFixed(0)}M shares — takes real volume to move.` };
    }
    case "setupScore": {
      if (n >= 85) return { verdict: "good", label: "A setup", meaning: `Score ${n} — components strongly aligned.` };
      if (n >= 70) return { verdict: "good", label: "B setup", meaning: `Score ${n} — mostly aligned.` };
      if (n >= 55) return { verdict: "ok", label: "C setup", meaning: `Score ${n} — mixed signals.` };
      return { verdict: "caution", label: "D setup", meaning: `Score ${n} — components disagree.` };
    }
    case "gapPct": {
      if (n >= 10) return { verdict: "caution", label: "Large gap", meaning: `Gapped ${n.toFixed(1)}% — watch whether it holds.` };
      if (n >= 2) return { verdict: "good", label: "Gap up", meaning: `Gapped up ${n.toFixed(1)}%.` };
      if (n > -2) return { verdict: "neutral", label: "No gap", meaning: "Opened near the prior close." };
      return { verdict: "caution", label: "Gap down", meaning: `Gapped down ${Math.abs(n).toFixed(1)}%.` };
    }
    case "emaState": {
      const s = String(value);
      if (s.includes("9>20>50") || s.includes("9 > 20 > 50")) return { verdict: "good", label: "Stacked", meaning: "EMA 9 > 20 > 50 — all timeframes agree the trend is up." };
      if (s.startsWith("9>20") || s.startsWith("9 > 20")) return { verdict: "ok", label: "Short-term up", meaning: "9 above 20, but the 50 is not aligned yet." };
      if (s === "Compressed") return { verdict: "ok", label: "Compressed", meaning: "EMAs converging — a directional move often follows." };
      if (s === "Breakdown") return { verdict: "bad", label: "Breakdown", meaning: "Price below the EMAs — short-term trend has broken." };
      return { verdict: "caution", label: "Not aligned", meaning: "9 below 20 — short-term momentum is negative." };
    }
    case "macdState": {
      const s = String(value);
      if (s.includes("Bullish Cross")) return { verdict: "good", label: "Bull cross", meaning: "MACD just crossed above its signal — momentum turning up." };
      if (s.includes("expanding") || s === "Expanding") return { verdict: "good", label: "Expanding", meaning: "Histogram growing — momentum building." };
      if (s.includes("Bullish")) return { verdict: "ok", label: "Bullish", meaning: "MACD above signal, though momentum is not accelerating." };
      if (s.includes("Bearish")) return { verdict: "caution", label: "Bearish", meaning: "MACD below its signal — momentum is negative." };
      return { verdict: "neutral", label: s, meaning: "MACD is neutral." };
    }
    default:
      return null;
  }
}
