// ─────────────────────────────────────────────────────────
// Setup locks (server only). One fixed trigger per symbol per session
// day so the break line, wrong line and targets stop moving on every
// refresh. The pure decision of whether a lock still holds lives in
// `lockDecision` (unit-tested); the DB access wraps it.
// ─────────────────────────────────────────────────────────

import { hasDatabase, query, queryOne } from "@/lib/db";
import type { SetupDirection, TradePlan, SetupState } from "./setupMachine";

export interface SetupLock {
  symbol: string;
  day: string;
  direction: SetupDirection;
  trigger: number;
  invalidation: number;
  plan: TradePlan;
  pickedAt: string;
  pickedPrice: number | null;
}

const IN_TRADE: SetupState[] = ["TRIGGERED", "CONFIRMING", "CONFIRMED", "RETESTING", "CONTINUATION"];

/**
 * Pure: should an existing lock keep governing the plan?
 * - resolved (FAILED / INVALIDATED)  -> release, pick fresh
 * - trend flipped before any trigger -> release, pick fresh
 * - otherwise                          -> keep (including while in a trade)
 */
export function lockDecision(
  lock: { direction: SetupDirection },
  stateWithLock: SetupState | null,
  currentDirection: SetupDirection
): { keep: boolean; reason: string | null } {
  if (stateWithLock === "FAILED" || stateWithLock === "INVALIDATED") return { keep: false, reason: stateWithLock.toLowerCase() };
  const inTrade = stateWithLock !== null && IN_TRADE.includes(stateWithLock);
  if (lock.direction !== currentDirection && !inTrade) return { keep: false, reason: "trend flipped before the break" };
  return { keep: true, reason: null };
}

interface Row {
  symbol: string; day: string; direction: SetupDirection; trigger: string; invalidation: string; plan: TradePlan;
  picked_at: string; picked_price: string | null; released_at: string | null;
}

export async function getLock(symbol: string, day: string): Promise<SetupLock | null> {
  if (!hasDatabase()) return null;
  const r = await queryOne<Row>(
    "select symbol, day, direction, trigger, invalidation, plan, picked_at::text, picked_price, released_at::text from setup_locks where symbol = $1 and day = $2",
    [symbol, day]
  );
  if (!r || r.released_at) return null;
  return {
    symbol: r.symbol, day: r.day, direction: r.direction, trigger: Number(r.trigger), invalidation: Number(r.invalidation),
    plan: r.plan, pickedAt: r.picked_at, pickedPrice: r.picked_price === null ? null : Number(r.picked_price),
  };
}

export async function saveLock(l: Omit<SetupLock, "pickedAt">): Promise<SetupLock> {
  const pickedAt = new Date().toISOString();
  if (!hasDatabase()) return { ...l, pickedAt };
  await query(
    `insert into setup_locks (symbol, day, direction, trigger, invalidation, plan, picked_price, picked_at, released_at, release_reason)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, now(), null, null)
     on conflict (symbol, day) do update set
       direction = excluded.direction, trigger = excluded.trigger, invalidation = excluded.invalidation, plan = excluded.plan,
       picked_price = excluded.picked_price, picked_at = now(), released_at = null, release_reason = null`,
    [l.symbol, l.day, l.direction, l.trigger, l.invalidation, JSON.stringify(l.plan), l.pickedPrice]
  );
  return { ...l, pickedAt };
}

export async function releaseLock(symbol: string, day: string, reason: string): Promise<void> {
  if (!hasDatabase()) return;
  await query("update setup_locks set released_at = now(), release_reason = $3 where symbol = $1 and day = $2 and released_at is null", [symbol, day, reason]);
}
