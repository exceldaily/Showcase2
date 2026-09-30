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
import { resample } from "./intraday";
import { warmForSlice, type WarmCloses } from "./chartWarm";

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
  /** The quality engine's call and breakout moments (undefined on an older payload). */
  call?: string | null;
  reason?: string | null;
  setupScore?: number | null;
  breakout?: { breakAt: number | null; confirmedAt: number | null; failedAt: number | null } | null;
  plan: TradePlan | null;
  lockedAt: string | null;
  indexMode: boolean;
  zones: LevelZone[];
  bars: { m1: Bar[]; m5: Bar[] };
  /** Closes before each timeframe's first bar (indicator warm-up). */
  warm: WarmCloses;
  summary: string[];
  actionLine: string;
  bestCall: { strike: number; expiry: string; mid: number } | null;
  bestPut: { strike: number; expiry: string; mid: number } | null;
  notes: string[];
}

export function toLite(a: OptionsAnalysis): LiteAnalysis {
  const early = ["premarket", "open-5", "open-15"].includes(a.slot);
  const m1 = a.bars.m1.slice(-240);
  const m5 = a.bars.m5.slice(-240);
  const w = a.warm ?? {};
  const warm: WarmCloses = {
    "1m": warmForSlice(w["1m"], a.bars.m1, m1),
    "5m": warmForSlice(w["5m"], a.bars.m5, m5),
    "15m": warmForSlice(w["15m"], resample(a.bars.m5, 15), resample(m5, 15)),
    "1h": warmForSlice(w["1h"], resample(a.bars.m5, 60), resample(m5, 60)),
  };
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
    call: a.read?.call ?? null,
    reason: a.read?.reason ?? null,
    setupScore: a.read?.quality?.score ?? null,
    breakout: a.read ? (a.read.breakout ? { breakAt: a.read.breakout.breakAt, confirmedAt: a.read.breakout.confirmedAt, failedAt: a.read.breakout.failedAt } : null) : undefined,
    plan: a.plan,
    lockedAt: a.lock?.pickedAt ?? null,
    indexMode: a.indexMode !== null,
    zones: a.zones.filter((z) => z.strength >= 65),
    bars: { m1, m5 },
    warm,
    summary: a.summary.slice(0, 4),
    actionLine: a.read
      ? `${a.read.call}. ${a.read.reason.charAt(0).toUpperCase()}${a.read.reason.slice(1)}.${a.read.waitingFor[0] && a.read.call !== "CALL" && a.read.call !== "PUT" ? ` Waiting for: ${a.read.waitingFor[0].charAt(0).toLowerCase()}${a.read.waitingFor[0].slice(1)}.` : ""}`
      : (early ? "Before 9:45 ET: watch only, no new buys. " : "") + actionLine(a.machine?.state ?? null, a.direction, a.plan?.trigger ?? null, a.plan?.targets[0] ?? null),
    bestCall: a.sides.call.best ? { strike: a.sides.call.best.strike, expiry: a.sides.call.best.expiry, mid: a.sides.call.best.mid } : null,
    bestPut: a.sides.put.best ? { strike: a.sides.put.best.strike, expiry: a.sides.put.best.expiry, mid: a.sides.put.best.mid } : null,
    notes: a.notes.slice(0, 2),
  };
}
