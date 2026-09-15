// ─────────────────────────────────────────────────────────
// Journal statistics (pure, unit-tested). Every number is arithmetic
// over recorded trades; nothing is modelled. R uses the risk the trade
// planned at entry (premium minus the estimated value at invalidation,
// or the full premium when that was not known).
// ─────────────────────────────────────────────────────────

import type { TradeRecord } from "./types";

export interface Bucket {
  key: string;
  trades: number;
  wins: number;
  winRate: number | null;
  pnl: number;
  avgR: number | null;
}

export interface JournalStats {
  closed: number;
  open: number;
  skipped: number;
  winRate: number | null;
  avgR: number | null;
  profitFactor: number | null;
  avgWinner: number | null;
  avgLoser: number | null;
  totalPnl: number;
  bestSetup: Bucket | null;
  worstSetup: Bucket | null;
  bestTicker: Bucket | null;
  worstTicker: Bucket | null;
  bestHour: Bucket | null;
  worstHour: Bucket | null;
  byWeekday: Bucket[];
  byMarketState: Bucket[];
  byConfidence: Bucket[];
  bySetup: Bucket[];
  byExpiry: Bucket[];
  byStrikeTag: Bucket[];
  byAlignment: Bucket[];
  byHour: Bucket[];
  byTicker: Bucket[];
  behaviour: { tag: string; count: number; pnl: number }[];
  skippedOutcomes: { worked: number; failed: number; unresolved: number; wouldHaveWorkedRate: number | null };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function rMultiple(t: TradeRecord): number | null {
  if (t.pnl === null) return null;
  const risk = t.riskDollars !== null && t.riskDollars > 0 ? t.riskDollars : t.entryPremium !== null ? t.entryPremium * 100 * t.qty : null;
  return risk && risk > 0 ? r2(t.pnl / risk) : null;
}

function bucketize(trades: TradeRecord[], keyOf: (t: TradeRecord) => string | null): Bucket[] {
  const map = new Map<string, TradeRecord[]>();
  for (const t of trades) {
    const k = keyOf(t);
    if (k === null) continue;
    map.set(k, [...(map.get(k) ?? []), t]);
  }
  return Array.from(map, ([key, list]) => {
    const wins = list.filter((t) => (t.pnl ?? 0) > 0).length;
    const rs = list.map(rMultiple).filter((x): x is number => x !== null);
    return { key, trades: list.length, wins, winRate: list.length ? r2((wins / list.length) * 100) : null, pnl: r2(list.reduce((a, t) => a + (t.pnl ?? 0), 0)), avgR: rs.length ? r2(rs.reduce((a, b) => a + b, 0) / rs.length) : null };
  }).sort((a, b) => b.pnl - a.pnl);
}

const etHour = (iso: string) => Number(new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }));
const etWeekday = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" });

export function journalStats(all: TradeRecord[]): JournalStats {
  const closed = all.filter((t) => t.status === "closed" && t.pnl !== null);
  const open = all.filter((t) => t.status === "open").length;
  const skippedList = all.filter((t) => t.status === "skipped");
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0);
  const losses = closed.filter((t) => (t.pnl ?? 0) < 0);
  const grossWin = wins.reduce((a, t) => a + (t.pnl ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + (t.pnl ?? 0), 0));
  const rs = closed.map(rMultiple).filter((x): x is number => x !== null);
  const minTrades = (b: Bucket[]) => b.filter((x) => x.trades >= 2);
  const bySetup = bucketize(closed, (t) => t.setup);
  const byTicker = bucketize(closed, (t) => t.symbol);
  const byHour = bucketize(closed, (t) => `${etHour(t.entryAt)}:00`);
  const pick = (b: Bucket[], best: boolean) => { const m = minTrades(b); if (!m.length) return null; return best ? m[0] : m[m.length - 1]; };
  const tags = new Map<string, { count: number; pnl: number }>();
  for (const t of closed) for (const tag of t.reviewTags) tags.set(tag, { count: (tags.get(tag)?.count ?? 0) + 1, pnl: r2((tags.get(tag)?.pnl ?? 0) + (t.pnl ?? 0)) });
  const worked = skippedList.filter((t) => t.outcome === "WORKED").length;
  const failed = skippedList.filter((t) => t.outcome === "FAILED").length;
  return {
    closed: closed.length, open, skipped: skippedList.length,
    winRate: closed.length ? r2((wins.length / closed.length) * 100) : null,
    avgR: rs.length ? r2(rs.reduce((a, b) => a + b, 0) / rs.length) : null,
    profitFactor: grossLoss > 0 ? r2(grossWin / grossLoss) : grossWin > 0 ? Infinity : null,
    avgWinner: wins.length ? r2(grossWin / wins.length) : null,
    avgLoser: losses.length ? r2(-grossLoss / losses.length) : null,
    totalPnl: r2(closed.reduce((a, t) => a + (t.pnl ?? 0), 0)),
    bestSetup: pick(bySetup, true), worstSetup: pick(bySetup, false),
    bestTicker: pick(byTicker, true), worstTicker: pick(byTicker, false),
    bestHour: pick(byHour, true), worstHour: pick(byHour, false),
    byWeekday: bucketize(closed, (t) => etWeekday(t.entryAt)),
    byMarketState: bucketize(closed, (t) => t.marketState),
    byConfidence: bucketize(closed, (t) => (t.confidence === null ? null : t.confidence >= 70 ? "70%+" : t.confidence >= 50 ? "50-69%" : "<50%")),
    bySetup, byExpiry: bucketize(closed, (t) => (t.expiry && t.entryAt ? (t.expiry === t.entryAt.slice(0, 10) ? "0DTE" : "later expiry") : null)),
    byStrikeTag: bucketize(closed, (t) => t.strikeTag ?? "untagged"),
    byAlignment: bucketize(closed, (t) => (t.aligned === null ? null : t.aligned ? "timeframes aligned" : "conflict")),
    byHour, byTicker,
    behaviour: Array.from(tags, ([tag, v]) => ({ tag, ...v })).sort((a, b) => b.count - a.count),
    skippedOutcomes: { worked, failed, unresolved: skippedList.length - worked - failed, wouldHaveWorkedRate: worked + failed > 0 ? r2((worked / (worked + failed)) * 100) : null },
  };
}

/**
 * Did a skipped setup work? From the skip time forward, the first of
 * target 1 or the invalidation to trade decides; neither means unresolved.
 */
export function skippedOutcome(t: Pick<TradeRecord, "direction" | "trigger" | "invalidation" | "targets" | "entryAt">, bars: { t: number; h: number; l: number }[]): "WORKED" | "FAILED" | "UNRESOLVED" {
  const t1 = t.targets?.[0];
  if (t1 === undefined || t.invalidation === null) return "UNRESOLVED";
  const from = Date.parse(t.entryAt);
  for (const b of bars) {
    if (b.t < from) continue;
    const hitT1 = t.direction === "long" ? b.h >= t1 : b.l <= t1;
    const hitInv = t.direction === "long" ? b.l <= t.invalidation : b.h >= t.invalidation;
    if (hitT1 && !hitInv) return "WORKED";
    if (hitInv) return "FAILED";
  }
  return "UNRESOLVED";
}
