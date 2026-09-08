// Realistic sample data for email previews and the "send me a sample"
// hook. Clearly fake: used only to show what a real message looks like.
import type { MorningWatch } from "./morningWatch";
import type { SirenAlert } from "./sirenRules";

export const SAMPLE_WATCH: MorningWatch = {
  day: "2026-09-08", computedAt: "2026-09-08T13:10:00Z", locked: true, lockedAt: "2026-09-08T13:10:00Z",
  session: "premarket", sessionToday: true, ranked: [],
  notes: ["Premarket prices are thin. Gaps can fill or reverse in the first minutes after 9:30."],
  picks: [
    {
      rank: 1, symbol: "NVDA", price: 234.5, gapPct: 1.8, volRatio: 0.066, todayVolume: 9e6, bias: "calls", score: 78, preScore: 74,
      opportunity: 71, trend: "Bullish", dailyTrend: "Bullish", state: "APPROACHING", trigger: 234.76, invalidation: 232.9, target: 237.4,
      history: { confirmed: 17, t1Hit: 4 },
      bestCall: { symbol: "NVDA260908C00235000", strike: 235, expiry: "2026-09-08", mid: 2.15, score: 76 },
      bestPut: { symbol: "NVDA260908P00232500", strike: 232.5, expiry: "2026-09-08", mid: 1.9, score: 61 },
      why: ["Up 1.80% premarket (last close $230.36).", "Heavy interest: 9.0M shares already, 7% of a full normal day before the open.", "Sitting 0.11% under yesterday's high $234.76. A push through that is the breakout to watch."],
    },
    {
      rank: 2, symbol: "TSLA", price: 340, gapPct: -2.86, volRatio: 0.044, todayVolume: 4e6, bias: "puts", score: 70, preScore: 81,
      opportunity: 52, trend: "Bearish", dailyTrend: "Neutral", state: "WATCHING", trigger: 339.5, invalidation: 342.2, target: 334.1,
      history: null,
      bestCall: { symbol: "TSLA260911C00345000", strike: 345, expiry: "2026-09-11", mid: 6.1, score: 58 },
      bestPut: { symbol: "TSLA260911P00335000", strike: 335, expiry: "2026-09-11", mid: 5.4, score: 72 },
      why: ["Down 2.86% premarket (last close $350.00).", "Already below yesterday's low $341.00. Watch whether it stays under it after the open."],
    },
  ],
};

export const SAMPLE_ALERT: SirenAlert = {
  kind: "BREAK_CONFIRMED", direction: "long", urgency: "high", symbol: "NVDA",
  title: "NVDA BREAKOUT confirmed (82/100)",
  body: "NVDA at $235.10: 5-minute close through the level with volume. RVOL 2.10x, trend Strongly Bullish, setup score 74.",
  contract: "NVDA260908C00235000", opportunity: 74,
  orderCard: { contract: "NVDA260908C00235000", label: "NVDA 235C exp 09-08", qty: 1, limit: 2.2, stopTrigger: 1.1, stopLimit: 1.0, target: 3.6, underlyingInvalidation: 232.9, underlyingTarget: 237.4, note: "Stop = est. option value if NVDA reaches $232.90; target = est. value at $237.40. Model estimates, IV can shift them." },
  dedupeKey: "NVDA:BREAK_CONFIRMED:2026-09-08",
  summary: "NVDA just closed a 5-minute candle above the key level on 2.1x normal volume. Calls are on the table.",
  facts: { price: 235.1, rvol: 2.1, trend: "Strongly Bullish", state: "CONFIRMED", opportunity: 74, plan: { trigger: 234.76, t1: 237.4, invalidation: 232.9 }, best: { label: "NVDA 235C", expiry: "2026-09-08", dte: 0, mid: 2.15, score: 76 } },
};

/** Same samples re-dated to a given ET day so the 0DTE labels read correctly. */
export function sampleWatchFor(day: string): MorningWatch {
  const shift = (d: string) => d.replace(/^\d{4}-\d{2}-\d{2}/, day);
  return {
    ...SAMPLE_WATCH, day, computedAt: new Date().toISOString(), lockedAt: new Date().toISOString(),
    picks: SAMPLE_WATCH.picks.map((p) => ({
      ...p,
      bestCall: p.bestCall && p.symbol === "NVDA" ? { ...p.bestCall, expiry: shift(p.bestCall.expiry) } : p.bestCall,
      bestPut: p.bestPut && p.symbol === "NVDA" ? { ...p.bestPut, expiry: shift(p.bestPut.expiry) } : p.bestPut,
    })),
  };
}

export function sampleAlertFor(day: string): SirenAlert {
  return { ...SAMPLE_ALERT, facts: SAMPLE_ALERT.facts ? { ...SAMPLE_ALERT.facts, best: SAMPLE_ALERT.facts.best ? { ...SAMPLE_ALERT.facts.best, expiry: day, dte: 0 } : null } : null };
}
