// ─────────────────────────────────────────────────────────
// Options bot rules (pure, unit-tested).
//
// The bot only ever BUYS calls or puts and later SELLS what it bought.
// A long option cannot lose more than the premium paid, so capping the
// premium caps the loss. Every entry is a LIMIT order, and the budget is
// charged at the limit price before the order is sent, so a fill can
// never cost more than what was reserved.
//
//   available = budget - reserved (open orders at their limit)
//                      - cost of open positions
//                      - realized losses since the budget was set
//
// Realized gains do not raise the budget unless "reinvest gains" is on.
// The bot decides WHEN from the setup quality engine's call; these rules
// decide WHETHER the money allows it and when a position has to go.
// ─────────────────────────────────────────────────────────

export type BotMode = "off" | "dry-run" | "trade";

export interface BotSettings {
  mode: BotMode;
  /** Total dollars the bot may have at risk. */
  budget: number;
  /** Most premium for one trade. */
  perTrade: number;
  maxOpen: number;
  maxTradesPerDay: number;
  /** Stop opening trades for the day once today's realized loss reaches this. */
  dailyLossLimit: number;
  maxContracts: number;
  calls: boolean;
  puts: boolean;
  symbols: string[];
  /** Lowest setup score the bot will act on. */
  minScore: number;
  /** Only contracts expiring within this many calendar days (0 = same day only). */
  maxDte: number;
  maxSpreadPct: number;
  /** How far above the quoted ask a buy limit may reach, and below the bid a sell limit. */
  slippagePct: number;
  takeProfitPct: number;
  stopLossPct: number;
  /** No new entries at or after this minute of the ET day. */
  noEntryAfter: number;
  /** Everything is sold at this minute of the ET day. */
  flattenAt: number;
  maxHoldMinutes: number;
  reinvestGains: boolean;
  /** Losses before this moment no longer count against the budget (set when the budget is reset). */
  budgetSince: string | null;
}

export const DEFAULT_BOT: BotSettings = {
  mode: "off", budget: 500, perTrade: 150, maxOpen: 2, maxTradesPerDay: 3, dailyLossLimit: 200, maxContracts: 3,
  calls: true, puts: true, symbols: ["SPY", "QQQ", "NVDA", "TSLA", "AAPL", "AMD", "META", "MSFT"],
  minScore: 60, maxDte: 1, maxSpreadPct: 8, slippagePct: 3, takeProfitPct: 40, stopLossPct: 35,
  noEntryAfter: 15 * 60, flattenAt: 15 * 60 + 45, maxHoldMinutes: 120, reinvestGains: false, budgetSince: null,
};

const num = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};

/** Clamp anything a form can send into a safe, complete settings object. */
export function sanitizeSettings(raw: Partial<Record<keyof BotSettings, unknown>>, prev: BotSettings = DEFAULT_BOT): BotSettings {
  const mode: BotMode = raw.mode === "trade" || raw.mode === "dry-run" || raw.mode === "off" ? raw.mode : prev.mode;
  const budget = Math.round(num(raw.budget, 0, 1_000_000, prev.budget));
  const symbols = Array.isArray(raw.symbols)
    ? Array.from(new Set(raw.symbols.map((s) => String(s).toUpperCase().trim()).filter((s) => /^[A-Z.]{1,6}$/.test(s) && s !== "SPX" && s !== "SPXW"))).slice(0, 12)
    : prev.symbols;
  const flattenAt = Math.round(num(raw.flattenAt, 10 * 60, 15 * 60 + 55, prev.flattenAt));
  return {
    mode, budget,
    perTrade: Math.round(Math.min(budget, num(raw.perTrade, 0, 1_000_000, prev.perTrade))),
    maxOpen: Math.round(num(raw.maxOpen, 1, 10, prev.maxOpen)),
    maxTradesPerDay: Math.round(num(raw.maxTradesPerDay, 1, 30, prev.maxTradesPerDay)),
    dailyLossLimit: Math.round(Math.min(budget, num(raw.dailyLossLimit, 0, 1_000_000, prev.dailyLossLimit))),
    maxContracts: Math.round(num(raw.maxContracts, 1, 50, prev.maxContracts)),
    calls: typeof raw.calls === "boolean" ? raw.calls : prev.calls,
    puts: typeof raw.puts === "boolean" ? raw.puts : prev.puts,
    symbols,
    minScore: Math.round(num(raw.minScore, 50, 100, prev.minScore)),
    maxDte: Math.round(num(raw.maxDte, 0, 14, prev.maxDte)),
    maxSpreadPct: num(raw.maxSpreadPct, 1, 25, prev.maxSpreadPct),
    slippagePct: num(raw.slippagePct, 0, 10, prev.slippagePct),
    takeProfitPct: num(raw.takeProfitPct, 5, 500, prev.takeProfitPct),
    stopLossPct: num(raw.stopLossPct, 5, 95, prev.stopLossPct),
    noEntryAfter: Math.min(flattenAt - 5, Math.round(num(raw.noEntryAfter, 9 * 60 + 45, 15 * 60 + 50, prev.noEntryAfter))),
    flattenAt,
    maxHoldMinutes: Math.round(num(raw.maxHoldMinutes, 5, 390, prev.maxHoldMinutes)),
    reinvestGains: typeof raw.reinvestGains === "boolean" ? raw.reinvestGains : prev.reinvestGains,
    budgetSince: typeof raw.budgetSince === "string" && !Number.isNaN(Date.parse(raw.budgetSince)) ? raw.budgetSince : prev.budgetSince,
  };
}

export type TradeStatus = "PENDING_ENTRY" | "OPEN" | "PENDING_EXIT" | "CLOSED" | "CANCELED" | "REJECTED";

/** The money facts of one bot trade. */
export interface TradeMoney {
  status: TradeStatus;
  /** Dollars reserved when the buy was sent: limit x 100 x contracts. */
  reserved: number;
  /** Dollars actually paid for contracts still held. */
  cost: number;
  /** Realized profit or loss so far, dollars. */
  pnl: number;
  /** ET date the trade was opened. */
  day: string;
  openedAt: string;
}

export interface BudgetState {
  budget: number;
  /** Reserved by buy orders that have not filled yet. */
  reserved: number;
  /** Paid for positions still open. */
  inPositions: number;
  /** Net realized result since the budget was set. */
  realized: number;
  /** What a new trade may spend. Never negative. */
  available: number;
  /** Today's realized result. */
  todayRealized: number;
  todayTrades: number;
  openCount: number;
}

export function budgetState(s: BotSettings, trades: TradeMoney[], today: string): BudgetState {
  const since = s.budgetSince ? Date.parse(s.budgetSince) : 0;
  const counted = trades.filter((t) => Date.parse(t.openedAt) >= since);
  const reserved = counted.filter((t) => t.status === "PENDING_ENTRY").reduce((a, t) => a + t.reserved, 0);
  const inPositions = counted.filter((t) => t.status === "OPEN" || t.status === "PENDING_EXIT").reduce((a, t) => a + t.cost, 0);
  const realized = counted.reduce((a, t) => a + t.pnl, 0);
  const cushion = s.reinvestGains ? realized : Math.min(0, realized);
  const todays = trades.filter((t) => t.day === today && t.status !== "CANCELED" && t.status !== "REJECTED");
  return {
    budget: s.budget, reserved, inPositions, realized,
    available: Math.max(0, Math.floor((s.budget + cushion - reserved - inPositions) * 100) / 100),
    todayRealized: todays.reduce((a, t) => a + t.pnl, 0),
    todayTrades: todays.length,
    openCount: trades.filter((t) => t.status === "PENDING_ENTRY" || t.status === "OPEN" || t.status === "PENDING_EXIT").length,
  };
}

/** Option price tick: $0.01 under $3, $0.05 at $3 and above. */
export function tick(price: number, dir: "up" | "down"): number {
  const t = price >= 3 ? 0.05 : 0.01;
  const n = dir === "up" ? Math.ceil(price / t - 1e-9) : Math.floor(price / t + 1e-9);
  return Math.max(0.01, Math.round(n * t * 100) / 100);
}

/** Reasons the bot may not open anything right now, before looking at any symbol. Empty means clear. */
export function entryBlocks(s: BotSettings, b: BudgetState, minutes: number, marketOpen: boolean): string[] {
  const out: string[] = [];
  if (s.mode === "off") out.push("bot is off");
  if (!marketOpen) out.push("market is closed");
  if (minutes < 9 * 60 + 45) out.push("before 9:45 ET");
  if (minutes >= s.noEntryAfter) out.push("past the last entry time");
  if (!s.calls && !s.puts) out.push("calls and puts are both switched off");
  if (b.openCount >= s.maxOpen) out.push(`${b.openCount} of ${s.maxOpen} positions already open`);
  if (b.todayTrades >= s.maxTradesPerDay) out.push(`daily trade limit reached (${s.maxTradesPerDay})`);
  if (s.dailyLossLimit > 0 && b.todayRealized <= -s.dailyLossLimit) out.push(`daily loss limit reached ($${Math.abs(b.todayRealized).toFixed(0)})`);
  if (b.available < 1) out.push("budget is used up");
  return out;
}

export interface Candidate {
  symbol: string;
  call: string;
  setupScore: number | null;
  side: "call" | "put";
  contract: { symbol: string; ask: number; bid: number; spreadPct: number | null; dte: number; openInterest: number; volume: number } | null;
}

export interface EntryPlan {
  ok: boolean;
  reason: string;
  qty: number;
  /** Buy limit per share of premium. */
  limit: number;
  /** Dollars reserved: the most this order can cost. */
  reserve: number;
}

const no = (reason: string): EntryPlan => ({ ok: false, reason, qty: 0, limit: 0, reserve: 0 });

/** Whether one symbol qualifies, and exactly what to buy within the money rules. */
export function planEntry(s: BotSettings, b: BudgetState, c: Candidate): EntryPlan {
  if (c.call !== "CALL" && c.call !== "PUT") return no(`engine says ${c.call}`);
  if (c.side === "call" && !s.calls) return no("calls are switched off");
  if (c.side === "put" && !s.puts) return no("puts are switched off");
  if (c.setupScore === null || c.setupScore < s.minScore) return no(`setup score ${c.setupScore ?? "n/a"} is under ${s.minScore}`);
  const k = c.contract;
  if (!k) return no("no contract within the rules");
  if (!(k.ask > 0) || !(k.bid > 0)) return no("no two-sided quote");
  if (k.dte > s.maxDte + 0.999) return no(`nearest contract expires in ${Math.ceil(k.dte)} days`);
  if (k.spreadPct !== null && k.spreadPct > s.maxSpreadPct) return no(`spread ${k.spreadPct.toFixed(1)}% is wider than ${s.maxSpreadPct}%`);
  if (k.openInterest < 100 && k.volume < 50) return no("contract is too thin");
  const limit = tick(k.ask * (1 + s.slippagePct / 100), "up");
  const spend = Math.min(s.perTrade, b.available);
  const qty = Math.min(s.maxContracts, Math.floor(spend / (limit * 100) + 1e-9));
  if (qty < 1) return no(`one contract costs $${(limit * 100).toFixed(0)}, more than the $${spend.toFixed(0)} this trade may spend`);
  return { ok: true, reason: "within budget", qty, limit, reserve: Math.round(qty * limit * 100 * 100) / 100 };
}

export interface OpenPosition {
  side: "call" | "put";
  entryFill: number;
  openedAtMs: number;
  /** Underlying levels from the plan at entry. */
  target: number | null;
  invalidation: number | null;
}

export interface ExitCall { exit: boolean; reason: string; urgent: boolean }

/**
 * Whether an open position has to go. Underlying levels come first (the
 * stock price is real time on every data plan); the option's own price is
 * the backstop. `urgent` exits use a market order.
 */
export function exitDecision(s: BotSettings, p: OpenPosition, m: { minutes: number; nowMs: number; underlying: number | null; optionPrice: number | null }): ExitCall {
  if (m.minutes >= s.flattenAt) return { exit: true, reason: "end of day: everything is sold before the close", urgent: true };
  const long = p.side === "call";
  if (m.underlying !== null) {
    if (p.invalidation !== null && (long ? m.underlying <= p.invalidation : m.underlying >= p.invalidation)) return { exit: true, reason: `stock hit the wrong line ($${p.invalidation.toFixed(2)})`, urgent: false };
    if (p.target !== null && (long ? m.underlying >= p.target : m.underlying <= p.target)) return { exit: true, reason: `stock reached target 1 ($${p.target.toFixed(2)})`, urgent: false };
  }
  if (m.optionPrice !== null && p.entryFill > 0) {
    const ch = ((m.optionPrice - p.entryFill) / p.entryFill) * 100;
    if (ch <= -s.stopLossPct) return { exit: true, reason: `option is down ${Math.abs(ch).toFixed(0)}% (stop ${s.stopLossPct}%)`, urgent: false };
    if (ch >= s.takeProfitPct) return { exit: true, reason: `option is up ${ch.toFixed(0)}% (take profit ${s.takeProfitPct}%)`, urgent: false };
  }
  if (m.nowMs - p.openedAtMs >= s.maxHoldMinutes * 60_000) return { exit: true, reason: `held ${s.maxHoldMinutes} minutes without resolving`, urgent: false };
  return { exit: false, reason: "holding", urgent: false };
}

/** Sell limit for a normal exit: a little under the bid so it fills, never under a cent. */
export function exitLimit(s: BotSettings, bid: number | null, lastKnown: number): number {
  const ref = bid !== null && bid > 0 ? bid : lastKnown;
  return tick(Math.max(0.01, ref * (1 - s.slippagePct / 100)), "down");
}
