// ─────────────────────────────────────────────────────────
// Signal log storage (server only). Writes are idempotent upserts keyed
// by symbol, day, model, source, direction and level, so the live
// analysis can report the same setup every few seconds and a replay can
// be re-run without piling up duplicates.
// ─────────────────────────────────────────────────────────

import { hasDatabase, query } from "../db";
import { getStockBars, hasAlpacaKeys } from "@/providers/alpaca";
import { etStamp, sessionOf } from "../intraday";
import { resolveOutcome, type Outcome, type ReplayRecord } from "../quality/replay";
import type { SignalFeatures } from "../quality/assemble";
import type { Model, SignalRow, SignalStatus, Source } from "./stats";

export interface SignalWrite {
  symbol: string;
  day: string;
  model: Model;
  source: Source;
  direction: "long" | "short";
  trigger: number;
  invalidation: number;
  targets: number[];
  status: SignalStatus;
  blockedBy: string | null;
  firedAt: string | null;
  price: number | null;
  features: SignalFeatures | null;
  outcome: Outcome | null;
}

const RANK: Record<SignalStatus, number> = { OPEN: 0, "NEVER TRIGGERED": 1, "FAILED BREAKOUT": 2, "NO ENTRY": 3, ENTRY: 4 };
const keyOf = (w: { symbol: string; day: string; model: string; source: string; direction: string; trigger: number }) => `${w.symbol}|${w.day}|${w.model}|${w.source}|${w.direction}|${w.trigger}`;

/** One row per key: the furthest a level got. (A level can be locked more than once in a session.) */
export function dedupeWrites(rows: SignalWrite[]): SignalWrite[] {
  const best = new Map<string, SignalWrite>();
  for (const r of rows) {
    const k = keyOf(r);
    const cur = best.get(k);
    if (!cur || RANK[r.status] > RANK[cur.status]) best.set(k, r);
  }
  return [...best.values()];
}

export function fromReplay(r: ReplayRecord, source: Source, targets: number[] = []): SignalWrite {
  return {
    symbol: r.symbol, day: r.day, model: r.model, source, direction: r.direction, trigger: r.trigger, invalidation: r.invalidation,
    targets: targets.length ? targets : r.target1 !== null ? [r.target1] : [], status: r.status, blockedBy: r.blockedBy,
    firedAt: r.firedAt !== null ? new Date(r.firedAt).toISOString() : null, price: r.price, features: r.features, outcome: r.outcome,
  };
}

const SQL_RANK = (col: string) => `(case ${col} when 'ENTRY' then 4 when 'NO ENTRY' then 3 when 'FAILED BREAKOUT' then 2 when 'NEVER TRIGGERED' then 1 else 0 end)`;

/**
 * replace: a re-run overwrites what was there (replays).
 * advance: a row only ever moves forward (live), so the first ENTRY snapshot is the one kept.
 */
export async function upsertSignals(rows: SignalWrite[], mode: "replace" | "advance"): Promise<number> {
  if (!hasDatabase() || rows.length === 0) return 0;
  const payload = dedupeWrites(rows).map((w) => ({
    symbol: w.symbol, day: w.day, model: w.model, source: w.source, direction: w.direction, trigger: w.trigger, invalidation: w.invalidation,
    targets: w.targets, status: w.status, blocked_by: w.blockedBy, fired_at: w.firedAt, price: w.price, features: w.features,
    outcome: w.outcome?.result ?? null, r: w.outcome?.r ?? null, mae_r: w.outcome?.maeR ?? null, mfe_r: w.outcome?.mfeR ?? null, rr: w.outcome?.rr ?? null,
    exit: w.outcome?.exit ?? null, false_break: w.outcome?.falseBreak ?? null,
  }));
  let n = 0;
  for (let i = 0; i < payload.length; i += 400) {
    const chunk = payload.slice(i, i + 400);
    await query(
      `insert into signal_log (symbol, day, model, source, direction, trigger, invalidation, targets, status, blocked_by, fired_at, price, features, outcome, r, mae_r, mfe_r, rr, exit, false_break, resolved_at)
       select x.symbol, x.day::date, x.model, x.source, x.direction, x.trigger, x.invalidation, coalesce(x.targets, '[]'::jsonb), x.status, x.blocked_by, x.fired_at::timestamptz, x.price, x.features,
              x.outcome, x.r, x.mae_r, x.mfe_r, x.rr, x.exit, x.false_break, case when x.outcome is not null then now() end
       from jsonb_to_recordset($1::jsonb) as x(symbol text, day text, model text, source text, direction text, trigger numeric, invalidation numeric, targets jsonb, status text, blocked_by text, fired_at text, price numeric, features jsonb, outcome text, r numeric, mae_r numeric, mfe_r numeric, rr numeric, exit text, false_break boolean)
       on conflict (symbol, day, model, source, direction, trigger) do update set
         status = excluded.status, blocked_by = excluded.blocked_by, fired_at = excluded.fired_at, price = excluded.price, features = excluded.features,
         invalidation = excluded.invalidation, targets = excluded.targets,
         outcome = excluded.outcome, r = excluded.r, mae_r = excluded.mae_r, mfe_r = excluded.mfe_r, rr = excluded.rr, exit = excluded.exit, false_break = excluded.false_break,
         resolved_at = excluded.resolved_at, updated_at = now()
       where ${mode === "replace" ? "true" : `${SQL_RANK("excluded.status")} > ${SQL_RANK("signal_log.status")}`}`,
      [JSON.stringify(chunk)]
    );
    n += chunk.length;
  }
  return n;
}

// Live writes happen only when a setup's status moves, not on every pass.
const lastLive = new Map<string, SignalStatus>();

export async function recordLive(w: Omit<SignalWrite, "source" | "outcome">): Promise<void> {
  if (!hasDatabase()) return;
  const row: SignalWrite = { ...w, source: "live", outcome: null };
  const k = keyOf(row);
  const prev = lastLive.get(k);
  if (prev !== undefined && RANK[prev] >= RANK[row.status]) return;
  lastLive.set(k, row.status);
  if (lastLive.size > 2000) { const first = lastLive.keys().next().value; if (first) lastLive.delete(first); }
  await upsertSignals([row], "advance").catch(() => undefined);
}

interface DbRow {
  symbol: string; day: string; model: Model; source: Source; direction: "long" | "short"; trigger: string; status: SignalStatus; blocked_by: string | null;
  fired_at: string | null; price: string | null; features: SignalFeatures | null; outcome: SignalRow["outcome"]; r: string | null; mae_r: string | null; mfe_r: string | null; rr: string | null; false_break: boolean | null;
}
const num = (s: string | null) => (s === null ? null : Number(s));

export async function listSignals(o: { days?: number; source?: Source | "all"; symbol?: string } = {}): Promise<SignalRow[]> {
  if (!hasDatabase()) return [];
  const params: unknown[] = [o.days ?? 90];
  let where = "day > current_date - ($1 || ' days')::interval";
  if (o.source && o.source !== "all") { params.push(o.source); where += ` and source = $${params.length}`; }
  if (o.symbol) { params.push(o.symbol); where += ` and symbol = $${params.length}`; }
  const rows = await query<DbRow>(
    `select symbol, day::text, model, source, direction, trigger, status, blocked_by, fired_at::text, price, features, outcome, r, mae_r, mfe_r, rr, false_break
     from signal_log where ${where} order by day desc, fired_at desc nulls last limit 20000`, params
  );
  return rows.map((r) => ({
    symbol: r.symbol, day: r.day, model: r.model, source: r.source, direction: r.direction, trigger: Number(r.trigger), status: r.status, blockedBy: r.blocked_by,
    firedAt: r.fired_at ? new Date(r.fired_at).toISOString() : null, price: num(r.price), features: r.features, outcome: r.outcome,
    r: num(r.r), maeR: num(r.mae_r), mfeR: num(r.mfe_r), rr: num(r.rr), falseBreak: r.false_break,
  }));
}

/** Newest replayed session per symbol, so a catch-up knows where to start. */
export async function replayCoverage(): Promise<{ symbol: string; first: string; last: string; sessions: number }[]> {
  if (!hasDatabase()) return [];
  return query<{ symbol: string; first: string; last: string; sessions: number }>(
    "select symbol, min(day)::text as first, max(day)::text as last, count(distinct day)::int as sessions from signal_log where source = 'replay' group by symbol order by symbol"
  );
}

/**
 * Settles live rows once their session is over: entries and held-back
 * confirmations get an outcome from that day's minute bars; setups still
 * OPEN after their session never triggered.
 */
export async function resolveLive(limit = 12): Promise<{ resolved: number; closed: number }> {
  if (!hasDatabase() || !hasAlpacaKeys()) return { resolved: 0, closed: 0 };
  const now = Date.now();
  const today = etStamp(now).date;
  const sessionDone = sessionOf(now) === "afterhours" || sessionOf(now) === "closed";
  const dayRule = sessionDone ? "day <= $1::date" : "day < $1::date";
  const closed = await query<{ n: string }>(`with u as (update signal_log set status = 'NEVER TRIGGERED', updated_at = now() where source = 'live' and status = 'OPEN' and ${dayRule} returning 1) select count(*)::text as n from u`, [today]).catch(() => []);
  const pending = await query<{ id: string; symbol: string; day: string; direction: "long" | "short"; trigger: string; invalidation: string; targets: number[]; price: string; fired_at: string }>(
    `select id, symbol, day::text, direction, trigger, invalidation, targets, price, fired_at::text from signal_log
     where source = 'live' and status in ('ENTRY','NO ENTRY') and outcome is null and resolved_at is null and price is not null and fired_at is not null and ${dayRule}
     order by day desc limit $2`, [today, limit]
  ).catch(() => []);
  let resolved = 0;
  for (const p of pending) {
    try {
      const start = new Date(`${p.day}T08:00:00Z`).toISOString();
      const end = new Date(Date.parse(`${p.day}T08:00:00Z`) + 86400e3).toISOString();
      const raw = await getStockBars(p.symbol, "1Min", start, end, 3_600_000);
      const m1 = raw.map((b) => ({ t: Date.parse(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, vw: b.vw ?? b.c })).filter((b) => etStamp(b.t).date === p.day);
      const o = resolveOutcome({ direction: p.direction, price: Number(p.price), trigger: Number(p.trigger), invalidation: Number(p.invalidation), targets: p.targets ?? [], t: Date.parse(p.fired_at) }, m1);
      // No usable bars or no target left ahead of the entry: leave the outcome empty (it is not counted) and stop retrying.
      if (!o) { await query("update signal_log set resolved_at = now(), exit = 'unresolved' where id = $1", [p.id]); continue; }
      await query("update signal_log set outcome = $2, r = $3, mae_r = $4, mfe_r = $5, rr = $6, exit = $7, false_break = $8, resolved_at = now(), updated_at = now() where id = $1", [p.id, o.result, o.r, o.maeR, o.mfeR, o.rr, o.exit, o.falseBreak]);
      resolved++;
    } catch {
      /* try again on the next call */
    }
  }
  return { resolved, closed: Number(closed[0]?.n ?? 0) };
}
