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

// ── Account sizing rules ──
// The ACCOUNT risks a fixed dollar amount per trade so every position
// contributes equally in R terms and dollars track R one-to-one.
// Notional is capped so tight stops cannot create absurd position sizes.
export const ACCOUNT_RISK_DOLLARS = 20;
export const ACCOUNT_NOTIONAL_CAP = 400;
export const ACCOUNT_MAX_OPEN = 10;
export const ACCOUNT_MIN_SCORE = 60;

// Pure (unit-tested): shares for a given cohort/entry/stop.
export function computeShares(cohort: string, entry: number, stop: number): number {
  if (entry <= 0) return 0;
  if (cohort === "account") {
    const riskPerShare = Math.abs(entry - stop);
    if (riskPerShare <= 0) return 0;
    const byRisk = ACCOUNT_RISK_DOLLARS / riskPerShare;
    const byCap = ACCOUNT_NOTIONAL_CAP / entry;
    return round2(Math.min(byRisk, byCap));
  }
  // Research cohort keeps the legacy $100-notional model.
  return entry >= 1000 ? round2(100 / entry) : Math.max(1, Math.floor(100 / entry));
}

// Open Watching positions for the current active setup batch.
// One open position per symbol + direction. The ACCOUNT cohort takes
// only bot-recommended signals (decision above Avoid, score >= 60),
// respects a concurrency cap, and stands down in bear regimes; every
// other signal is tracked as research.
export async function openPositionsFromActiveSetups(regime: string): Promise<{ account: number; research: number }> {
  const bearTape = regime === "Bear" || regime === "High Volatility Risk-Off";
  const openAccount = await query<{ n: string }>(
    `select count(*)::int as n from paper_trades where cohort='account' and status in ('Watching','Active')`
  );
  const slots = Math.max(0, ACCOUNT_MAX_OPEN - Number(openAccount[0]?.n ?? 0));

  const rows = await query<{ cohort: string }>(
    `with candidates as (
       select ts.id as setup_id, ts.ticker_id, tk.symbol, ts.setup_type, ts.direction,
              s.alphaforge_score as score, ts.decision,
              ts.entry_zone_low, ts.entry_zone_high,
              ts.stop_loss, ts.target_1, ts.target_2, ts.target_3,
              row_number() over (order by s.alphaforge_score desc nulls last) as quality_rank
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
     ),
     tagged as (
       select *,
         case
           when decision <> 'Avoid'
             and coalesce(score, 0) >= ${ACCOUNT_MIN_SCORE}
             and $1 = false
             and quality_rank <= $2
           then 'account' else 'research'
         end as cohort
       from candidates
     )
     insert into paper_trades (setup_id, ticker_id, symbol, setup_type, direction, score,
       entry_zone_low, entry_zone_high, stop_loss, target_1, target_2, target_3,
       position_value, status, watch_started, cohort)
     select setup_id, ticker_id, symbol, setup_type, direction, score,
       entry_zone_low, entry_zone_high, stop_loss, target_1, target_2, target_3,
       0, 'Watching', current_date, cohort
     from tagged
     returning cohort`,
    [bearTape, slots]
  );
  return {
    account: rows.filter((r) => r.cohort === "account").length,
    research: rows.filter((r) => r.cohort === "research").length,
  };
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
    cohort: string;
    entry_zone_low: string;
    entry_zone_high: string;
    entry_price: string | null;
    stop_loss: string;
    target_1: string;
    target_2: string;
    t1_hit: boolean;
    shares: string | null;
    position_value: string | null;
    activated_at: string | null;
    watch_started: string | null;
  }>(
    `select id, symbol, direction, status, cohort, entry_zone_low, entry_zone_high, entry_price,
            stop_loss, target_1, target_2, t1_hit, shares, position_value,
            activated_at::text, watch_started::text
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
        const shares = computeShares(p.cohort, fill.price, Number(p.stop_loss));
        if (shares <= 0) continue;
        await query(
          `update paper_trades set status='Active', entry_price=$2, shares=$3, position_value=$4, activated_at=$5 where id=$1`,
          [p.id, fill.price, shares, round2(shares * fill.price), barDate]
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
      const posValue = Number(p.position_value ?? 0) || shares * entry;
      await query(
        `update paper_trades set status=$2, exit_price=$3, closed_at=now(), hold_days=$4,
           pnl_dollars=$5, pnl_pct=$6, r_multiple=$7, exit_reason=$8
         where id=$1`,
        [p.id, status, exit.price, daysHeld,
         round2(pnl), posValue > 0 ? round2((pnl / posValue) * 100) : 0, round2(rMult),
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
