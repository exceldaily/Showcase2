// Watchlist ordering and grouping (pure, client-safe, unit-tested).

export interface WatchRow {
  call?: string | null;
  readState?: string | null;
  setupScore?: number | null;
  /** Older payloads: the setup machine's raw state. */
  state?: string | null;
  trigger?: number | null;
  distanceToTriggerPct?: number | null;
}

/** Something to act on first, then setups that are forming, best setup score first within each. */
export function scanRank(r: WatchRow): number {
  const tier = r.call === "CALL" || r.call === "PUT" ? 3000 : r.readState === "BREAK ATTEMPT" || r.readState === "TESTING" ? 2000 : r.readState === "APPROACHING" || r.call === "DO NOT CHASE" ? 1000 : 0;
  return tier + (r.setupScore ?? 0);
}

const READY_STATES = ["CONFIRMED", "RETESTING", "CONTINUATION"];
const NEAR_STATES = ["APPROACHING", "FORMING", "TRIGGERED", "CONFIRMING"];

/** READY / NEAR TRIGGER / WATCH / NO SETUP. Follows the quality engine's call and breakout state when the row has them. */
export function scanGroup(r: WatchRow): "READY" | "NEAR TRIGGER" | "WATCH" | "NO SETUP" {
  if (r.call !== undefined && r.call !== null) {
    if (r.call === "CALL" || r.call === "PUT") return "READY";
    if (!r.trigger || r.readState === "NO SETUP" || r.readState === "FAILED BREAKOUT" || r.readState === "SESSION OVER") return "NO SETUP";
    if (r.readState === "BREAK ATTEMPT" || r.readState === "TESTING" || r.readState === "APPROACHING" || r.call === "DO NOT CHASE") return "NEAR TRIGGER";
    return "WATCH";
  }
  if (!r.state || !r.trigger) return "NO SETUP";
  if (READY_STATES.includes(r.state)) return "READY";
  if (NEAR_STATES.includes(r.state)) return "NEAR TRIGGER";
  if (r.distanceToTriggerPct !== null && r.distanceToTriggerPct !== undefined && Math.abs(r.distanceToTriggerPct) <= 0.5) return "NEAR TRIGGER";
  return "WATCH";
}
