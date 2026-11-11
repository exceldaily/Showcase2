// ─────────────────────────────────────────────────────────
// Options bot engine (server only). One pass ("tick") does, in order:
//   1. reconcile  ask the broker what happened to every order the bot sent
//   2. exits      sell positions whose rules say so
//   3. entries    buy when the setup quality engine says CALL or PUT and
//                 the money rules allow it
// A database lock makes sure two schedulers never run a pass at once.
// The decision rules live in rules.ts; this file only moves data.
// ─────────────────────────────────────────────────────────

import { randomUUID } from "node:crypto";
import { hasDatabase, query, queryOne } from "../db";
import { etStamp } from "../intraday";
import { parseOcc } from "../optionsMath";
import { buildOptionsAnalysis } from "../optionsTerminal";
import { fredReleaseEvents, manualEvents } from "../catalystsLive";
import {
  AlpacaError, cancelOrder, dataTier, getClock, getOptionSnapshots, getOrder, getPositions, getStockSnapshots, hasAlpacaKeys, isPaper, submitOrder,
} from "@/providers/alpaca";
import { getBotSettings, saveBotSettings } from "./settings";
import { budgetState, entryBlocks, exitDecision, exitLimit, planEntry, type BotSettings, type BudgetState, type TradeMoney, type TradeStatus } from "./rules";

export interface BotTrade {
  id: string; symbol: string; occ: string; side: "call" | "put"; qty: number; status: TradeStatus; paper: boolean;
  limitPrice: number; reserved: number; entryOrderId: string | null; entryFill: number | null; cost: number;
  exitOrderId: string | null; exitAttempts: number; exitFill: number | null; pnl: number;
  reasonIn: string | null; reasonOut: string | null; trigger: number | null; target: number | null; invalidation: number | null;
  setupScore: number | null; expiry: string | null; day: string; openedAt: string; filledAt: string | null; exitSentAt: string | null; closedAt: string | null;
}

interface Row {
  id: string; symbol: string; occ: string; side: "call" | "put"; qty: number; status: TradeStatus; paper: boolean; limit_price: string; reserved: string;
  entry_order_id: string | null; entry_fill: string | null; cost: string; exit_order_id: string | null; exit_attempts: number; exit_fill: string | null; pnl: string;
  reason_in: string | null; reason_out: string | null; trigger: string | null; target: string | null; invalidation: string | null; setup_score: number | null;
  expiry: string | null; day: string; opened_at: string; filled_at: string | null; exit_sent_at: string | null; closed_at: string | null;
}
const COLS = "id, symbol, occ, side, qty, status, paper, limit_price, reserved, entry_order_id, entry_fill, cost, exit_order_id, exit_attempts, exit_fill, pnl, reason_in, reason_out, trigger, target, invalidation, setup_score, expiry::text, day::text, opened_at::text, filled_at::text, exit_sent_at::text, closed_at::text";
const n = (s: string | null) => (s === null ? null : Number(s));
const iso = (s: string | null) => (s ? new Date(s).toISOString() : null);
const toTrade = (r: Row): BotTrade => ({
  id: r.id, symbol: r.symbol, occ: r.occ, side: r.side, qty: r.qty, status: r.status, paper: r.paper, limitPrice: Number(r.limit_price), reserved: Number(r.reserved),
  entryOrderId: r.entry_order_id, entryFill: n(r.entry_fill), cost: Number(r.cost), exitOrderId: r.exit_order_id, exitAttempts: r.exit_attempts, exitFill: n(r.exit_fill), pnl: Number(r.pnl),
  reasonIn: r.reason_in, reasonOut: r.reason_out, trigger: n(r.trigger), target: n(r.target), invalidation: n(r.invalidation), setupScore: r.setup_score,
  expiry: r.expiry, day: r.day, openedAt: iso(r.opened_at) as string, filledAt: iso(r.filled_at), exitSentAt: iso(r.exit_sent_at), closedAt: iso(r.closed_at),
});
const money = (t: BotTrade): TradeMoney => ({ status: t.status, reserved: t.reserved, cost: t.cost, pnl: t.pnl, day: t.day, openedAt: t.openedAt });

export async function listTrades(limit = 200): Promise<BotTrade[]> {
  if (!hasDatabase()) return [];
  return (await query<Row>(`select ${COLS} from bot_trades order by opened_at desc limit $1`, [limit])).map(toTrade);
}

/** Trades that still matter to the budget: everything since the budget was set, plus anything still open. */
async function budgetTrades(s: BotSettings): Promise<BotTrade[]> {
  const since = s.budgetSince ?? "1970-01-01T00:00:00Z";
  return (await query<Row>(`select ${COLS} from bot_trades where opened_at >= $1::timestamptz or status in ('PENDING_ENTRY','OPEN','PENDING_EXIT') order by opened_at desc`, [since])).map(toTrade);
}

export async function logEvent(level: "info" | "warn" | "trade", symbol: string | null, message: string, dedupeMinutes = 0): Promise<void> {
  if (!hasDatabase()) return;
  if (dedupeMinutes > 0) {
    const seen = await queryOne<{ id: string }>("select id::text from bot_events where message = $1 and coalesce(symbol, '') = coalesce($2, '') and at > now() - ($3 || ' minutes')::interval limit 1", [message, symbol, String(dedupeMinutes)]).catch(() => null);
    if (seen) return;
  }
  await query("insert into bot_events (level, symbol, message) values ($1, $2, $3)", [level, symbol, message.slice(0, 400)]).catch(() => undefined);
}

export async function listEvents(limit = 80): Promise<{ at: string; level: string; symbol: string | null; message: string }[]> {
  if (!hasDatabase()) return [];
  return (await query<{ at: string; level: string; symbol: string | null; message: string }>("select at::text, level, symbol, message from bot_events order by at desc limit $1", [limit])).map((e) => ({ ...e, at: new Date(e.at).toISOString() }));
}

export async function botBudget(s?: BotSettings): Promise<BudgetState> {
  const settings = s ?? (await getBotSettings());
  return budgetState(settings, (await budgetTrades(settings)).map(money), etStamp(Date.now()).date);
}

/** Live money is refused unless three separate switches are on. None of them is set by the app. */
export function accountGuard(): { ok: boolean; paper: boolean; reason: string | null } {
  if (isPaper()) return { ok: true, paper: true, reason: null };
  if (process.env.ENABLE_LIVE_TRADING === "true" && process.env.BOT_ALLOW_LIVE === "true") return { ok: true, paper: false, reason: null };
  return { ok: false, paper: false, reason: "The broker is set to a live account and BOT_ALLOW_LIVE is not on. The bot will not trade real money without it." };
}

const TERMINAL = ["canceled", "expired", "rejected", "done_for_day", "replaced"];
const ENTRY_WAIT_MS = 90_000;
const EXIT_WAIT_MS = 60_000;

async function reconcile(trades: BotTrade[], now: number): Promise<number> {
  let changed = 0;
  for (const t of trades) {
    try {
      if (t.status === "PENDING_ENTRY" && t.entryOrderId) {
        const o = await getOrder(t.entryOrderId);
        const filled = Math.round(Number(o.filled_qty ?? 0));
        const avg = Number(o.filled_avg_price ?? 0);
        const done = o.status === "filled" || TERMINAL.includes(o.status);
        if (done && filled > 0) {
          const cost = Math.round(filled * avg * 100 * 100) / 100;
          await query("update bot_trades set status = 'OPEN', qty = $2, entry_fill = $3, cost = $4, filled_at = now() where id = $1", [t.id, filled, avg, cost]);
          await logEvent("trade", t.symbol, `Bought ${filled} ${t.occ} at $${avg.toFixed(2)} ($${cost.toFixed(0)}).`);
          changed++;
        } else if (done) {
          await query("update bot_trades set status = 'CANCELED', reason_out = $2, closed_at = now() where id = $1", [t.id, `buy order ${o.status}, nothing filled`]);
          await logEvent("info", t.symbol, `Buy order for ${t.occ} ${o.status} with nothing filled. Budget released.`);
          changed++;
        } else if (now - Date.parse(t.openedAt) > ENTRY_WAIT_MS) {
          await cancelOrder(t.entryOrderId).catch(() => undefined); // settled on the next pass
        }
      } else if (t.status === "PENDING_EXIT" && t.exitOrderId) {
        const o = await getOrder(t.exitOrderId);
        const filled = Math.round(Number(o.filled_qty ?? 0));
        const avg = Number(o.filled_avg_price ?? 0);
        const entry = t.entryFill ?? t.limitPrice;
        if (o.status === "filled" || (TERMINAL.includes(o.status) && filled >= t.qty)) {
          const pnl = Math.round((avg - entry) * 100 * t.qty * 100) / 100;
          await query("update bot_trades set status = 'CLOSED', exit_fill = $2, pnl = pnl + $3, cost = 0, closed_at = now() where id = $1", [t.id, avg, pnl]);
          await logEvent("trade", t.symbol, `Sold ${t.qty} ${t.occ} at $${avg.toFixed(2)}: ${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(0)}. ${t.reasonOut ?? ""}`);
          changed++;
        } else if (TERMINAL.includes(o.status)) {
          // Part (or none) sold: book what sold, keep the rest open so the next pass tries again.
          const left = t.qty - filled;
          const pnl = Math.round((avg - entry) * 100 * filled * 100) / 100;
          await query("update bot_trades set status = 'OPEN', qty = $2, cost = $3, pnl = pnl + $4, exit_order_id = null where id = $1", [t.id, left, Math.round(entry * 100 * left * 100) / 100, filled > 0 ? pnl : 0]);
          changed++;
        } else if (t.exitSentAt && now - Date.parse(t.exitSentAt) > EXIT_WAIT_MS) {
          await cancelOrder(t.exitOrderId).catch(() => undefined);
        }
      }
    } catch (e) {
      await logEvent("warn", t.symbol, `Could not check order for ${t.occ}: ${e instanceof Error ? e.message.slice(0, 120) : "error"}`, 10);
    }
  }
  return changed;
}

async function sell(t: BotTrade, reason: string, urgent: boolean, limit: number | null): Promise<void> {
  const market = urgent || t.exitAttempts >= 2 || limit === null;
  const clientOrderId = `botx-${randomUUID().slice(0, 18)}`;
  try {
    const o = await submitOrder({ symbol: t.occ, qty: t.qty, side: "sell", type: market ? "market" : "limit", limitPrice: market ? undefined : (limit as number), clientOrderId });
    await query("update bot_trades set status = 'PENDING_EXIT', exit_order_id = $2, exit_attempts = exit_attempts + 1, exit_sent_at = now(), reason_out = $3 where id = $1", [t.id, o.id, reason]);
    await logEvent("trade", t.symbol, `Selling ${t.qty} ${t.occ} ${market ? "at market" : `limit $${(limit as number).toFixed(2)}`}: ${reason}.`);
  } catch (e) {
    await logEvent("warn", t.symbol, `Sell order for ${t.occ} was refused: ${e instanceof Error ? e.message.slice(0, 160) : "error"}`, 5);
  }
}

async function manageExits(s: BotSettings, open: BotTrade[], now: number, marketOpen: boolean, forceAll: string | null): Promise<number> {
  if (open.length === 0) return 0;
  const today = etStamp(now).date;
  const [positions, optSnaps, stockSnaps] = await Promise.all([
    getPositions().catch(() => null),
    getOptionSnapshots(open.map((t) => t.occ)).catch(() => ({} as Awaited<ReturnType<typeof getOptionSnapshots>>)),
    getStockSnapshots(Array.from(new Set(open.map((t) => t.symbol)))).catch(() => ({} as Awaited<ReturnType<typeof getStockSnapshots>>)),
  ]);
  let sent = 0;
  for (const t of open) {
    const pos = positions?.find((p) => p.symbol === t.occ) ?? null;
    // The broker no longer holds it (expired, or closed by hand): book it so the budget stays honest.
    if (positions && !pos) {
      const expired = t.expiry !== null && t.expiry < today;
      const pnl = -t.cost; // unknown exit: assume the worst, never understate a loss
      await query("update bot_trades set status = 'CLOSED', pnl = pnl + $2, cost = 0, reason_out = $3, closed_at = now() where id = $1", [t.id, pnl, expired ? "expired" : "position no longer at the broker (closed outside the bot); counted as a full loss"]);
      await logEvent("warn", t.symbol, `${t.occ} is no longer at the broker. Booked as a full loss of $${t.cost.toFixed(0)}.`);
      continue;
    }
    if (!marketOpen) continue;
    const q = optSnaps[t.occ]?.latestQuote;
    const mid = q && q.bp > 0 && q.ap > 0 ? (q.bp + q.ap) / 2 : null;
    const optionPrice = pos?.current_price ? Number(pos.current_price) : mid;
    const underlying = stockSnaps[t.symbol]?.latestTrade?.p ?? null;
    const call = forceAll
      ? { exit: true, reason: forceAll, urgent: true }
      : exitDecision(s, { side: t.side, entryFill: t.entryFill ?? t.limitPrice, openedAtMs: Date.parse(t.filledAt ?? t.openedAt), target: t.target, invalidation: t.invalidation }, { minutes: etStamp(now).minutes, nowMs: now, underlying, optionPrice });
    if (!call.exit) continue;
    await sell(t, call.reason, call.urgent, exitLimit(s, q && q.bp > 0 ? q.bp : null, optionPrice ?? t.entryFill ?? t.limitPrice));
    sent++;
  }
  return sent;
}

async function highImpactSoon(now: number, minutes = 15): Promise<string | null> {
  try {
    const [fred, manual] = await Promise.all([fredReleaseEvents(now).then((r) => r.events).catch(() => []), manualEvents(now).catch(() => [])]);
    const hit = [...fred, ...manual].find((e) => String(e.impact).toLowerCase() === "high" && (e.affects === "market" || !e.affects) && Date.parse(e.at) - now >= 0 && Date.parse(e.at) - now <= minutes * 60_000);
    return hit ? hit.title : null;
  } catch {
    return null;
  }
}

async function findEntries(s: BotSettings, trades: BotTrade[], now: number, paper: boolean): Promise<{ placed: number; looked: number; skipped: string[] }> {
  const today = etStamp(now).date;
  const skipped: string[] = [];
  let placed = 0;
  const event = await highImpactSoon(now);
  if (event) return { placed, looked: 0, skipped: [`high-impact event within 15 minutes (${event})`] };
  // One trade per symbol per day keeps a bad level from being bought twice.
  const used = new Set(trades.filter((t) => t.day === today && t.status !== "CANCELED" && t.status !== "REJECTED").map((t) => t.symbol));
  const todo = s.symbols.filter((sym) => !used.has(sym));
  for (let i = 0; i < todo.length; i += 4) {
    const analyses = await Promise.all(todo.slice(i, i + 4).map((sym) => buildOptionsAnalysis(sym, { profile: "DAY" }).catch(() => null)));
    for (const a of analyses) {
      if (!a || !a.read || a.indexMode) continue;
      const call = a.read.call;
      if (call !== "CALL" && call !== "PUT") continue;
      const side = call === "CALL" ? "call" : "put";
      const contract = a.contracts.filter((c) => c.side === side && c.dte <= s.maxDte + 0.999 && !c.stale && c.bid > 0 && c.ask > 0).sort((x, y) => y.score - x.score)[0] ?? null;
      // The budget is re-read for every candidate so two entries in one pass cannot both spend the same dollars.
      const budget = budgetState(s, (await budgetTrades(s)).map(money), today);
      const blocks = entryBlocks(s, budget, etStamp(now).minutes, true);
      if (blocks.length) { skipped.push(`${a.symbol}: ${blocks[0]}`); continue; }
      const plan = planEntry(s, budget, { symbol: a.symbol, call, setupScore: a.read.quality?.score ?? null, side, contract: contract ? { symbol: contract.symbol, ask: contract.ask, bid: contract.bid, spreadPct: contract.spreadPct, dte: contract.dte, openInterest: contract.openInterest, volume: contract.volume } : null });
      if (!plan.ok || !contract) { skipped.push(`${a.symbol}: ${plan.reason}`); await logEvent("info", a.symbol, `${call} signal skipped: ${plan.reason}.`, 30); continue; }
      const why = `${call}: ${a.read.reason} (setup score ${a.read.quality?.score ?? "n/a"})`;
      if (s.mode === "dry-run") {
        await logEvent("info", a.symbol, `DRY RUN: would buy ${plan.qty} ${contract.symbol} limit $${plan.limit.toFixed(2)} ($${plan.reserve.toFixed(0)} reserved). ${why}.`, 30);
        skipped.push(`${a.symbol}: dry run`);
        continue;
      }
      // Reserve first, then send: the row exists (and counts against the budget) before the broker hears about it.
      const id = randomUUID();
      const occParts = parseOcc(contract.symbol);
      await query(
        `insert into bot_trades (id, symbol, occ, side, qty, status, paper, limit_price, reserved, reason_in, trigger, target, invalidation, setup_score, features, expiry, day)
         values ($1,$2,$3,$4,$5,'PENDING_ENTRY',$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16)`,
        [id, a.symbol, contract.symbol, side, plan.qty, paper, plan.limit, plan.reserve, why, a.plan?.trigger ?? null, a.plan?.targets[0] ?? null, a.plan?.invalidation ?? null, a.read.quality?.score ?? null, JSON.stringify(a.signalFeatures ?? null), occParts?.expiry ?? null, today]
      );
      try {
        const o = await submitOrder({ symbol: contract.symbol, qty: plan.qty, side: "buy", type: "limit", limitPrice: plan.limit, clientOrderId: `bot-${id.slice(0, 18)}` });
        await query("update bot_trades set entry_order_id = $2 where id = $1", [id, o.id]);
        await logEvent("trade", a.symbol, `Buying ${plan.qty} ${contract.symbol} limit $${plan.limit.toFixed(2)} ($${plan.reserve.toFixed(0)} reserved). ${why}.`);
        placed++;
      } catch (e) {
        const msg = e instanceof AlpacaError || e instanceof Error ? e.message.slice(0, 160) : "error";
        await query("update bot_trades set status = 'REJECTED', reason_out = $2, closed_at = now() where id = $1", [id, msg]);
        await logEvent("warn", a.symbol, `Buy order for ${contract.symbol} was refused: ${msg}`);
      }
    }
  }
  return { placed, looked: todo.length, skipped };
}

export interface TickResult { ran: boolean; reason?: string; mode?: string; paper?: boolean; marketOpen?: boolean; reconciled?: number; exits?: number; placed?: number; looked?: number; skipped?: string[]; tookMs?: number }

export async function runBotTick(): Promise<TickResult> {
  if (!hasDatabase() || !hasAlpacaKeys()) return { ran: false, reason: "database or Alpaca not configured" };
  const s = await getBotSettings(true);
  const started = Date.now();
  const active = (await query<Row>(`select ${COLS} from bot_trades where status in ('PENDING_ENTRY','OPEN','PENDING_EXIT')`)).map(toTrade);
  // Off with nothing open: nothing to do. Off with positions still open keeps reconciling and managing exits.
  if (s.mode === "off" && active.length === 0) return { ran: false, reason: "bot is off", mode: s.mode };
  const lock = await queryOne<{ ok: number }>("update bot_state set tick_at = now() where id = 1 and (tick_at is null or tick_at < now() - interval '20 seconds') returning 1 as ok").catch(() => null);
  if (!lock) return { ran: false, reason: "another pass is running" };
  const guard = accountGuard();
  if (!guard.ok) { await logEvent("warn", null, guard.reason as string, 60); return { ran: false, reason: guard.reason as string }; }
  const clock = await getClock().catch(() => null);
  const marketOpen = clock?.is_open ?? false;
  const reconciled = await reconcile(active, started);
  const open = (await query<Row>(`select ${COLS} from bot_trades where status = 'OPEN'`)).map(toTrade);
  const exits = await manageExits(s, open, started, marketOpen, null);
  let placed = 0, looked = 0, skipped: string[] = [];
  if (s.mode !== "off") {
    const trades = await budgetTrades(s);
    const blocks = entryBlocks(s, budgetState(s, trades.map(money), etStamp(started).date), etStamp(started).minutes, marketOpen);
    if (blocks.length) skipped = blocks;
    else ({ placed, looked, skipped } = await findEntries(s, trades, started, guard.paper));
  }
  const result: TickResult = { ran: true, mode: s.mode, paper: guard.paper, marketOpen, reconciled, exits, placed, looked, skipped: skipped.slice(0, 12), tookMs: Date.now() - started };
  await query("update bot_state set summary = $1::jsonb where id = 1", [JSON.stringify({ ...result, at: new Date().toISOString(), dataTier: dataTier() })]).catch(() => undefined);
  return result;
}

/** Stop: turn the bot off, pull unfilled buys, and (optionally) sell everything at market. */
export async function stopBot(sellEverything: boolean): Promise<{ canceled: number; selling: number }> {
  const s = await getBotSettings(true);
  await saveBotSettings({ ...s, mode: "off" });
  const active = (await query<Row>(`select ${COLS} from bot_trades where status in ('PENDING_ENTRY','OPEN','PENDING_EXIT')`)).map(toTrade);
  let canceled = 0;
  for (const t of active.filter((x) => x.status === "PENDING_ENTRY" && x.entryOrderId)) { await cancelOrder(t.entryOrderId as string).then(() => canceled++).catch(() => undefined); }
  await logEvent("warn", null, sellEverything ? "Bot stopped. Selling every open position at market." : "Bot paused. Open positions stay under the exit rules.");
  let selling = 0;
  if (sellEverything) {
    const clock = await getClock().catch(() => null);
    selling = await manageExits(s, active.filter((x) => x.status === "OPEN"), Date.now(), clock?.is_open ?? false, "stopped by you: sell everything");
  }
  return { canceled, selling };
}

export async function botSnapshot() {
  const s = await getBotSettings(true);
  const [trades, events, state] = await Promise.all([
    listTrades(120), listEvents(80),
    queryOne<{ tick_at: string | null; summary: unknown }>("select tick_at::text, summary from bot_state where id = 1").catch(() => null),
  ]);
  const guard = accountGuard();
  // One cheap price call, so a freshly started server knows which data plan is active before reporting it.
  await getStockSnapshots(["SPY"], 30_000).catch(() => undefined);
  return {
    settings: s, budget: budgetState(s, (await budgetTrades(s)).map(money), etStamp(Date.now()).date), trades, events,
    lastTick: state?.tick_at ? new Date(state.tick_at).toISOString() : null, lastSummary: state?.summary ?? null,
    account: { paper: guard.paper, ok: guard.ok, reason: guard.reason }, dataTier: dataTier(),
  };
}
