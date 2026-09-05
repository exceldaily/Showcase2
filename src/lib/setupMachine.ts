// ─────────────────────────────────────────────────────────
// Breakout / retest lifecycle state machine (pure, unit-tested).
//
// Runs as a fold over 5-minute bars: step(state, bar) -> state, so
// the exact same code evaluates live data and historical replay with
// ZERO possibility of lookahead — a state at bar i only ever saw
// bars 0..i. A wick above resistance is never an automatic breakout;
// confirmation is a configurable checklist with a 0-100 quality.
// ─────────────────────────────────────────────────────────

import type { Bar } from "./bars";
import type { LevelZone } from "./intraday";

export type SetupState =
  | "WATCHING" | "APPROACHING" | "FORMING" | "TRIGGERED" | "CONFIRMING"
  | "CONFIRMED" | "RETESTING" | "CONTINUATION" | "FAILED" | "INVALIDATED";

export type SetupDirection = "long" | "short";

/** All knobs in one place; surfaced in settings. */
export interface BreakoutConfig {
  /** Bars must CLOSE beyond the level by this many ATRs to confirm. */
  minAtrPenetration: number;
  /** Time-adjusted RVOL needed for full volume credit. */
  rvolThreshold: number;
  /** Candle body must be at least this fraction of its range. */
  minBodyFraction: number;
  /** Retest zone half-width in ATRs around the broken level. */
  retestZoneAtr: number;
  /** Invalidation distance in ATRs beyond the broken level. */
  invalidationAtr: number;
  /** Within this many ATRs of the trigger = APPROACHING. */
  approachAtr: number;
  /** Require price above VWAP (long) / below (short) for confirmation credit. */
  requireVwap: boolean;
}

export const DEFAULT_BREAKOUT_CONFIG: BreakoutConfig = {
  minAtrPenetration: 0.15,
  rvolThreshold: 1.5,
  minBodyFraction: 0.5,
  retestZoneAtr: 0.35,
  invalidationAtr: 0.6,
  approachAtr: 1.0,
  requireVwap: true,
};

export interface SetupContext {
  direction: SetupDirection;
  trigger: number;       // level being broken
  invalidation: number;  // beyond-here-the-idea-is-wrong
  atr: number;
  vwap: number | null;
  rvol: number | null;
}

export interface ConfirmationCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface MachineState {
  state: SetupState;
  /** Bar index of the most recent transition. */
  sinceIndex: number;
  /** 0-100 quality of the confirmed breakout (0 until confirmed). */
  quality: number;
  checks: ConfirmationCheck[];
  /** Extreme reached after trigger (highest for long). */
  extreme: number | null;
  retestZone: { low: number; high: number } | null;
  transitions: { index: number; from: SetupState; to: SetupState }[];
}

export function initialMachine(): MachineState {
  return { state: "WATCHING", sinceIndex: 0, quality: 0, checks: [], extreme: null, retestZone: null, transitions: [] };
}

const beyond = (dir: SetupDirection, a: number, b: number) => (dir === "long" ? a > b : a < b);
const dist = (dir: SetupDirection, price: number, level: number) => (dir === "long" ? level - price : price - level);

function confirmationChecks(bar: Bar, ctx: SetupContext, cfg: BreakoutConfig): ConfirmationCheck[] {
  const dir = ctx.direction;
  const pen = dir === "long" ? bar.c - ctx.trigger : ctx.trigger - bar.c;
  const range = Math.max(1e-9, bar.h - bar.l);
  const body = Math.abs(bar.c - bar.o) / range;
  const wick = dir === "long" ? (bar.h - Math.max(bar.o, bar.c)) / range : (Math.min(bar.o, bar.c) - bar.l) / range;
  const checks: ConfirmationCheck[] = [
    { name: "Close beyond level", pass: pen > 0, detail: `close ${bar.c.toFixed(2)} vs ${ctx.trigger.toFixed(2)}` },
    { name: "ATR penetration", pass: pen >= cfg.minAtrPenetration * ctx.atr, detail: `${(pen / ctx.atr).toFixed(2)} ATR (need ${cfg.minAtrPenetration})` },
    { name: "Relative volume", pass: (ctx.rvol ?? 0) >= cfg.rvolThreshold, detail: ctx.rvol === null ? "RVOL unknown" : `RVOL ${ctx.rvol.toFixed(2)}x (need ${cfg.rvolThreshold})` },
    { name: "Strong candle body", pass: body >= cfg.minBodyFraction, detail: `body ${(body * 100).toFixed(0)}% of range` },
    { name: "Limited wick", pass: wick <= 0.4, detail: `${dir === "long" ? "upper" : "lower"} wick ${(wick * 100).toFixed(0)}%` },
  ];
  if (cfg.requireVwap && ctx.vwap !== null) {
    checks.push({
      name: "VWAP side",
      pass: dir === "long" ? bar.c > ctx.vwap : bar.c < ctx.vwap,
      detail: `close vs VWAP ${ctx.vwap.toFixed(2)}`,
    });
  }
  return checks;
}

export function breakoutQuality(checks: ConfirmationCheck[]): number {
  if (!checks.length) return 0;
  const passed = checks.filter((c) => c.pass).length;
  return Math.round((passed / checks.length) * 100);
}

/**
 * One machine step. `bar` is the latest CLOSED bar. Pure — never
 * inspects anything beyond its arguments.
 */
export function stepMachine(
  ms: MachineState,
  bar: Bar,
  index: number,
  ctx: SetupContext,
  cfg: BreakoutConfig = DEFAULT_BREAKOUT_CONFIG
): MachineState {
  const dir = ctx.direction;
  const go = (to: SetupState, patch: Partial<MachineState> = {}): MachineState => ({
    ...ms, ...patch, state: to, sinceIndex: index,
    transitions: [...ms.transitions, { index, from: ms.state, to }],
  });

  const invalidated = dir === "long" ? bar.c < ctx.invalidation : bar.c > ctx.invalidation;
  const distAtr = dist(dir, bar.c, ctx.trigger) / Math.max(1e-9, ctx.atr);

  switch (ms.state) {
    case "WATCHING": {
      if (beyond(dir, bar.c, ctx.trigger)) {
        // Jumped straight through — evaluate confirmation immediately.
        const checks = confirmationChecks(bar, ctx, cfg);
        const q = breakoutQuality(checks);
        return q >= 70
          ? go("CONFIRMED", { checks, quality: q, extreme: dir === "long" ? bar.h : bar.l })
          : go("TRIGGERED", { checks, quality: q, extreme: dir === "long" ? bar.h : bar.l });
      }
      if (distAtr <= cfg.approachAtr * 0.4) return go("FORMING");
      if (distAtr <= cfg.approachAtr) return go("APPROACHING");
      return ms;
    }
    case "APPROACHING": {
      if (beyond(dir, bar.c, ctx.trigger)) return stepFromTrigger(ms, bar, index, ctx, cfg, go);
      if (beyond(dir, bar.h, ctx.trigger) && dir === "long") return go("FORMING");
      if (beyond(dir, bar.l, ctx.trigger) && dir === "short") return go("FORMING");
      if (distAtr <= cfg.approachAtr * 0.4) return go("FORMING");
      if (distAtr > cfg.approachAtr * 1.5) return go("WATCHING");
      return ms;
    }
    case "FORMING": {
      if (beyond(dir, bar.c, ctx.trigger)) return stepFromTrigger(ms, bar, index, ctx, cfg, go);
      if (distAtr > cfg.approachAtr * 1.5) return go("WATCHING");
      return ms;
    }
    case "TRIGGERED":
    case "CONFIRMING": {
      // A close back on the wrong side of the level = failed breakout.
      if (!beyond(dir, bar.c, ctx.trigger)) return go("FAILED");
      const checks = confirmationChecks(bar, ctx, cfg);
      const q = breakoutQuality(checks);
      const extreme = ms.extreme === null ? (dir === "long" ? bar.h : bar.l) : dir === "long" ? Math.max(ms.extreme, bar.h) : Math.min(ms.extreme, bar.l);
      if (q >= 70) return go("CONFIRMED", { checks, quality: q, extreme });
      return { ...ms, state: "CONFIRMING", checks, quality: q, extreme };
    }
    case "CONFIRMED":
    case "CONTINUATION": {
      const extreme = ms.extreme === null ? (dir === "long" ? bar.h : bar.l) : dir === "long" ? Math.max(ms.extreme, bar.h) : Math.min(ms.extreme, bar.l);
      if (invalidated) return go("FAILED", { extreme });
      const zone = {
        low: ctx.trigger - cfg.retestZoneAtr * ctx.atr,
        high: ctx.trigger + cfg.retestZoneAtr * ctx.atr,
      };
      const inZone = bar.l <= zone.high && bar.h >= zone.low;
      if (inZone) return go("RETESTING", { extreme, retestZone: zone });
      return { ...ms, extreme };
    }
    case "RETESTING": {
      const extreme = ms.extreme;
      if (invalidated) return go("FAILED");
      // Held: closed back beyond the level after touching the zone.
      if (beyond(dir, bar.c, ctx.trigger)) {
        const zone = ms.retestZone;
        const outOfZone = zone ? (dir === "long" ? bar.c > zone.high : bar.c < zone.low) : true;
        if (outOfZone) return go("CONTINUATION", { extreme });
        return ms;
      }
      // Closed on the wrong side but above invalidation: still retesting.
      return ms;
    }
    case "FAILED":
    case "INVALIDATED":
      return ms;
    default:
      return ms;
  }
}

function stepFromTrigger(
  ms: MachineState,
  bar: Bar,
  index: number,
  ctx: SetupContext,
  cfg: BreakoutConfig,
  go: (to: SetupState, patch?: Partial<MachineState>) => MachineState
): MachineState {
  const checks = confirmationChecks(bar, ctx, cfg);
  const q = breakoutQuality(checks);
  const extreme = ctx.direction === "long" ? bar.h : bar.l;
  return q >= 70 ? go("CONFIRMED", { checks, quality: q, extreme }) : go("TRIGGERED", { checks, quality: q, extreme });
}

/** Fold a bar series through the machine (replay-safe by construction). */
export function runMachine(
  bars: Bar[],
  ctx: SetupContext,
  cfg: BreakoutConfig = DEFAULT_BREAKOUT_CONFIG
): MachineState {
  let ms = initialMachine();
  bars.forEach((b, i) => {
    ms = stepMachine(ms, b, i, ctx, cfg);
  });
  return ms;
}

// ── Room to move ──

export interface RoomResult {
  dollars: number;
  pct: number;
  atrMultiple: number;
  nextLevel: number | null;
  grade: "POOR" | "TIGHT" | "OK" | "GOOD" | "OPEN";
  note: string;
}

/**
 * Distance from `price` to the next MEANINGFUL opposing zone
 * (strength >= minStrength). Poor location right under resistance is
 * called out explicitly and penalizes the opportunity score.
 */
export function roomToMove(
  price: number,
  direction: SetupDirection,
  zones: LevelZone[],
  atr: number,
  minStrength = 65
): RoomResult {
  const opposing = zones
    .filter((z) => z.strength >= minStrength)
    .filter((z) => (direction === "long" ? z.price > price * 1.0005 : z.price < price * 0.9995))
    .sort((a, b) => (direction === "long" ? a.price - b.price : b.price - a.price));
  const next = opposing[0]?.price ?? null;
  if (next === null) {
    return { dollars: Infinity, pct: Infinity, atrMultiple: Infinity, nextLevel: null, grade: "OPEN", note: "No meaningful level in the way on this feed's lookback." };
  }
  const dollars = Math.abs(next - price);
  const pct = (dollars / price) * 100;
  const atrMultiple = atr > 0 ? dollars / atr : 0;
  const grade: RoomResult["grade"] = atrMultiple < 0.5 ? "POOR" : atrMultiple < 1 ? "TIGHT" : atrMultiple < 1.5 ? "OK" : atrMultiple < 3 ? "GOOD" : "OPEN";
  const note =
    grade === "POOR"
      ? `POOR LOCATION — major ${direction === "long" ? "resistance" : "support"} $${dollars.toFixed(2)} away`
      : grade === "TIGHT"
        ? `Tight — next level $${dollars.toFixed(2)} away (${atrMultiple.toFixed(1)} ATR)`
        : `${grade} LOCATION — $${dollars.toFixed(2)} to next major level (${atrMultiple.toFixed(1)} ATR)`;
  return { dollars: round2(dollars), pct: round2(pct), atrMultiple: round2(atrMultiple), nextLevel: next, grade, note };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Targets + risk/reward ──

export interface TradePlan {
  direction: SetupDirection;
  trigger: number;
  invalidation: number;
  targets: number[]; // T1..T3
  riskDollars: number;
  rewardToTargets: { target: number; reward: number; rr: number }[];
}

/**
 * Targets = the next opposing zones beyond the trigger. Invalidation
 * defaults to the stronger of (trigger -/+ invalidationAtr * ATR) and
 * the nearest protective zone behind the entry.
 */
export function buildTradePlan(
  direction: SetupDirection,
  trigger: number,
  zones: LevelZone[],
  atr: number,
  cfg: BreakoutConfig = DEFAULT_BREAKOUT_CONFIG,
  minStrength = 60,
  /** Target-synthesis unit when structure runs out (daily-scale ATR). */
  synthUnit?: number
): TradePlan {
  const unit = Math.max(synthUnit ?? atr * 6, atr * 4);
  const forward = zones
    .filter((z) => z.strength >= minStrength)
    .filter((z) => (direction === "long" ? z.price > trigger * 1.001 : z.price < trigger * 0.999))
    .sort((a, b) => (direction === "long" ? a.price - b.price : b.price - a.price))
    .slice(0, 3)
    .map((z) => z.price);
  // Synthesize daily-ATR-scale targets when structure runs out; a
  // 5-minute ATR is noise, not a target distance.
  while (forward.length < 3) {
    const base = forward[forward.length - 1] ?? trigger;
    forward.push(round2(direction === "long" ? base + unit * 0.5 : base - unit * 0.5));
  }
  const behind = zones
    .filter((z) => z.strength >= minStrength)
    .filter((z) => (direction === "long" ? z.price < trigger * 0.999 : z.price > trigger * 1.001))
    .sort((a, b) => (direction === "long" ? b.price - a.price : a.price - b.price))[0];
  // Invalidation distance floored at 0.15% of price so a quiet
  // 5-minute ATR cannot place the stop inside spread noise.
  const invDist = Math.max(cfg.invalidationAtr * atr, trigger * 0.0015);
  const atrInv = direction === "long" ? trigger - invDist : trigger + invDist;
  const invalidation = behind
    ? direction === "long"
      ? Math.max(atrInv, behind.price - 0.1 * atr)
      : Math.min(atrInv, behind.price + 0.1 * atr)
    : atrInv;

  const riskDollars = Math.abs(trigger - invalidation);
  const rewardToTargets = forward.map((t) => {
    const reward = Math.abs(t - trigger);
    return { target: t, reward: round2(reward), rr: riskDollars > 0 ? round2(reward / riskDollars) : 0 };
  });
  return { direction, trigger: round2(trigger), invalidation: round2(invalidation), targets: forward.map(round2), riskDollars: round2(riskDollars), rewardToTargets };
}

// ── Master opportunity score ──

export interface OpportunityInputs {
  trendConfidence: number;       // 0-100
  trendAligned: boolean;         // trend direction matches setup direction
  setupQuality: number;          // machine quality 0-100 (0 pre-trigger)
  setupState: SetupState;
  rvol: number | null;
  roomAtr: number;               // ATR multiples to next opposing level
  rrToT1: number;
  contractScore: number | null;  // best contract 0-100
  mtfAgreeingTimeframes: number; // timeframes agreeing on the key level
  slotPenalty: number;           // 0-15 from session context
}

export interface OpportunityScore {
  total: number;
  parts: { name: string; score: number; max: number; detail: string }[];
}

/** Weighted, documented; never hides a weak part behind the total. */
export function opportunityScore(i: OpportunityInputs): OpportunityScore {
  const parts: OpportunityScore["parts"] = [];
  const add = (name: string, score: number, max: number, detail: string) => {
    parts.push({ name, score: Math.round(Math.max(0, Math.min(max, score))), max, detail });
  };

  const stateBase: Record<SetupState, number> = {
    WATCHING: 4, APPROACHING: 8, FORMING: 12, TRIGGERED: 12, CONFIRMING: 14,
    CONFIRMED: 20, RETESTING: 16, CONTINUATION: 20, FAILED: 0, INVALIDATED: 0,
  };
  add("Setup stage", stateBase[i.setupState] + (i.setupQuality / 100) * 5, 25, `${i.setupState}${i.setupQuality ? ` (quality ${i.setupQuality})` : ""}`);
  add("Trend", (i.trendConfidence / 100) * (i.trendAligned ? 15 : 5), 15, i.trendAligned ? `aligned, confidence ${i.trendConfidence}` : "trend not aligned with setup");
  add("Volume", i.rvol === null ? 0 : Math.min(1, (i.rvol - 0.7) / 1.8) * 12, 12, i.rvol === null ? "RVOL unknown" : `RVOL ${i.rvol.toFixed(2)}x`);
  add("Room to next level", Math.min(1, i.roomAtr / 2) * 15, 15, `${i.roomAtr === Infinity ? "open air" : i.roomAtr.toFixed(1) + " ATR"} of room`);
  add("Risk/reward", Math.min(1, i.rrToT1 / 2.5) * 12, 12, `${i.rrToT1.toFixed(1)}R to T1`);
  add("Contract quality", i.contractScore === null ? 0 : (i.contractScore / 100) * 13, 13, i.contractScore === null ? "no scored contract" : `best contract ${i.contractScore}/100`);
  add("Multi-timeframe", Math.min(3, i.mtfAgreeingTimeframes) * (8 / 3), 8, `${i.mtfAgreeingTimeframes} timeframes on key level`);

  let total = parts.reduce((a, p) => a + p.score, 0);
  total = Math.max(0, total - i.slotPenalty);
  if (i.slotPenalty > 0) add("Session penalty", -i.slotPenalty, 0, "off-peak session conditions");
  return { total: Math.round(Math.min(100, total)), parts };
}

/** Session-context penalty: confirmation is harder to trust off-peak. */
export function sessionPenalty(slot: string): number {
  switch (slot) {
    case "open-5": return 6;      // whipsaw window, first prints
    case "midday": return 6;      // volume drought
    case "close-5": return 10;
    case "afterhours":
    case "premarket": return 8;   // thin books, wide option spreads
    case "closed": return 15;
    default: return 0;
  }
}
