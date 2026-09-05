// ─────────────────────────────────────────────────────────
// Alpaca provider (Algo Trader Plus): SIP stocks + OPRA options +
// paper/live trading. SERVER-SIDE ONLY — keys never reach the
// browser; every route using this module runs on the server.
//
// Safety: trading defaults to the PAPER host. The live host is used
// only when ALPACA_PAPER=false AND ENABLE_LIVE_TRADING=true, and
// order submission re-checks that guard on every call.
//
// Efficiency: batched snapshot endpoints cover a whole watchlist in
// one request; hot GETs are deduplicated and TTL-cached in-module so
// UI polling cannot hammer Alpaca.
// ─────────────────────────────────────────────────────────

const DATA = "https://data.alpaca.markets";

export function hasAlpacaKeys(): boolean {
  return Boolean(process.env.ALPACA_API_KEY_ID && process.env.ALPACA_API_SECRET_KEY);
}

export function isPaper(): boolean {
  return (process.env.ALPACA_PAPER ?? "true") !== "false";
}

export function liveTradingEnabled(): boolean {
  return process.env.ENABLE_LIVE_TRADING === "true" && !isPaper();
}

function tradingBase(): string {
  return liveTradingEnabled() ? "https://api.alpaca.markets" : "https://paper-api.alpaca.markets";
}

function headers(): Record<string, string> {
  return {
    "APCA-API-KEY-ID": process.env.ALPACA_API_KEY_ID ?? "",
    "APCA-API-SECRET-KEY": process.env.ALPACA_API_SECRET_KEY ?? "",
    "content-type": "application/json",
  };
}

export class AlpacaError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// TTL cache + in-flight dedup (per serverless instance).
const cache = new Map<string, { at: number; ttl: number; data: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

async function get<T>(url: string, ttlMs: number): Promise<T> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.data as T;
  const pending = inflight.get(url);
  if (pending) return pending as Promise<T>;
  const p = (async () => {
    const res = await fetch(url, { headers: headers(), cache: "no-store" });
    if (!res.ok) throw new AlpacaError(res.status, `Alpaca ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as T;
    cache.set(url, { at: Date.now(), ttl: ttlMs, data });
    if (cache.size > 500) {
      for (const [k, v] of cache) if (Date.now() - v.at > v.ttl) cache.delete(k);
    }
    return data;
  })().finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p as Promise<T>;
}

// ── Stock data ──

export interface AlpacaBar { t: string; o: number; h: number; l: number; c: number; v: number; vw: number }

export async function getStockBars(
  symbol: string,
  timeframe: "1Min" | "5Min" | "15Min" | "1Hour" | "1Day",
  startIso: string,
  endIso?: string,
  ttlMs = 20_000
): Promise<AlpacaBar[]> {
  const out: AlpacaBar[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 6; page++) {
    const u = new URL(`${DATA}/v2/stocks/${encodeURIComponent(symbol)}/bars`);
    u.searchParams.set("timeframe", timeframe);
    u.searchParams.set("start", startIso);
    if (endIso) u.searchParams.set("end", endIso);
    u.searchParams.set("limit", "10000");
    u.searchParams.set("feed", "sip");
    u.searchParams.set("adjustment", "split");
    if (pageToken) u.searchParams.set("page_token", pageToken);
    const data = await get<{ bars?: AlpacaBar[]; next_page_token?: string | null }>(u.toString(), ttlMs);
    out.push(...(data.bars ?? []));
    if (!data.next_page_token) break;
    pageToken = data.next_page_token;
  }
  return out;
}

export interface StockSnapshot {
  latestTrade?: { p: number; t: string };
  latestQuote?: { bp: number; ap: number; t: string };
  dailyBar?: AlpacaBar;
  prevDailyBar?: AlpacaBar;
  minuteBar?: AlpacaBar;
}

export async function getStockSnapshots(symbols: string[], ttlMs = 3_000): Promise<Record<string, StockSnapshot>> {
  if (!symbols.length) return {};
  const out: Record<string, StockSnapshot> = {};
  for (let i = 0; i < symbols.length; i += 100) {
    const chunk = symbols.slice(i, i + 100);
    const u = `${DATA}/v2/stocks/snapshots?symbols=${chunk.map(encodeURIComponent).join(",")}&feed=sip`;
    Object.assign(out, await get<Record<string, StockSnapshot>>(u, ttlMs));
  }
  return out;
}

// ── Options data (OPRA) ──

export interface OptionSnapshot {
  latestQuote?: { bp: number; ap: number; bs: number; as: number; t: string };
  latestTrade?: { p: number; s: number; t: string };
  dailyBar?: { o: number; h: number; l: number; c: number; v: number };
  greeks?: { delta: number; gamma: number; theta: number; vega: number; rho?: number };
  impliedVolatility?: number;
}

export interface OptionChainParams {
  type?: "call" | "put";
  strikeGte?: number;
  strikeLte?: number;
  expirationDate?: string;
  expirationLte?: string;
  expirationGte?: string;
  maxPages?: number;
}

/** Full or filtered chain snapshots for an underlying (paginated). */
export async function getOptionChain(
  underlying: string,
  p: OptionChainParams = {},
  ttlMs = 5_000
): Promise<Record<string, OptionSnapshot>> {
  const out: Record<string, OptionSnapshot> = {};
  let pageToken: string | undefined;
  const maxPages = p.maxPages ?? 5;
  for (let page = 0; page < maxPages; page++) {
    const u = new URL(`${DATA}/v1beta1/options/snapshots/${encodeURIComponent(underlying)}`);
    u.searchParams.set("feed", "opra");
    u.searchParams.set("limit", "1000");
    if (p.type) u.searchParams.set("type", p.type);
    if (p.strikeGte !== undefined) u.searchParams.set("strike_price_gte", String(p.strikeGte));
    if (p.strikeLte !== undefined) u.searchParams.set("strike_price_lte", String(p.strikeLte));
    if (p.expirationDate) u.searchParams.set("expiration_date", p.expirationDate);
    if (p.expirationGte) u.searchParams.set("expiration_date_gte", p.expirationGte);
    if (p.expirationLte) u.searchParams.set("expiration_date_lte", p.expirationLte);
    if (pageToken) u.searchParams.set("page_token", pageToken);
    const data = await get<{ snapshots?: Record<string, OptionSnapshot>; next_page_token?: string | null }>(u.toString(), ttlMs);
    Object.assign(out, data.snapshots ?? {});
    if (!data.next_page_token) break;
    pageToken = data.next_page_token;
  }
  return out;
}

/** Snapshots for specific OCC symbols (positions, selected contract). */
export async function getOptionSnapshots(occSymbols: string[], ttlMs = 2_500): Promise<Record<string, OptionSnapshot>> {
  if (!occSymbols.length) return {};
  const u = `${DATA}/v1beta1/options/snapshots?symbols=${occSymbols.map(encodeURIComponent).join(",")}&feed=opra`;
  const data = await get<{ snapshots?: Record<string, OptionSnapshot> }>(u, ttlMs);
  return data.snapshots ?? {};
}

/** Option expirations available for an underlying (from contracts API). */
export interface OptionContractMeta {
  symbol: string;
  expiration_date: string;
  strike_price: string;
  type: "call" | "put";
  open_interest?: string | null;
  close_price?: string | null;
}

export async function getOptionContracts(
  underlying: string,
  params: { expirationDate?: string; expirationLte?: string; strikeGte?: number; strikeLte?: number; limit?: number } = {},
  ttlMs = 300_000
): Promise<OptionContractMeta[]> {
  const u = new URL(`${tradingBase()}/v2/options/contracts`);
  u.searchParams.set("underlying_symbols", underlying);
  u.searchParams.set("status", "active");
  u.searchParams.set("limit", String(params.limit ?? 1000));
  if (params.expirationDate) u.searchParams.set("expiration_date", params.expirationDate);
  if (params.expirationLte) u.searchParams.set("expiration_date_lte", params.expirationLte);
  if (params.strikeGte !== undefined) u.searchParams.set("strike_price_gte", String(params.strikeGte));
  if (params.strikeLte !== undefined) u.searchParams.set("strike_price_lte", String(params.strikeLte));
  const data = await get<{ option_contracts?: OptionContractMeta[] }>(u.toString(), ttlMs);
  return data.option_contracts ?? [];
}

// ── Trading (paper by default) ──

export interface AlpacaAccount {
  status: string;
  equity: string;
  buying_power: string;
  options_buying_power?: string;
  options_trading_level?: number;
  cash: string;
}

export async function getAccount(): Promise<AlpacaAccount> {
  return get<AlpacaAccount>(`${tradingBase()}/v2/account`, 5_000);
}

export interface AlpacaClock { is_open: boolean; next_open: string; next_close: string; timestamp: string }

export async function getClock(): Promise<AlpacaClock> {
  return get<AlpacaClock>(`${tradingBase()}/v2/clock`, 30_000);
}

export interface AlpacaPosition {
  symbol: string;
  qty: string;
  side: string;
  avg_entry_price: string;
  current_price?: string;
  market_value?: string;
  unrealized_pl?: string;
  unrealized_plpc?: string;
  asset_class: string;
}

export async function getPositions(): Promise<AlpacaPosition[]> {
  return get<AlpacaPosition[]>(`${tradingBase()}/v2/positions`, 3_000);
}

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  symbol: string;
  qty: string;
  filled_qty: string;
  side: string;
  type: string;
  status: string;
  limit_price?: string | null;
  filled_avg_price?: string | null;
  submitted_at: string;
}

export async function getOrders(status: "open" | "closed" | "all" = "all", limit = 50): Promise<AlpacaOrder[]> {
  return get<AlpacaOrder[]>(`${tradingBase()}/v2/orders?status=${status}&limit=${limit}&direction=desc`, 3_000);
}

export interface SubmitOrderInput {
  symbol: string; // OCC option symbol or equity ticker
  qty: number;
  side: "buy" | "sell";
  type: "market" | "limit";
  limitPrice?: number;
  clientOrderId: string;
}

export async function submitOrder(o: SubmitOrderInput): Promise<AlpacaOrder> {
  // Paper unless every live guard is explicitly satisfied.
  if (!isPaper() && !liveTradingEnabled()) {
    throw new AlpacaError(403, "Live trading is not enabled (ENABLE_LIVE_TRADING must be true).");
  }
  if (!/^[A-Z]{1,6}(\d{6}[CP]\d{8})?$/.test(o.symbol)) {
    throw new AlpacaError(400, "Invalid symbol.");
  }
  if (!Number.isInteger(o.qty) || o.qty < 1 || o.qty > 100) {
    throw new AlpacaError(400, "Quantity must be an integer between 1 and 100.");
  }
  if (o.type === "limit" && !(o.limitPrice && o.limitPrice > 0)) {
    throw new AlpacaError(400, "Limit orders need a positive limit price.");
  }
  const res = await fetch(`${tradingBase()}/v2/orders`, {
    method: "POST",
    headers: headers(),
    cache: "no-store",
    body: JSON.stringify({
      symbol: o.symbol,
      qty: String(o.qty),
      side: o.side,
      type: o.type,
      time_in_force: "day",
      ...(o.type === "limit" ? { limit_price: String(o.limitPrice) } : {}),
      client_order_id: o.clientOrderId.slice(0, 48),
    }),
  });
  if (!res.ok) throw new AlpacaError(res.status, `Order rejected: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as AlpacaOrder;
}

export async function cancelOrder(orderId: string): Promise<void> {
  if (!/^[a-f0-9-]{10,64}$/i.test(orderId)) throw new AlpacaError(400, "Invalid order id.");
  const res = await fetch(`${tradingBase()}/v2/orders/${orderId}`, {
    method: "DELETE",
    headers: headers(),
    cache: "no-store",
  });
  if (!res.ok && res.status !== 204) {
    throw new AlpacaError(res.status, `Cancel failed: ${(await res.text()).slice(0, 200)}`);
  }
}
