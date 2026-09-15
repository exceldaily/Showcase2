// ─────────────────────────────────────────────────────────
// Trimmed analysis for board widgets: four charts polling the full
// 215KB analysis every few seconds would be wasteful, so widgets get
// the slice a chart card needs (about 30KB). Derived from the same
// cached buildOptionsAnalysis result the terminal uses.
// ─────────────────────────────────────────────────────────

import type { Bar } from "./bars";
import type { LevelZone } from "./intraday";
import type { MachineState, TradePlan, SetupDirection } from "./setupMachine";
import type { OptionsAnalysis } from "./optionsTerminal";
import { actionLine } from "./plainEnglish";

export interface LiteAnalysis {
  symbol: string;
  asOf: string;
  session: string;
  slot: string;
  marketOpen: boolean;
  price: number | null;
  changePct: number | null;
  trend: { label: string; confidence: number } | null;
  choppy: boolean;
  direction: SetupDirection;
  state: string | null;
  lifecycle: string;
  machine: MachineState | null;
  plan: TradePlan | null;
  lockedAt: string | null;
  indexMode: boolean;
  zones: LevelZone[];
  bars: { m1: Bar[]; m5: Bar[] };
  summary: string[];
  actionLine: string;
  bestCall: { strike: number; expiry: string; mid: number } | null;
  bestPut: { strike: number; expiry: string; mid: number } | null;
  notes: string[];
}

export function toLite(a: OptionsAnalysis): LiteAnalysis {
  const early = ["premarket", "open-5", "open-15"].includes(a.slot);
  return {
    symbol: a.symbol,
    asOf: a.asOf,
    session: a.session,
    slot: a.slot,
    marketOpen: a.marketOpen,
    price: a.price,
    changePct: a.changePct,
    trend: a.trend ? { label: a.trend.label, confidence: a.trend.confidence } : null,
    choppy: a.choppy,
    direction: a.direction,
    state: a.machine?.state ?? (a.plan ? "WATCHING" : null),
    lifecycle: a.lifecycle,
    machine: a.machine,
    plan: a.plan,
    lockedAt: a.lock?.pickedAt ?? null,
    indexMode: a.indexMode !== null,
    zones: a.zones.filter((z) => z.strength >= 65),
    bars: { m1: a.bars.m1.slice(-240), m5: a.bars.m5.slice(-240) },
    summary: a.summary.slice(0, 4),
    actionLine: (early ? "Before 9:45 ET: watch only, no new buys. " : "") + actionLine(a.machine?.state ?? null, a.direction, a.plan?.trigger ?? null, a.plan?.targets[0] ?? null),
    bestCall: a.sides.call.best ? { strike: a.sides.call.best.strike, expiry: a.sides.call.best.expiry, mid: a.sides.call.best.mid } : null,
    bestPut: a.sides.put.best ? { strike: a.sides.put.best.strike, expiry: a.sides.put.best.expiry, mid: a.sides.put.best.mid } : null,
    notes: a.notes.slice(0, 2),
  };
}
