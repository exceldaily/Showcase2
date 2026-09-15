// ─────────────────────────────────────────────────────────
// Transition alerts (pure, unit-tested). Compares the previous and the
// current analysis snapshot for one symbol and emits the events a
// trader wants to hear about, once each:
//   approaching / touched / broken trigger, confirmation passed,
//   VWAP reclaimed or lost, support or resistance broken, target
//   reached, invalidation reached, volume confirmation, setup
//   invalidated, catalyst approaching.
// Deduplication (per symbol, kind and day) is the caller's job.
// ─────────────────────────────────────────────────────────

export type AlertKind =
  | "APPROACHING_TRIGGER" | "TRIGGER_TOUCHED" | "TRIGGER_BROKEN" | "CONFIRMED" | "VWAP_RECLAIMED" | "VWAP_LOST"
  | "SUPPORT_BROKEN" | "RESISTANCE_BROKEN" | "TARGET_REACHED" | "INVALIDATION_REACHED" | "VOLUME_CONFIRMED" | "SETUP_INVALIDATED"
  | "CATALYST_SOON";

export interface AlertSnapshot {
  symbol: string;
  price: number | null;
  vwap: number | null;
  rvol: number | null;
  direction: "long" | "short";
  lifecycle: string;
  machineState: string | null;
  trigger: number | null;
  invalidation: number | null;
  target1: number | null;
  /** Nearest support below and resistance above the price (zone prices). */
  support: number | null;
  resistance: number | null;
  /** Minutes to the next high-impact event, null when none. */
  minutesToEvent: number | null;
}

export interface AlertEvent {
  kind: AlertKind;
  symbol: string;
  title: string;
  detail: string;
  /** Area of the panel to flash. */
  area: "status" | "trigger" | "vwap" | "levels" | "target" | "invalidation" | "volume" | "events";
  urgency: "high" | "medium" | "low";
}

const $ = (n: number) => `$${n.toFixed(2)}`;
const crossedUp = (prev: number | null, next: number | null, level: number | null) => prev !== null && next !== null && level !== null && prev < level && next >= level;
const crossedDown = (prev: number | null, next: number | null, level: number | null) => prev !== null && next !== null && level !== null && prev > level && next <= level;

export function detectTransitions(prev: AlertSnapshot | null, next: AlertSnapshot, eventBufferMinutes = 15): AlertEvent[] {
  const out: AlertEvent[] = [];
  if (!prev || prev.symbol !== next.symbol) return out;
  const up = next.direction === "long";
  const push = (kind: AlertKind, title: string, detail: string, area: AlertEvent["area"], urgency: AlertEvent["urgency"]) => out.push({ kind, symbol: next.symbol, title, detail, area, urgency });

  // Setup lifecycle transitions.
  if (prev.lifecycle !== next.lifecycle) {
    if (next.lifecycle === "APPROACHING" && next.trigger !== null) push("APPROACHING_TRIGGER", `${next.symbol} approaching the trigger`, `${$(next.trigger)} is within reach. Do not buy the approach.`, "trigger", "low");
    if (next.lifecycle === "TRIGGERED" && next.trigger !== null) push("TRIGGER_BROKEN", `${next.symbol} broke the trigger`, `Through ${$(next.trigger)}, not confirmed yet.`, "trigger", "medium");
    if (next.lifecycle === "CONFIRMED") push("CONFIRMED", `${next.symbol} confirmed`, `${up ? "Breakout" : "Breakdown"} confirmed. Entries are on the table if the rules allow.`, "status", "high");
    if (next.lifecycle === "TARGET HIT" && next.target1 !== null) push("TARGET_REACHED", `${next.symbol} reached target 1`, `${$(next.target1)} hit.`, "target", "high");
    if (next.lifecycle === "INVALIDATED") push("SETUP_INVALIDATED", `${next.symbol} setup invalidated`, next.machineState === "FAILED" ? "Closed back through the level. Stand down." : "Closed past the wrong line.", "invalidation", "high");
  }
  // Price crossings that do not change the lifecycle.
  if (next.trigger !== null && prev.lifecycle === next.lifecycle && (up ? crossedUp(prev.price, next.price, next.trigger) : crossedDown(prev.price, next.price, next.trigger)) && !["TRIGGERED", "CONFIRMING", "CONFIRMED", "IN TRADE", "TARGET HIT"].includes(next.lifecycle)) {
    push("TRIGGER_TOUCHED", `${next.symbol} touched the trigger`, `Print through ${$(next.trigger)}. Wait for the 5-minute close.`, "trigger", "medium");
  }
  if (next.invalidation !== null && ["CONFIRMED", "IN TRADE", "TARGET HIT"].includes(next.lifecycle) && (up ? crossedDown(prev.price, next.price, next.invalidation) : crossedUp(prev.price, next.price, next.invalidation))) {
    push("INVALIDATION_REACHED", `${next.symbol} at the invalidation`, `Print through ${$(next.invalidation)}. A 5-minute close here means out.`, "invalidation", "high");
  }
  if (next.vwap !== null) {
    if (crossedUp(prev.price, next.price, next.vwap)) push("VWAP_RECLAIMED", `${next.symbol} reclaimed VWAP`, `Back above ${$(next.vwap)}.`, "vwap", "low");
    if (crossedDown(prev.price, next.price, next.vwap)) push("VWAP_LOST", `${next.symbol} lost VWAP`, `Back below ${$(next.vwap)}.`, "vwap", "low");
  }
  if (next.resistance !== null && crossedUp(prev.price, next.price, next.resistance) && next.resistance !== next.trigger) push("RESISTANCE_BROKEN", `${next.symbol} through resistance`, `Above ${$(next.resistance)}.`, "levels", "low");
  if (next.support !== null && crossedDown(prev.price, next.price, next.support) && next.support !== next.trigger) push("SUPPORT_BROKEN", `${next.symbol} through support`, `Below ${$(next.support)}.`, "levels", "low");
  if (prev.rvol !== null && next.rvol !== null && prev.rvol < 1.5 && next.rvol >= 1.5) push("VOLUME_CONFIRMED", `${next.symbol} volume confirmation`, `Relative volume ${next.rvol.toFixed(2)}x.`, "volume", "low");
  if (next.minutesToEvent !== null && next.minutesToEvent >= 0 && next.minutesToEvent <= eventBufferMinutes && (prev.minutesToEvent === null || prev.minutesToEvent > eventBufferMinutes)) {
    push("CATALYST_SOON", "High-impact event soon", `${next.minutesToEvent} minutes away. No new entries inside the buffer.`, "events", "medium");
  }
  return out;
}
