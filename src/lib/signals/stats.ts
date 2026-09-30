// ─────────────────────────────────────────────────────────
// Signal analytics (pure, unit-tested). Every number here is counted
// from logged signals and their resolved outcomes. Nothing is a
// forecast, and a bucket with few signals says so instead of showing a
// confident percentage.
// ─────────────────────────────────────────────────────────

import type { SignalFeatures } from "../quality/assemble";

export type Model = "old" | "new";
export type Source = "live" | "replay";
export type SignalStatus = "OPEN" | "ENTRY" | "NO ENTRY" | "FAILED BREAKOUT" | "NEVER TRIGGERED";
export type SignalOutcome = "WIN" | "LOSS" | "BREAKEVEN";

export interface SignalRow {
  symbol: string;
  day: string;
  model: Model;
  source: Source;
  direction: "long" | "short";
  trigger: number;
  status: SignalStatus;
  blockedBy: string | null;
  firedAt: string | null;
  price: number | null;
  features: SignalFeatures | null;
  outcome: SignalOutcome | null;
  r: number | null;
  maeR: number | null;
  mfeR: number | null;
  rr: number | null;
  falseBreak: boolean | null;
}

export interface Bucket {
  name: string;
  n: number;
  wins: number;
  losses: number;
  breakeven: number;
  /** Percent of resolved signals that won, null when none resolved. */
  winRate: number | null;
  avgR: number | null;
  totalR: number | null;
  avgMae: number | null;
  avgMfe: number | null;
  falseBreakRate: number | null;
  /** Fewer than MIN_SAMPLE resolved signals: too few to read anything into. */
  small: boolean;
}

export const MIN_SAMPLE = 20;
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function summarize(name: string, rows: SignalRow[]): Bucket {
  const done = rows.filter((r) => r.outcome !== null && r.r !== null);
  const n = done.length;
  const sum = (f: (r: SignalRow) => number | null) => done.reduce((a, r) => a + (f(r) ?? 0), 0);
  const wins = done.filter((r) => r.outcome === "WIN").length;
  const losses = done.filter((r) => r.outcome === "LOSS").length;
  return {
    name, n, wins, losses, breakeven: n - wins - losses,
    winRate: n ? Math.round((wins / n) * 100) : null,
    avgR: n ? round(sum((r) => r.r) / n) : null,
    totalR: n ? round(sum((r) => r.r), 1) : null,
    avgMae: n ? round(sum((r) => r.maeR) / n) : null,
    avgMfe: n ? round(sum((r) => r.mfeR) / n) : null,
    falseBreakRate: n ? Math.round((done.filter((r) => r.falseBreak).length / n) * 100) : null,
    small: n < MIN_SAMPLE,
  };
}

const withStructure = (r: SignalRow) => (r.direction === "long" ? ["HH/HL", "BREAKOUT"] : ["LH/LL", "BREAKDOWN"]).includes(r.features?.structure5 ?? "");
const againstStructure = (r: SignalRow) => (r.direction === "long" ? ["LH/LL", "BREAKDOWN"] : ["HH/HL", "BREAKOUT"]).includes(r.features?.structure5 ?? "");
const f = (r: SignalRow) => r.features;

export interface Condition { key: string; group: string; name: string; test: (r: SignalRow) => boolean }

/** The slices shown on the analytics screen. Each is a plain, checkable statement about the moment of the signal. */
export const CONDITIONS: Condition[] = [
  { key: "rvol-hi", group: "Volume", name: "Breakout with RVOL 1.5x or more", test: (r) => (f(r)?.rvol ?? -1) >= 1.5 },
  { key: "rvol-mid", group: "Volume", name: "Breakout with RVOL 1.0x to 1.5x", test: (r) => (f(r)?.rvol ?? -1) >= 1 && (f(r)?.rvol ?? 9) < 1.5 },
  { key: "rvol-low", group: "Volume", name: "Breakout with RVOL under 0.7x", test: (r) => f(r)?.rvol != null && (f(r)?.rvol as number) < 0.7 },
  { key: "barvol", group: "Volume", name: "Break bar traded 1.3x its usual volume", test: (r) => (f(r)?.breakVolX ?? -1) >= 1.3 },
  { key: "barvol-thin", group: "Volume", name: "Break bar under its usual volume", test: (r) => f(r)?.breakVolX != null && (f(r)?.breakVolX as number) < 1 },
  { key: "vwap-hl", group: "Structure", name: "On the right side of VWAP with structure behind it", test: (r) => f(r)?.vwapSide === "with" && withStructure(r) },
  { key: "struct-with", group: "Structure", name: "5m structure with the trade", test: withStructure },
  { key: "struct-against", group: "Structure", name: "5m structure against the trade", test: againstStructure },
  { key: "struct-range", group: "Structure", name: "5m structure is a range", test: (r) => f(r)?.structure5 === "RANGE" },
  { key: "mkt-with", group: "Market", name: "With SPY and QQQ", test: (r) => f(r)?.spyWith === true && f(r)?.qqqWith !== false },
  { key: "mkt-against", group: "Market", name: "Against SPY direction", test: (r) => f(r)?.spyWith === false },
  { key: "sector-with", group: "Market", name: "Sector fund with the trade", test: (r) => f(r)?.sectorWith === true },
  { key: "tf-all", group: "Timeframes", name: "4 or more timeframes agree", test: (r) => (f(r)?.tfWith ?? 0) >= 4 },
  { key: "tf-split", group: "Timeframes", name: "2 or more timeframes against", test: (r) => (f(r)?.tfAgainst ?? 0) >= 2 },
  { key: "q-strong", group: "Setup score", name: "Setup score Strong (70+)", test: (r) => (f(r)?.quality ?? -1) >= 70 },
  { key: "q-mod", group: "Setup score", name: "Setup score Moderate (50 to 69)", test: (r) => (f(r)?.quality ?? -1) >= 50 && (f(r)?.quality ?? 999) < 70 },
  { key: "q-weak", group: "Setup score", name: "Setup score Weak (under 50)", test: (r) => f(r)?.quality != null && (f(r)?.quality as number) < 50 },
  { key: "chop-hi", group: "Chop", name: "Chop score 50 or more", test: (r) => (f(r)?.chopScore ?? -1) >= 50 },
  { key: "chop-lo", group: "Chop", name: "Chop score under 25", test: (r) => f(r) != null && (f(r)?.chopScore ?? 999) < 25 },
  { key: "t-open", group: "Time of day", name: "Before 10:30 ET", test: (r) => f(r) != null && (f(r)?.minutes as number) < 630 },
  { key: "t-mid", group: "Time of day", name: "10:30 to 14:00 ET", test: (r) => f(r) != null && (f(r)?.minutes as number) >= 630 && (f(r)?.minutes as number) < 840 },
  { key: "t-late", group: "Time of day", name: "After 14:00 ET", test: (r) => f(r) != null && (f(r)?.minutes as number) >= 840 },
  { key: "via-retest", group: "Entry", name: "Confirmed by a retest that held", test: (r) => f(r)?.via === "retest" },
  { key: "via-follow", group: "Entry", name: "Confirmed by a follow-through candle", test: (r) => f(r)?.via === "follow-through" },
  { key: "room-good", group: "Location", name: "Room to the next level GOOD or OPEN", test: (r) => f(r)?.roomGrade === "GOOD" || f(r)?.roomGrade === "OPEN" },
  { key: "room-tight", group: "Location", name: "Room to the next level TIGHT or POOR", test: (r) => f(r)?.roomGrade === "TIGHT" || f(r)?.roomGrade === "POOR" },
  { key: "pre", group: "Session", name: "Premarket", test: (r) => f(r)?.session === "premarket" },
];

export function conditionTable(entries: SignalRow[]): (Bucket & { key: string; group: string })[] {
  return CONDITIONS.map((c) => ({ ...summarize(c.name, entries.filter(c.test)), key: c.key, group: c.group }));
}

export interface ModelSummary {
  model: Model;
  setups: number;
  status: Record<Exclude<SignalStatus, "OPEN">, number>;
  open: number;
  entries: Bucket;
  /** Confirmed breaks the model declined, scored as if entered at the confirmation. */
  blocked: Bucket;
  sessions: number;
  entriesPerSession: number | null;
}

export function modelSummary(model: Model, rows: SignalRow[]): ModelSummary {
  const m = rows.filter((r) => r.model === model);
  const count = (s: SignalStatus) => m.filter((r) => r.status === s).length;
  const sessions = new Set(m.map((r) => r.day)).size;
  const entries = m.filter((r) => r.status === "ENTRY");
  return {
    model, setups: m.length,
    status: { ENTRY: count("ENTRY"), "NO ENTRY": count("NO ENTRY"), "FAILED BREAKOUT": count("FAILED BREAKOUT"), "NEVER TRIGGERED": count("NEVER TRIGGERED") },
    open: count("OPEN"),
    entries: summarize("Entries", entries),
    blocked: summarize("Held back", m.filter((r) => r.status === "NO ENTRY")),
    sessions,
    entriesPerSession: sessions ? round(entries.length / sessions, 1) : null,
  };
}

/** Why the new model held confirmed breaks back, with what entering anyway would have done. */
export function blockedTable(rows: SignalRow[]): Bucket[] {
  const groups = new Map<string, SignalRow[]>();
  for (const r of rows.filter((x) => x.model === "new" && x.status === "NO ENTRY")) {
    const key = (r.blockedBy ?? "held back").split(":")[0].trim();
    const why = r.blockedBy ?? "";
    const detail = /chase/i.test(key) ? (/target 1 already reached/i.test(why) ? "DO NOT CHASE: target 1 already reached" : /of the way to target 1/i.test(why) ? "DO NOT CHASE: most of the move to target 1 gone" : "DO NOT CHASE: price ran too far past the level")
      : /chop/i.test(why) ? "NO TRADE: chop" : /weak/i.test(why) ? "WAIT: weak setup score" : /market/i.test(why) ? "WAIT: market against"
      : /retest in progress/i.test(why) ? "WAIT: slipped back to the level" : /9:45|premarket/i.test(why) ? "WAIT: too early in the session" : key;
    const a = groups.get(detail) ?? [];
    a.push(r);
    groups.set(detail, a);
  }
  return [...groups.entries()].map(([k, v]) => summarize(k, v)).sort((a, b) => b.n - a.n);
}

export function bySymbol(entries: SignalRow[]): Bucket[] {
  const groups = new Map<string, SignalRow[]>();
  for (const r of entries) { const a = groups.get(r.symbol) ?? []; a.push(r); groups.set(r.symbol, a); }
  return [...groups.entries()].map(([k, v]) => summarize(k, v)).sort((a, b) => b.n - a.n);
}
