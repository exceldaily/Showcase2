// ─────────────────────────────────────────────────────────
// Position coach (pure, unit-tested).
// The trader tells the terminal what they actually hold (contract,
// entry, qty). This turns the chart's stock levels into option dollars
// for THAT contract and writes the one instruction that matters now.
// ─────────────────────────────────────────────────────────

import { blackScholes, intrinsicValue, scenarioPrice, yearsToExpiry, type OptionSide } from "./optionsMath";
import type { SetupDirection, SetupState, TradePlan } from "./setupMachine";

export interface MyTrade {
  contract: string;   // OCC symbol
  side: OptionSide;
  strike: number;
  expiry: string;     // YYYY-MM-DD
  entry: number;      // per share
  qty: number;
}

export interface PositionRead {
  mid: number | null;
  pnlDollars: number | null;
  pnlPct: number | null;
  breakEven: number;
  /** Dollars per contract lost per hour if the stock sits still (model). */
  thetaPerHour: number | null;
  atTarget1: { stock: number; value: number; pnlDollars: number } | null;
  atWrong: { stock: number; value: number; pnlDollars: number } | null;
  /** Value if the stock is at target 1 when the contract expires. */
  atTarget1Expiry: { value: number; pnlDollars: number } | null;
  distanceToStrikePct: number;
  headline: string;
  steps: string[];
}

const $ = (n: number) => `$${n.toFixed(2)}`;
const money = (n: number) => `${n < 0 ? "-" : "+"}$${Math.abs(Math.round(n))}`;

export function positionRead(i: {
  trade: MyTrade;
  price: number;
  mid: number | null;
  iv: number | null;
  plan: TradePlan | null;
  state: SetupState | null;
  direction: SetupDirection;
  now?: number;
  stepMinutes?: number;
  /** Session slot from the analysis (premarket, open-5, open-15, ...). */
  slot?: string;
}): PositionRead {
  const { trade, price } = i;
  const now = i.now ?? Date.now();
  const step = i.stepMinutes ?? 30;
  const qty = Math.max(1, trade.qty);
  const mid = i.mid;
  const pnlDollars = mid === null ? null : (mid - trade.entry) * 100 * qty;
  const pnlPct = mid === null ? null : ((mid - trade.entry) / trade.entry) * 100;
  const breakEven = trade.side === "call" ? trade.strike + trade.entry : trade.strike - trade.entry;
  const bullish = trade.side === "call";
  const aligned = (bullish && i.direction === "long") || (!bullish && i.direction === "short");

  const base = { side: trade.side, strike: trade.strike, expiry: trade.expiry, currentMid: mid, underlyingNow: price, now };
  const scen = (px: number, minutes: number) => {
    const c = scenarioPrice({ ...base, iv: null }, px, minutes);
    if (c.method !== "intrinsic-only" || i.iv === null) return c.midEstimate;
    return scenarioPrice({ ...base, iv: i.iv }, px, minutes).midEstimate;
  };
  const dollars = (v: number) => (v - trade.entry) * 100 * qty;

  let thetaPerHour: number | null = null;
  if (mid !== null && mid > 0) {
    const flat = scen(price, 60);
    thetaPerHour = Math.round((mid - flat) * 100 * qty);
  } else if (i.iv) {
    const T = yearsToExpiry(trade.expiry, now);
    const bs = blackScholes(trade.side, price, trade.strike, T, i.iv);
    thetaPerHour = Math.round((Math.abs(bs.theta) / 6.5) * 100 * qty);
  }

  const t1 = i.plan?.targets[0] ?? null;
  const wrong = i.plan?.invalidation ?? null;
  const atTarget1 = t1 !== null && mid !== null ? { stock: t1, value: scen(t1, step), pnlDollars: dollars(scen(t1, step)) } : null;
  const atWrong = wrong !== null && mid !== null ? { stock: wrong, value: scen(wrong, 60), pnlDollars: dollars(scen(wrong, 60)) } : null;
  const atTarget1Expiry = t1 !== null ? { value: intrinsicValue(trade.side, trade.strike, t1), pnlDollars: dollars(intrinsicValue(trade.side, trade.strike, t1)) } : null;
  const distanceToStrikePct = ((trade.strike - price) / price) * 100 * (bullish ? 1 : -1);

  // Headline + steps
  const label = `${qty}x ${trade.strike}${bullish ? "C" : "P"}`;
  const pnlText = pnlDollars !== null && pnlPct !== null ? `${money(pnlDollars)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(0)}%)` : "no live quote";
  let headline = `${label}: ${pnlText}.`;
  const steps: string[] = [];
  const above = bullish ? "above" : "below";
  const back = bullish ? "back below" : "back above";

  if (!aligned) {
    headline += ` The chart leans the other way (${i.direction === "long" ? "calls" : "puts"}).`;
    steps.push(`Your ${bullish ? "call" : "put"} is fighting the current read. Tighten up: out on the next 5-minute close against you, do not add.`);
  } else if (!i.plan || t1 === null || wrong === null) {
    steps.push("No locked level on the chart yet. Manage on price alone: sell into strength, cut on the first 5-minute close against you.");
  } else {
    const st = i.state;
    if (st === null || st === "WATCHING" || st === "APPROACHING" || st === "FORMING") {
      steps.push(`You are in before the break. Hold only if a 5-minute candle closes ${above} ${$(i.plan.trigger)} with volume.`);
      steps.push(`Out if a 5-minute candle closes ${back} ${$(wrong)}, or if nothing happens for an hour.`);
    } else if (st === "TRIGGERED" || st === "CONFIRMING") {
      steps.push(`The level just broke and is not confirmed yet. Hold through the next candle; out if it closes ${back} ${$(wrong)}.`);
    } else if (st === "CONFIRMED" || st === "CONTINUATION") {
      // Whole contracts only: with one contract there is no "half".
      const est = atTarget1 ? ` (about ${$(atTarget1.value)} for your contract)` : "";
      if (qty === 1) steps.push(`Break confirmed. Sell it at ${$(t1)}${est}. One contract cannot be split, so take the whole win there instead of hoping for ${i.plan.targets[1] !== undefined ? $(i.plan.targets[1]) : "more"}.`);
      else steps.push(`Break confirmed. Sell ${Math.ceil(qty / 2)} of ${qty} at ${$(t1)}${est}, let the rest run toward ${i.plan.targets[1] !== undefined ? $(i.plan.targets[1]) : "the next target"}.`);
      steps.push(`Out on a 5-minute close ${back} ${$(wrong)}.`);
    } else if (st === "RETESTING") {
      steps.push(`Price is retesting the broken level at ${$(i.plan.trigger)}. If it holds, that is the better entry; if it closes ${back} ${$(wrong)}, out.`);
    } else {
      steps.push(`The setup ${st === "FAILED" ? "failed" : "is invalidated"}. Sell. Do not wait for it to come back.`);
    }
  }
  if (distanceToStrikePct > 0) {
    const be = breakEven;
    steps.push(`Your strike is ${distanceToStrikePct.toFixed(1)}% ${above} the stock. At expiry it is worth $0 unless ${trade.side === "call" ? "above" : "below"} ${$(trade.strike)}, and you only profit ${above} ${$(be)}.${atTarget1Expiry && atTarget1Expiry.value === 0 ? " Even the first target leaves it worthless at expiry, so this is a sell-into-the-move contract, not a hold." : ""}`);
  }
  if (i.slot && ["premarket", "open-5", "open-15"].includes(i.slot)) steps.unshift("Opening minutes (before 9:45 ET): spreads are widest and levels are still forming. Do not add, and do not open anything new.");
  if (thetaPerHour !== null && thetaPerHour > 0) steps.push(`Sitting still costs about $${thetaPerHour} per hour.`);
  return { mid, pnlDollars, pnlPct, breakEven, thetaPerHour, atTarget1, atWrong, atTarget1Expiry, distanceToStrikePct, headline, steps };
}
