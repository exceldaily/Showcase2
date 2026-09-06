// ─────────────────────────────────────────────────────────
// Plain-English narration of the trade map (pure, unit-tested).
// The engines produce numbers; this turns them into the sentences a
// newer trader needs: what the trend is, which level matters, what
// the setup is waiting for, and where the idea is wrong. Deliberately
// hedged language — decision support, never certainty.
// ─────────────────────────────────────────────────────────

import type { SetupState, SetupDirection, TradePlan, RoomResult } from "./setupMachine";
import type { TrendResult } from "./intraday";

export const STATE_EXPLAIN: Record<SetupState, string> = {
  WATCHING: "Price is not near the key level yet. Nothing to do but watch.",
  APPROACHING: "Price is moving toward the key level. Get ready, do not enter yet.",
  FORMING: "Price is pressing right against the level. A break could come soon.",
  TRIGGERED: "Price poked through the level but has not confirmed. Many of these fail.",
  CONFIRMING: "Price is through the level; waiting on volume and a clean close to confirm.",
  CONFIRMED: "The break confirmed with volume and a clean close. Entries are on the table.",
  RETESTING: "Price came back to test the broken level. If it holds, that is often the better entry.",
  CONTINUATION: "The retest held and price is moving again. Trend is in control.",
  FAILED: "The break failed and price closed back on the wrong side. Stand down.",
  INVALIDATED: "Price closed past the invalidation level. The idea is wrong for now.",
};

/** One-line instruction for the chart badge: what a call/put buyer should do right now. */
export function actionLine(state: SetupState | null, direction: SetupDirection, trigger: number | null, t1: number | null): string {
  const side = direction === "long" ? "calls" : "puts";
  const $ = (n: number | null) => (n === null ? "the level" : `$${n.toFixed(2)}`);
  switch (state) {
    case null:
    case "WATCHING": return `Wait. Nothing to buy yet. ${side === "calls" ? "Calls" : "Puts"} only make sense after a close ${direction === "long" ? "above" : "below"} ${$(trigger)}.`;
    case "APPROACHING": return `Get ready. Price is near ${$(trigger)}. Do not buy the approach; buy the close through it with volume.`;
    case "FORMING": return `Pressing the level at ${$(trigger)}. Watch the next 5-minute close.`;
    case "TRIGGERED": return `Poked through ${$(trigger)} but not confirmed. Many of these fail; wait for the close.`;
    case "CONFIRMING": return `Through the level; waiting on volume and a clean close. Patience.`;
    case "CONFIRMED": return `Break confirmed. ${side === "calls" ? "Calls" : "Puts"} are on the table; first target ${$(t1)}. Get out if it closes back past the wrong line.`;
    case "RETESTING": return `Pulled back to ${$(trigger)}. If it holds here, that is often the better entry. If it does not, stand down.`;
    case "CONTINUATION": return `Retest held and price is moving. Manage the trade: first target ${$(t1)}.`;
    case "FAILED": return `The break failed. Stand down; no ${side} here until a new setup forms.`;
    case "INVALIDATED": return `Idea is wrong for now (closed past the wrong line). Stand down.`;
    default: return "";
  }
}

export interface SummaryInput {
  symbol: string;
  price: number;
  trend: TrendResult | null;
  direction: SetupDirection;
  state: SetupState | null;
  plan: TradePlan | null;
  room: RoomResult | null;
  rvol: number | null;
  marketOpen: boolean;
}

const $ = (n: number) => `$${n.toFixed(2)}`;

export function plainSummary(i: SummaryInput): string[] {
  const out: string[] = [];
  const up = i.direction === "long";

  if (i.trend) {
    const conf = i.trend.confidence;
    const strength = conf >= 75 ? "clearly" : conf >= 45 ? "moderately" : "only slightly";
    out.push(`${i.symbol} is ${strength} ${i.trend.label.toLowerCase()} on the 5-minute chart (confidence ${conf}/100).`);
  } else {
    out.push(`${i.symbol} does not have enough intraday history yet for a trend read.`);
  }

  if (i.rvol !== null) {
    const v = i.rvol >= 2 ? "very heavy" : i.rvol >= 1.3 ? "above normal" : i.rvol >= 0.8 ? "normal" : "light";
    out.push(`Volume is ${v} for this time of day (RVOL ${i.rvol.toFixed(2)}x).${i.rvol < 0.8 ? " Light volume makes breakouts less trustworthy." : ""}`);
  }

  if (i.plan) {
    out.push(
      up
        ? `The level that matters is ${$(i.plan.trigger)} resistance. A 5-minute close above it with volume would be a breakout for calls.`
        : `The level that matters is ${$(i.plan.trigger)} support. A 5-minute close below it with volume would be a breakdown for puts.`
    );
    const dist = Math.abs(i.plan.trigger - i.price);
    out.push(`Price is ${$(dist)} (${((dist / i.price) * 100).toFixed(2)}%) ${up ? "below" : "above"} that level right now.`);
    out.push(
      `If it breaks, the next levels are ${$(i.plan.targets[0])}, then ${$(i.plan.targets[1])}, then ${$(i.plan.targets[2])}. The idea is wrong if price closes ${up ? "below" : "above"} ${$(i.plan.invalidation)}.`
    );
  } else {
    out.push("No meaningful level sits in the trend direction within today's structure, so there is no trigger to plan around yet.");
  }

  if (i.state) out.push(`Status: ${i.state}. ${STATE_EXPLAIN[i.state]}`);
  if (i.room && i.room.grade === "POOR") out.push("Warning: a major level sits right in the way, so even a good break has little room to run.");
  if (i.room && (i.room.grade === "GOOD" || i.room.grade === "OPEN")) out.push("There is real room before the next major level, which is what you want after a break.");
  if (!i.marketOpen) out.push("The market is closed, so this reads the last session. Levels will shift once new prints arrive.");
  return out;
}
