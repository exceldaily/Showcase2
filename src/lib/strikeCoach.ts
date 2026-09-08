// ─────────────────────────────────────────────────────────
// Strike coach (pure, unit-tested).
// A newer trader's first instinct is "buy the cheaper strike at the
// target and make more". This lays the three sensible choices side by
// side with the same model the ladder uses: what each costs, what it is
// worth if the stock reaches the first target soon, what it is worth if
// the move only gets there by the close, what is left at the wrong line,
// and what an hour of nothing costs. No opinion hidden in a score.
// ─────────────────────────────────────────────────────────

import { intrinsicValue, scenarioPrice, type OptionSide } from "./optionsMath";

export interface CoachCandidate {
  symbol: string;
  side: OptionSide;
  strike: number;
  expiry: string;
  dte: number;
  mid: number;
  iv: number | null;
  delta: number | null;
  breakEven: number;
}

export interface Outcome {
  value: number;   // estimated option mid
  pct: number;     // % change vs cost
}

export interface StrikeChoice {
  label: "Recommended" | "Cheaper" | "Safer";
  symbol: string;
  strike: number;
  expiry: string;
  dte: number;
  mid: number;
  perContract: number;
  delta: number | null;
  breakEven: number;
  /** Stock reaches the first target within `stepMinutes`. */
  atTarget: Outcome | null;
  /** Stock is exactly at the first target when the option expires (same-day contracts only). */
  atTargetClose: Outcome | null;
  /** Stock reaches the wrong line within an hour. */
  atWrong: Outcome | null;
  /** Stock does nothing for an hour. */
  flatHour: Outcome | null;
  /** One plain sentence a beginner can act on. */
  plain: string;
}

const pctOf = (v: number, cost: number): number => (cost > 0 ? Math.round(((v - cost) / cost) * 100) : 0);
const outcome = (v: number, cost: number): Outcome => ({ value: Math.round(v * 100) / 100, pct: pctOf(v, cost) });

export interface CoachInput {
  side: OptionSide;
  candidates: CoachCandidate[];   // same side; any expiry (the best's expiry is used)
  best: CoachCandidate;
  underlying: number;
  target: number | null;
  wrong: number | null;
  now?: number;
  stepMinutes?: number;
}

/** Picks Recommended (the best), Cheaper (strike at the first target), Safer (one strike further in the money). */
export function strikeChoices(i: CoachInput): StrikeChoice[] {
  const now = i.now ?? Date.now();
  const step = i.stepMinutes ?? 30;
  const call = i.side === "call";
  const same = i.candidates.filter((c) => c.expiry === i.best.expiry && c.side === i.side && c.mid > 0);
  const strikes = Array.from(new Set(same.map((c) => c.strike))).sort((a, b) => a - b);

  const cheaper = i.target !== null
    ? same
        .filter((c) => (call ? c.strike > i.best.strike && c.strike >= i.target! * 0.998 : c.strike < i.best.strike && c.strike <= i.target! * 1.002))
        .sort((a, b) => (call ? a.strike - b.strike : b.strike - a.strike))[0] ?? null
    : null;
  const bestIdx = strikes.indexOf(i.best.strike);
  const saferStrike = call ? strikes[bestIdx - 1] : strikes[bestIdx + 1];
  const safer = saferStrike !== undefined ? same.find((c) => c.strike === saferStrike) ?? null : null;

  const build = (label: StrikeChoice["label"], c: CoachCandidate): StrikeChoice => {
    // Calibrate to the price actually paid (implied vol solved from the mid)
    // so "sits still" is pure time decay and never a phantom gain from a
    // stale quote; fall back to the quoted IV only if the solve fails.
    const scen = (px: number, minutes: number) => {
      const base = { side: i.side, strike: c.strike, expiry: c.expiry, currentMid: c.mid, underlyingNow: i.underlying, now };
      const calibrated = scenarioPrice({ ...base, iv: null }, px, minutes);
      if (calibrated.method !== "intrinsic-only" || c.iv === null) return calibrated.midEstimate;
      return scenarioPrice({ ...base, iv: c.iv }, px, minutes).midEstimate;
    };
    const atTarget = i.target !== null ? outcome(scen(i.target, step), c.mid) : null;
    const atTargetClose = i.target !== null && c.dte <= 0 ? outcome(intrinsicValue(i.side, c.strike, i.target), c.mid) : null;
    const atWrong = i.wrong !== null ? outcome(scen(i.wrong, 60), c.mid) : null;
    const flatHour = outcome(scen(i.underlying, 60), c.mid);
    const beyond = call ? "above" : "below";
    let plain: string;
    if (label === "Recommended") {
      plain = `Moves roughly with the stock. Worth holding only while the stock stays ${beyond} $${c.breakEven.toFixed(2)} by the close.`;
    } else if (label === "Cheaper") {
      plain = atTargetClose && atTargetClose.value === 0
        ? `Cheapest, but it is a long shot: if the stock only reaches the target by the close it expires worthless. It needs ${beyond} $${c.breakEven.toFixed(2)}, and it burns fastest when nothing happens.`
        : `Cheapest, but it needs the stock ${beyond} $${c.breakEven.toFixed(2)} to be worth anything at the close, and it burns fastest when nothing happens.`;
    } else {
      plain = `Costs more, moves almost dollar for dollar with the stock, and loses least when the stock sits still. The calmer choice.`;
    }
    return {
      label, symbol: c.symbol, strike: c.strike, expiry: c.expiry, dte: c.dte, mid: c.mid, perContract: Math.round(c.mid * 100),
      delta: c.delta, breakEven: c.breakEven, atTarget, atTargetClose, atWrong, flatHour, plain,
    };
  };

  const out: StrikeChoice[] = [build("Recommended", i.best)];
  if (cheaper) out.push(build("Cheaper", cheaper));
  if (safer) out.push(build("Safer", safer));
  return out;
}

/** The one-paragraph verdict for the "just buy the cheaper one" question. */
export function coachVerdict(choices: StrikeChoice[], symbol: string): string | null {
  const rec = choices.find((c) => c.label === "Recommended");
  const cheap = choices.find((c) => c.label === "Cheaper");
  if (!rec || !cheap || !rec.atTarget || !cheap.atTarget) return null;
  const parts = [
    `Cheaper is not free money. The ${cheap.strike} costs $${cheap.perContract} vs $${rec.perContract} and would gain about ${cheap.atTarget.pct}% vs ${rec.atTarget.pct}% if ${symbol} reaches the target quickly.`,
  ];
  if (cheap.atTargetClose && cheap.atTargetClose.value === 0) parts.push(`But if the move only arrives by the close, the ${cheap.strike} is worth $0 while the ${rec.strike} keeps about $${rec.atTargetClose?.value.toFixed(2) ?? "?"}.`);
  if (cheap.atWrong && rec.atWrong) parts.push(`At the wrong line it keeps ${100 + cheap.atWrong.pct}% of its value vs ${100 + rec.atWrong.pct}%.`);
  if (cheap.flatHour && rec.flatHour) parts.push(`An hour of nothing costs it ${Math.abs(cheap.flatHour.pct)}% vs ${Math.abs(rec.flatHour.pct)}%.`);
  parts.push("Same bet, more dice. Size the recommended one small instead of reaching for the cheap one.");
  return parts.join(" ");
}
