// ─────────────────────────────────────────────────────────
// Siren rules (pure, unit-tested).
// "Jump on it" alerts fire only when several independent conditions
// line up at once: the setup machine has CONFIRMED (or is continuing
// after a held retest), the trend agrees, volume is real, there is
// room to the next level, and a tradeable contract exists. A trend
// surge (Strongly Bullish/Bearish on heavy volume) also fires, at a
// lower urgency. Everything is deduped per symbol/kind/session by
// the caller so a siren never repeats itself all day.
// ─────────────────────────────────────────────────────────

import type { OptionsAnalysis } from "./optionsTerminal";

export type SirenKind = "BREAK_CONFIRMED" | "RETEST_HELD" | "TREND_SURGE";

export interface OrderCard {
  contract: string;
  label: string;        // "NVDA 230P exp 09-11"
  qty: number;
  limit: number;        // buy limit (ask, rounded to tick)
  stopTrigger: number;  // option est. value at the underlying's invalidation
  stopLimit: number;    // a notch under the trigger so a stop-limit fills
  target: number;       // option est. value at Target 1
  underlyingInvalidation: number;
  underlyingTarget: number;
  note: string;
}

export interface SirenAlert {
  kind: SirenKind;
  direction: "long" | "short";
  urgency: "high" | "medium";
  symbol: string;
  title: string;
  body: string;
  contract: string | null;
  opportunity: number | null;
  /** Numbers to type into any broker ticket (or prefilled in ours). */
  orderCard: OrderCard | null;
  /** Dedupe key: one alert per symbol/kind/session. */
  dedupeKey: string;
}

/** Option price tick: $0.01 under $3, $0.05 at $3 and above. */
export function roundToTick(price: number): number {
  const tick = price >= 3 ? 0.05 : 0.01;
  return Math.round(Math.max(0.01, price) / tick) * tick;
}

/**
 * Build the order card from the favored side's best contract and its
 * level ladder: stop = estimated option value if the stock reaches
 * the "wrong" level, target = estimated value at the first level.
 * Pure; returns null when the ladder lacks the needed rungs.
 */
export function buildOrderCard(a: OptionsAnalysis, qty = 1): OrderCard | null {
  const side = a.direction === "long" ? "call" : "put";
  const v = a.sides[side];
  const c = v.best;
  if (!c || !a.plan) return null;
  const wrong = v.ladder.find((r) => r.kind === "wrong")?.est ?? null;
  const first = v.ladder.find((r) => r.kind !== "wrong")?.est ?? null;
  if (!wrong || !first) return null;
  const stopTrigger = roundToTick(wrong.midEstimate);
  const stopLimit = roundToTick(stopTrigger * 0.9);
  const target = roundToTick(first.midEstimate);
  if (!(stopTrigger < c.ask && target > c.ask)) return null; // nonsensical card
  return {
    contract: c.symbol,
    label: `${a.symbol} ${c.strike}${side === "call" ? "C" : "P"} exp ${c.expiry.slice(5)}`,
    qty,
    limit: roundToTick(c.ask),
    stopTrigger,
    stopLimit,
    target,
    underlyingInvalidation: a.plan.invalidation,
    underlyingTarget: a.plan.targets[0],
    note: `Stop = est. option value if ${a.symbol} reaches $${a.plan.invalidation.toFixed(2)}; target = est. value at $${a.plan.targets[0].toFixed(2)}. Model estimates, IV can shift them.`,
  };
}

export interface SirenThresholds {
  minQuality: number;
  minRvol: number;
  minOpportunity: number;
  minContractScore: number;
  surgeMinRvol: number;
  surgeMinConfidence: number;
}

export const DEFAULT_SIREN: SirenThresholds = {
  minQuality: 70,
  minRvol: 1.5,
  minOpportunity: 60,
  minContractScore: 55,
  surgeMinRvol: 1.8,
  surgeMinConfidence: 80,
};

const $ = (n: number | null | undefined) => (n === null || n === undefined ? "?" : `$${n.toFixed(2)}`);

export function evaluateSiren(a: OptionsAnalysis, sessionDate: string, t: SirenThresholds = DEFAULT_SIREN): SirenAlert | null {
  if (!a.connected || a.dataStale || a.price === null) return null;
  const dir = a.direction;
  const side = dir === "long" ? "call" : "put";
  const best = a.sides[side].best;
  const trendOk = a.trend ? (dir === "long" ? /Bullish/.test(a.trend.label) : /Bearish/.test(a.trend.label)) : false;
  const rvol = a.rvol ?? 0;
  const state = a.machine?.state ?? null;
  const q = a.machine?.quality ?? 0;
  const opp = a.opportunity?.total ?? null;
  const roomOk = a.room ? a.room.grade !== "POOR" : true;
  const contractOk = best !== null && !best.stale && best.score >= t.minContractScore;
  const card = buildOrderCard(a);
  const cardText = card
    ? ` ORDER CARD: buy ${card.qty} ${card.label} limit $${card.limit.toFixed(2)}; stop-limit sell trigger $${card.stopTrigger.toFixed(2)} limit $${card.stopLimit.toFixed(2)}; target sell $${card.target.toFixed(2)}.`
    : "";

  const contractLine = best
    ? ` Best ${side}: ${a.symbol} ${best.strike}${side === "call" ? "C" : "P"} exp ${best.expiry.slice(5)}, mid ${$(best.mid)}, score ${best.score}.`
    : ` No liquid ${side} in range yet.`;
  const planLine = a.plan
    ? ` Trigger ${$(a.plan.trigger)}, T1 ${$(a.plan.targets[0])}, wrong past ${$(a.plan.invalidation)}.`
    : "";

  if ((state === "CONFIRMED" || state === "CONTINUATION") && q >= t.minQuality && trendOk && rvol >= t.minRvol && roomOk && contractOk && (opp ?? 0) >= t.minOpportunity) {
    const kind: SirenKind = state === "CONTINUATION" ? "RETEST_HELD" : "BREAK_CONFIRMED";
    return {
      kind, direction: dir, urgency: "high", symbol: a.symbol,
      title: `${a.symbol} ${dir === "long" ? "BREAKOUT" : "BREAKDOWN"} ${state === "CONTINUATION" ? "retest held" : "confirmed"} (${q}/100)`,
      body: `${a.symbol} at ${$(a.price)}: ${state === "CONTINUATION" ? "old level held as " + (dir === "long" ? "support" : "resistance") + " and price is moving again" : "5-minute close through the level with volume"}. RVOL ${rvol.toFixed(2)}x, trend ${a.trend?.label ?? "?"}, setup score ${opp}.${planLine}${contractLine}${cardText}`,
      contract: best?.symbol ?? null, opportunity: opp, orderCard: card,
      dedupeKey: `${a.symbol}:${kind}:${sessionDate}`,
    };
  }

  if (a.trend && /Strongly/.test(a.trend.label) && a.trend.confidence >= t.surgeMinConfidence && rvol >= t.surgeMinRvol && roomOk && contractOk) {
    return {
      kind: "TREND_SURGE", direction: dir, urgency: "medium", symbol: a.symbol,
      title: `${a.symbol} turned ${a.trend.label.toLowerCase()} on ${rvol.toFixed(1)}x volume`,
      body: `${a.symbol} at ${$(a.price)} is ${a.trend.label.toLowerCase()} (confidence ${a.trend.confidence}) with RVOL ${rvol.toFixed(2)}x.${planLine}${contractLine} Status ${state ?? "WATCHING"}: wait for the level to break with volume before entering.${cardText}`,
      contract: best?.symbol ?? null, opportunity: opp, orderCard: card,
      dedupeKey: `${a.symbol}:TREND_SURGE:${sessionDate}`,
    };
  }
  return null;
}
