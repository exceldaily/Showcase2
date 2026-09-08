// Realistic sample data for email previews and the "send me a sample"
// hook. Clearly fake: used only to show what a real message looks like.
// Option prices come from the same Black-Scholes model as the terminal
// so the strike table is internally consistent.
import type { MorningWatch, WatchPick, WatchPlay } from "./morningWatch";
import type { SirenAlert } from "./sirenRules";
import { blackScholes, yearsToExpiry } from "./optionsMath";
import { coachVerdict, strikeChoices, type CoachCandidate, type StrikeChoice } from "./strikeCoach";

function chain(symbol: string, side: "call" | "put", strikes: number[], expiry: string, underlying: number, iv: number, now: number): CoachCandidate[] {
  const T = yearsToExpiry(expiry, now);
  return strikes.map((k) => {
    const bs = blackScholes(side, underlying, k, T, iv);
    const mid = Math.max(0.01, Math.round(bs.price * 100) / 100);
    const dte = Math.floor((Date.parse(expiry + "T20:00:00Z") - now) / 86400e3);
    return { symbol: `${symbol}${expiry.slice(2).replace(/-/g, "")}${side === "call" ? "C" : "P"}${String(Math.round(k * 1000)).padStart(8, "0")}`, side, strike: k, expiry, dte: Math.max(0, dte), mid, iv, delta: Math.round(bs.delta * 100) / 100, breakEven: side === "call" ? k + mid : k - mid };
  });
}

function playFrom(symbol: string, side: "call" | "put", choices: StrikeChoice[], watch: number, sellAt: number, getOutAt: number): WatchPlay {
  const rec = choices[0];
  return {
    side, watch, buySymbol: rec.symbol, buyLabel: `${symbol} ${rec.strike}${side === "call" ? "C" : "P"}`, expiry: rec.expiry, dte: rec.dte,
    perContract: rec.perContract, sellAt, getOutAt, atTarget: rec.atTarget, atWrong: rec.atWrong, flatHour: rec.flatHour,
  };
}

/** Builds the two sample picks for a given ET day (NVDA same-day expiry, TSLA three days out). */
export function samplePicks(day: string, now = Date.now()): WatchPick[] {
  const fri = new Date(Date.parse(day + "T12:00:00Z") + 3 * 86400e3).toISOString().slice(0, 10);
  const nvdaCalls = chain("NVDA", "call", [230, 232.5, 235, 237.5, 240], day, 234.76, 0.45, now);
  const nvdaChoices = strikeChoices({ side: "call", candidates: nvdaCalls, best: nvdaCalls[2], underlying: 234.76, target: 237.4, wrong: 232.9, now, stepMinutes: 30 });
  const tslaPuts = chain("TSLA", "put", [330, 335, 340, 345, 350], fri, 340, 0.6, now);
  const tslaChoices = strikeChoices({ side: "put", candidates: tslaPuts, best: tslaPuts[2], underlying: 340, target: 334.1, wrong: 342.2, now, stepMinutes: 30 });
  return [
    {
      rank: 1, symbol: "NVDA", price: 234.5, gapPct: 1.8, volRatio: 0.066, todayVolume: 9e6, bias: "calls", score: 78, preScore: 74,
      opportunity: 71, trend: "Bullish", dailyTrend: "Bullish", state: "APPROACHING", trigger: 234.76, invalidation: 232.9, target: 237.4,
      history: { confirmed: 17, t1Hit: 4 },
      bestCall: { symbol: nvdaCalls[2].symbol, strike: 235, expiry: day, mid: nvdaCalls[2].mid, score: 76 },
      bestPut: { symbol: `NVDA${day.slice(2).replace(/-/g, "")}P00232500`, strike: 232.5, expiry: day, mid: 1.9, score: 61 },
      why: ["Up 1.80% premarket (last close $230.36).", "Heavy interest: 9.0M shares already, 7% of a full normal day before the open.", "Sitting 0.11% under yesterday's high $234.76. A push through that is the breakout to watch."],
      play: playFrom("NVDA", "call", nvdaChoices, 234.76, 237.4, 232.9),
      choices: nvdaChoices, verdict: coachVerdict(nvdaChoices, "NVDA"),
    },
    {
      rank: 2, symbol: "TSLA", price: 340, gapPct: -2.86, volRatio: 0.044, todayVolume: 4e6, bias: "puts", score: 70, preScore: 81,
      opportunity: 52, trend: "Bearish", dailyTrend: "Neutral", state: "WATCHING", trigger: 339.5, invalidation: 342.2, target: 334.1,
      history: null,
      bestCall: { symbol: `TSLA${fri.slice(2).replace(/-/g, "")}C00345000`, strike: 345, expiry: fri, mid: 6.1, score: 58 },
      bestPut: { symbol: tslaPuts[2].symbol, strike: 340, expiry: fri, mid: tslaPuts[2].mid, score: 72 },
      why: ["Down 2.86% premarket (last close $350.00).", "Already below yesterday's low $341.00. Watch whether it stays under it after the open."],
      play: playFrom("TSLA", "put", tslaChoices, 339.5, 334.1, 342.2),
      choices: tslaChoices, verdict: coachVerdict(tslaChoices, "TSLA"),
    },
  ];
}

const FIXED_NOW = Date.parse("2026-09-08T14:00:00Z"); // 10:00 ET, six hours of life left on a same-day contract

export const SAMPLE_WATCH: MorningWatch = {
  day: "2026-09-08", computedAt: "2026-09-08T13:10:00Z", locked: true, lockedAt: "2026-09-08T13:10:00Z",
  session: "premarket", sessionToday: true, ranked: [],
  notes: ["Premarket prices are thin. Gaps can fill or reverse in the first minutes after 9:30."],
  picks: samplePicks("2026-09-08", FIXED_NOW),
};

export const SAMPLE_ALERT: SirenAlert = {
  kind: "BREAK_CONFIRMED", direction: "long", urgency: "high", symbol: "NVDA",
  title: "NVDA BREAKOUT confirmed (82/100)",
  body: "NVDA at $235.10: 5-minute close through the level with volume. RVOL 2.10x, trend Strongly Bullish, setup score 74.",
  contract: "NVDA260908C00235000", opportunity: 74,
  orderCard: { contract: "NVDA260908C00235000", label: "NVDA 235C exp 09-08", qty: 1, limit: 1.05, stopTrigger: 0.3, stopLimit: 0.27, target: 2.6, underlyingInvalidation: 232.9, underlyingTarget: 237.4, note: "Stop = est. option value if NVDA reaches $232.90; target = est. value at $237.40. Model estimates, IV can shift them." },
  dedupeKey: "NVDA:BREAK_CONFIRMED:2026-09-08",
  summary: "NVDA just closed a 5-minute candle above the key level on 2.1x normal volume. Calls are on the table.",
  facts: { price: 235.1, rvol: 2.1, trend: "Strongly Bullish", state: "CONFIRMED", opportunity: 74, plan: { trigger: 234.76, t1: 237.4, invalidation: 232.9 }, best: { label: "NVDA 235C", expiry: "2026-09-08", dte: 0, mid: 1.0, score: 76 } },
};

/** Same samples re-dated to a given ET day so the 0DTE labels read correctly. */
export function sampleWatchFor(day: string): MorningWatch {
  const now = Date.now();
  return { ...SAMPLE_WATCH, day, computedAt: new Date(now).toISOString(), lockedAt: new Date(now).toISOString(), picks: samplePicks(day, now) };
}

export function sampleAlertFor(day: string): SirenAlert {
  return { ...SAMPLE_ALERT, facts: SAMPLE_ALERT.facts ? { ...SAMPLE_ALERT.facts, best: SAMPLE_ALERT.facts.best ? { ...SAMPLE_ALERT.facts.best, expiry: day, dte: 0 } : null } : null };
}
