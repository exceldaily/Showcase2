// ─────────────────────────────────────────────────────────
// CBOE delayed public data (server only, no key).
// Alpaca carries no index feed and no index options, so SPX comes from
// CBOE's delayed quote + option chain JSON (roughly 15 minutes behind
// during the session). Everything from here is tagged delayed and is
// never presented as real-time.
// ─────────────────────────────────────────────────────────

import type { OptionSnapshot } from "./alpaca";
import { etOffsetMs } from "@/lib/intraday";

const BASE = "https://cdn.cboe.com/api/global/delayed_quotes";

export interface CboeQuote {
  symbol: string;         // "_SPX"
  price: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  lastTradeTime: string;  // "2026-09-09T16:14:59" (ET, no zone)
  asOf: string;           // feed timestamp
  delayed: true;
}

export interface CboeChain {
  asOf: string;
  underlyingPrice: number;
  prevClose: number;
  snapshots: Record<string, OptionSnapshot>;
  openInterest: Map<string, number>;
}

interface CboeOptionRow {
  option: string;
  bid: number; bid_size: number; ask: number; ask_size: number;
  iv: number; open_interest: number; volume: number;
  delta: number; gamma: number; vega: number; theta: number; rho: number;
  last_trade_price: number | null; last_trade_time: string | null;
  open: number; high: number; low: number; prev_day_close: number;
}

interface CboeQuoteBody {
  timestamp: string;
  data: { symbol: string; current_price: number; prev_day_close: number; open: number; high: number; low: number; last_trade_time: string };
}
interface CboeChainBody {
  timestamp: string;
  data: { current_price: number; prev_day_close: number; options: CboeOptionRow[] };
}

const cache = new Map<string, { at: number; ttl: number; data: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

async function get<T>(url: string, ttlMs: number): Promise<T> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.data as T;
  const pending = inflight.get(url);
  if (pending) return pending as Promise<T>;
  const p = (async () => {
    const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!res.ok) throw new Error(`CBOE ${res.status} for ${url.split("/").pop()}`);
    const data = (await res.json()) as T;
    cache.set(url, { at: Date.now(), ttl: ttlMs, data });
    return data;
  })();
  inflight.set(url, p);
  try {
    return await p;
  } finally {
    inflight.delete(url);
  }
}

/** CBOE's ET timestamp ("2026-09-09T16:14:59") to ISO with the right offset. */
export function cboeTimeToIso(local: string): string {
  // Read the wall-clock as if it were UTC, then remove the Eastern offset
  // (etOffsetMs is ET minus UTC, negative) to get the true instant.
  const wall = Date.parse(local.replace(" ", "T") + "Z");
  if (Number.isNaN(wall)) return new Date().toISOString();
  return new Date(wall - etOffsetMs(wall)).toISOString();
}

export async function getCboeQuote(index: string, ttlMs = 30_000): Promise<CboeQuote> {
  const b = await get<CboeQuoteBody>(`${BASE}/quotes/${index}.json`, ttlMs);
  const d = b.data;
  return {
    symbol: d.symbol, price: d.current_price, prevClose: d.prev_day_close, open: d.open, high: d.high, low: d.low,
    lastTradeTime: d.last_trade_time, asOf: cboeTimeToIso(b.timestamp), delayed: true,
  };
}

/** Pure: one CBOE row to the Alpaca-shaped snapshot the pipeline already understands. */
export function cboeRowToSnapshot(r: CboeOptionRow, asOfIso: string): OptionSnapshot {
  return {
    latestQuote: { bp: r.bid, ap: r.ask, bs: r.bid_size, as: r.ask_size, t: asOfIso },
    latestTrade: r.last_trade_price !== null && r.last_trade_time ? { p: r.last_trade_price, s: 0, t: cboeTimeToIso(r.last_trade_time) } : undefined,
    dailyBar: { o: r.open, h: r.high, l: r.low, c: r.last_trade_price ?? r.prev_day_close, v: r.volume },
    greeks: { delta: r.delta, gamma: r.gamma, theta: r.theta, vega: r.vega, rho: r.rho },
    impliedVolatility: r.iv > 0 ? r.iv : undefined,
  };
}

/** Pure: keep only the strikes/expiries the terminal needs (the full SPX file is ~30k rows). */
export function filterCboeRows(rows: CboeOptionRow[], o: { strikeGte: number; strikeLte: number; expirationLte: string; expirationGte?: string }): CboeOptionRow[] {
  const gte = (o.expirationGte ?? "2000-01-01").replace(/-/g, "").slice(2);
  const lte = o.expirationLte.replace(/-/g, "").slice(2);
  const out: CboeOptionRow[] = [];
  for (const r of rows) {
    const m = /^([A-Z]{1,6})(\d{6})([CP])(\d{8})$/.exec(r.option);
    if (!m) continue;
    const exp = m[2];
    if (exp < gte || exp > lte) continue;
    const strike = parseInt(m[4], 10) / 1000;
    if (strike < o.strikeGte || strike > o.strikeLte) continue;
    if (!(r.bid > 0 || r.ask > 0)) continue;
    out.push(r);
  }
  return out;
}

export async function getCboeChain(
  index: string,
  o: { strikeGte: number; strikeLte: number; expirationLte: string; expirationGte?: string },
  ttlMs = 60_000
): Promise<CboeChain> {
  const b = await get<CboeChainBody>(`${BASE}/options/${index}.json`, ttlMs);
  const asOf = cboeTimeToIso(b.timestamp);
  const snapshots: Record<string, OptionSnapshot> = {};
  const openInterest = new Map<string, number>();
  for (const r of filterCboeRows(b.data.options, o)) {
    snapshots[r.option] = cboeRowToSnapshot(r, asOf);
    openInterest.set(r.option, r.open_interest);
  }
  return { asOf, underlyingPrice: b.data.current_price, prevClose: b.data.prev_day_close, snapshots, openInterest };
}
