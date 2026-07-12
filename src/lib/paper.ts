// ─────────────────────────────────────────────────────────
// Paper trading engine (EOD simulation).
//
// Lifecycle: every scanned setup auto-opens a Watching position
// (one open position per symbol + direction). Each scan day the
// engine advances positions against the latest daily bar:
//   Watching: fills only if the bar actually touches the entry zone
//             (open inside zone fills at open; a tag of the zone
//             fills at the zone edge). Expires after 5 sessions.
//   Active:   stop checked BEFORE target (conservative intrabar),
//             T1 touch recorded, full exit at T2 / stop / 20 sessions.
// Frozen at open: entry zone, stop, targets. Never edited afterward.
// Position size: $100 per idea (whole shares; fractional for BTC).
// ─────────────────────────────────────────────────────────

import type { Bar } from "./bars";
import { query } from "./db";
import { round2 } from "./scoring";

export interface PaperFillResult {
  filled: boolean;
  price?: number;
}

// Pure fill logic (unit-tested): does this bar trigger the entry?
export function tryFill(
  direction: "Long" | "Short",
  zoneLow: number,
  zoneHigh: number,
  bar: Bar
): PaperFillResult {
  if (direction === "Long") {
    if (bar.o <= zoneHigh) return { filled: true, price: round2(Math.max(bar.o, zoneLow * 0.98)) };
    if (bar.l <= zoneHigh) return { filled: true, price: round2(zoneHigh) };
    return { filled: false };
  }
  if (bar.o >= zoneLow) return { filled: true, price: round2(Math.min(bar.o, zoneHigh * 1.02)) };
  if (bar.h >= zoneLow) return { filled: true, price: round2(zoneLow) };
  return { filled: false };
}

export interface PaperExitResult {
  exited: boolean;
  price?: number;
  reason?: "Stop" | "Target" | "Time";
  t1Hit?: boolean;
}

// Pure exit logic (unit-tested): stop first, then target, then time.
export function tryExit(
  direction: "Long" | "Short",
  stop: number,
  t1: number,
  t2: number,
  bar: Bar,
  daysHeld: number,
  maxHold = 20
): PaperExitResult {
  const t1Hit = direction === "Long" ? bar.h >= t1 : bar.l <= t1;
  if (direction === "Long") {
    if (bar.l <= stop) return { exited: true, price: stop, reason: "Stop", t1Hit: false };
    if (bar.h >= t2) return { exited: true, price: t2, reason: "Target", t1Hit: true };
  } else {
    if (bar.h >= stop) return { exited: true, price: stop, reason: "Stop", t1Hit: false };
    if (bar.l <= t2) return { exited: true, price: t2, reason: "Target", t1Hit: true };
  }
  if (daysHeld >= maxHold) return { exited: true, price: bar.c, reason: "Time", t1Hit };
  return { exited: false, t1Hit };
}

// Open Watching positions for the current active setup batch.
// One open position per symbol + direction at a time.
export async function openPositionsFromActiveSetups(): Promise<number> {
  const rows = await query<{ n: string }>(
    `with candidates as (
       select ts.id as setup_id, ts.ticker_id, tk.symbol, ts.setup_type, ts.direction,
              s.alphaforge_score as score,
              ts.entry_zone_low, ts.entry_zone_high, ts.entry_conservative,
              ts.stop_loss, ts.target_1, ts.target_2, ts.target_3
       from trade_setups ts
       join tickers tk on tk.id = ts.ticker_id
       left join scores s on s.id = ts.score_id
       where ts.is_active = true
         and not exists (
           select 1 from paper_trades p
           where p.ticker_id = ts.ticker_id
             and p.direction = ts.direction
             and p.status in ('Watching','Active')
         )
     )
     insert into paper_trades (setup_id, ticker_id, symbol, setup_type, direction, score,
       entry_zone_low, entry_zone_high, stop_loss, target_1, target_2, target_3,
       position_value, status, watch_started)
     select setup_id, ticker_id, symbol, setup_type, direction, score,
       entry_zone_low, entry_zone_high, stop_loss, target_1, target_2, target_3,
       100, 'Watching', current_date
     from candidates
     returning 1 as n`
  );
  return rows.length;
}

// Advance all open positions against the latest bar per symbol.
export async function processOpenPositions(barsBySymbol: Map<string, Bar[]>): Promise<{
  activated: number;
  closed: number;
  expired: number;
}> {
  const open = await query<{
    id: string;
    symbol: string;
    direction: "Long" | "Short";
    status: string;
    entry_zone_low: string;
    entry_zone_high: string;
    entry_price: string | null;
    stop_loss: string;
    target_1: string;
    target_2: string;
    t1_hit: boolean;
    shares: string | null;
    activated_at: string | null;
    watch_started: string | null;
  }>(
    `select id, symbol, direction, status, entry_zone_low, entry_zone_high, entry_price,
            stop_loss, target_1, target_2, t1_hit, shares, activated_at::text, watch_started::text
     from paper_trades where status in ('Watching','Active')`
  );

  let activated = 0;
  let closed = 0;
  let expired = 0;

  for (const p of open) {
    const bars = barsBySymbol.get(p.symbol) ?? barsBySymbol.get(`X:${p.symbol}`);
    if (!bars || bars.length === 0) continue;
    const bar = bars[bars.length - 1];
    const barDate = new Date(bar.t).toISOString().slice(0, 10);

    if (p.status === "Watching") {
      // No look-ahead fills: entries may only trigger on bars AFTER the
      // day the position was opened (the signal bar is already known).
      if (p.watch_started && barDate <= p.watch_started) continue;
      const fill = tryFill(p.direction, Number(p.entry_zone_low), Number(p.entry_zone_high), bar);
      if (fill.filled && fill.price) {
        const shares = fill.price >= 1000 ? round2(100 / fill.price) : Math.max(1, Math.floor(100 / fill.price));
        await query(
          `update paper_trades set status='Active', entry_price=$2, shares=$3, activated_at=$4 where id=$1`,
          [p.id, fill.price, shares, barDate]
        );
        activated++;
      } else if (p.watch_started && daysBetween(p.watch_started, barDate) >= 5) {
        await query(
          `update paper_trades set status='Expired', closed_at=now(), exit_reason='Entry zone never reached within 5 sessions' where id=$1`,
          [p.id]
        );
        expired++;
      }
      continue;
    }

    // Active
    const entry = Number(p.entry_price);
    const daysHeld = p.activated_at ? daysBetween(p.activated_at, barDate) : 0;
    const exit = tryExit(
      p.direction,
      Number(p.stop_loss),
      Number(p.target_1),
      Number(p.target_2),
      bar,
      daysHeld
    );

    if (exit.t1Hit && !p.t1_hit) {
      await query(`update paper_trades set t1_hit=true where id=$1`, [p.id]);
    }

    if (exit.exited && exit.price !== undefined) {
      const shares = Number(p.shares ?? 0);
      const pnl =
        p.direction === "Long"
          ? (exit.price - entry) * shares
          : (entry - exit.price) * shares;
      const risk = p.direction === "Long" ? entry - Number(p.stop_loss) : Number(p.stop_loss) - entry;
      const rMult =
        risk > 0
          ? p.direction === "Long"
            ? (exit.price - entry) / risk
            : (entry - exit.price) / risk
          : 0;
      const status =
        exit.reason === "Target" ? "ClosedTarget" : exit.reason === "Stop" ? "ClosedStop" : "ClosedTime";
      await query(
        `update paper_trades set status=$2, exit_price=$3, closed_at=now(), hold_days=$4,
           pnl_dollars=$5, pnl_pct=$6, r_multiple=$7, exit_reason=$8
         where id=$1`,
        [p.id, status, exit.price, daysHeld,
         round2(pnl), round2((pnl / 100) * 100), round2(rMult),
         exit.reason === "Target" ? "Target 2 reached" : exit.reason === "Stop" ? "Stop hit" : "20-session time exit"]
      );
      closed++;
    }
  }

  return { activated, closed, expired };
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400e3);
}
