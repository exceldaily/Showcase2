// Planned entry (pure). Before a break the plan's entry is the trigger,
// not the current print, so every scenario and risk number starts from
// the contract's estimated premium at the trigger. Once the setup has
// triggered, the current mid is the entry.

import { scenarioPrice } from "./optionsMath";
import type { TradePlan } from "./setupMachine";

export interface EntryEstimate {
  /** Underlying price the plan enters at. */
  underlying: number;
  /** Estimated contract premium at that price (model) or the live mid once triggered. */
  premium: number;
  /** True when the premium is a model estimate at the trigger. */
  estimated: boolean;
}

const PRE_TRIGGER = new Set(["NO SETUP", "WATCHING", "APPROACHING"]);

export function plannedEntry(
  c: { side: "call" | "put"; strike: number; expiry: string; iv: number | null; mid: number },
  plan: TradePlan | null,
  price: number | null,
  lifecycle: string | null
): EntryEstimate | null {
  if (price === null || price <= 0) return null;
  if (!plan || !lifecycle || !PRE_TRIGGER.has(lifecycle)) return { underlying: price, premium: c.mid, estimated: false };
  const est = scenarioPrice({ side: c.side, strike: c.strike, expiry: c.expiry, iv: c.iv, currentMid: c.mid, underlyingNow: price }, plan.trigger, 30);
  return { underlying: plan.trigger, premium: Math.round(est.midEstimate * 100) / 100, estimated: true };
}
