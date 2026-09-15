// Journal storage (IO). Rows belong to the signed-in user; every
// query is scoped by user_id.

import { query, queryOne } from "../db";
import type { Outcome, TradeRecord, TradeSnapshot, TradeStatus } from "./types";

interface Row {
  id: string; status: TradeStatus; symbol: string; direction: "long" | "short"; side: "call" | "put" | null; contract: string | null;
  strike: string | null; expiry: string | null; entry_premium: string | null; qty: number; entry_at: string; exit_premium: string | null; exit_at: string | null;
  pnl: string | null; risk_dollars: string | null; mae: string | null; mfe: string | null; setup: string | null; lifecycle: string | null; market_state: string | null;
  confidence: number | null; trigger_price: string | null; invalidation: string | null; targets: number[] | null; snapshot: TradeSnapshot | null;
  strike_tag: string | null; aligned: boolean | null; skipped_reason: string | null; outcome: Outcome | null; review_tags: string[]; notes: string | null;
}

const num = (v: string | null) => (v === null ? null : Number(v));
const iso = (v: string | null) => (v === null ? null : new Date(v).toISOString());

function toRecord(r: Row): TradeRecord {
  return {
    id: r.id, status: r.status, symbol: r.symbol, direction: r.direction, side: r.side, contract: r.contract, strike: num(r.strike), expiry: r.expiry ? String(r.expiry).slice(0, 10) : null,
    entryPremium: num(r.entry_premium), qty: r.qty, entryAt: new Date(r.entry_at).toISOString(), exitPremium: num(r.exit_premium), exitAt: iso(r.exit_at),
    pnl: num(r.pnl), riskDollars: num(r.risk_dollars), mae: num(r.mae), mfe: num(r.mfe), setup: r.setup, lifecycle: r.lifecycle, marketState: r.market_state,
    confidence: r.confidence, trigger: num(r.trigger_price), invalidation: num(r.invalidation), targets: r.targets, snapshot: r.snapshot, strikeTag: r.strike_tag,
    aligned: r.aligned, skippedReason: r.skipped_reason, outcome: r.outcome, reviewTags: r.review_tags ?? [], notes: r.notes,
  };
}

const COLS = "id, status, symbol, direction, side, contract, strike::text, expiry::text, entry_premium::text, qty, entry_at::text, exit_premium::text, exit_at::text, pnl::text, risk_dollars::text, mae::text, mfe::text, setup, lifecycle, market_state, confidence, trigger_price::text, invalidation::text, targets, snapshot, strike_tag, aligned, skipped_reason, outcome, review_tags, notes";

export async function listTrades(userId: string, limit = 500): Promise<TradeRecord[]> {
  const rows = await query<Row>(`select ${COLS} from option_trades where user_id = $1 order by entry_at desc limit $2`, [userId, limit]);
  return rows.map(toRecord);
}

export interface NewTrade {
  status: TradeStatus;
  symbol: string; direction: "long" | "short"; side: "call" | "put" | null; contract: string | null; strike: number | null; expiry: string | null;
  entryPremium: number | null; qty: number; riskDollars: number | null; setup: string | null; lifecycle: string | null; marketState: string | null;
  confidence: number | null; trigger: number | null; invalidation: number | null; targets: number[] | null; snapshot: TradeSnapshot | null;
  strikeTag: string | null; aligned: boolean | null; skippedReason: string | null; notes: string | null;
}

export async function createTrade(userId: string, t: NewTrade): Promise<TradeRecord> {
  const row = await queryOne<Row>(
    `insert into option_trades (user_id, status, symbol, direction, side, contract, strike, expiry, entry_premium, qty, risk_dollars, setup, lifecycle, market_state, confidence, trigger_price, invalidation, targets, snapshot, strike_tag, aligned, skipped_reason, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) returning ${COLS}`,
    [userId, t.status, t.symbol, t.direction, t.side, t.contract, t.strike, t.expiry, t.entryPremium, t.qty, t.riskDollars, t.setup, t.lifecycle, t.marketState, t.confidence, t.trigger, t.invalidation, t.targets ? JSON.stringify(t.targets) : null, t.snapshot ? JSON.stringify(t.snapshot) : null, t.strikeTag, t.aligned, t.skippedReason, t.notes]
  );
  if (!row) throw new Error("insert failed");
  return toRecord(row);
}

export interface TradePatch {
  exitPremium?: number | null;
  exitAt?: string | null;
  mae?: number | null;
  mfe?: number | null;
  reviewTags?: string[];
  notes?: string | null;
  outcome?: Outcome | null;
  status?: TradeStatus;
}

export async function updateTrade(userId: string, id: string, p: TradePatch): Promise<TradeRecord | null> {
  const current = await queryOne<Row>(`select ${COLS} from option_trades where id = $1 and user_id = $2`, [id, userId]);
  if (!current) return null;
  const cur = toRecord(current);
  const exitPremium = p.exitPremium !== undefined ? p.exitPremium : cur.exitPremium;
  const status = p.status ?? (p.exitPremium !== undefined && p.exitPremium !== null && cur.status === "open" ? "closed" : cur.status);
  const pnl = status === "closed" && exitPremium !== null && cur.entryPremium !== null ? Math.round((exitPremium - cur.entryPremium) * 100 * cur.qty * 100) / 100 : cur.pnl;
  const exitAt = p.exitAt !== undefined ? p.exitAt : status === "closed" && cur.exitAt === null ? new Date().toISOString() : cur.exitAt;
  const row = await queryOne<Row>(
    `update option_trades set exit_premium = $3, exit_at = $4, pnl = $5, mae = $6, mfe = $7, review_tags = $8, notes = $9, outcome = $10, status = $11, updated_at = now()
     where id = $1 and user_id = $2 returning ${COLS}`,
    [id, userId, exitPremium, exitAt, pnl, p.mae !== undefined ? p.mae : cur.mae, p.mfe !== undefined ? p.mfe : cur.mfe, p.reviewTags ?? cur.reviewTags, p.notes !== undefined ? p.notes : cur.notes, p.outcome !== undefined ? p.outcome : cur.outcome, status]
  );
  return row ? toRecord(row) : null;
}

export async function deleteTrade(userId: string, id: string): Promise<boolean> {
  const rows = await query<{ id: string }>("delete from option_trades where id = $1 and user_id = $2 returning id", [id, userId]);
  return rows.length > 0;
}
