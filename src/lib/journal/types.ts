// Journal shapes shared by the API, the workspace and the journal page.

export type TradeStatus = "open" | "closed" | "skipped";
export type Outcome = "WORKED" | "FAILED" | "UNRESOLVED";

export const REVIEW_TAGS = [
  "FOLLOWED PLAN", "EARLY ENTRY", "LATE ENTRY", "IGNORED STOP", "MOVED STOP", "EXITED EARLY", "OVERTRADED", "GOOD EXECUTION", "BAD EXECUTION",
] as const;
export type ReviewTag = (typeof REVIEW_TAGS)[number];

export const SKIP_REASONS = [
  "Waiting for confirmation", "Risk limit", "Choppy", "Poor risk/reward", "Wide spread", "Event window", "No room", "Gut feeling", "Not at screen",
] as const;

export interface TradeSnapshot {
  price: number | null;
  lifecycle: string;
  verdict: string;
  bias: string;
  setup: string;
  confluence: { pct: number; parts: { name: string; score: number; max: number; measured: boolean }[] } | null;
  matrix: { tf: string; trend: string; momentum: string; vwap: string }[];
  align: { score: number; conflict: boolean } | null;
  rvol: number | null;
  vwap: number | null;
  marketState: string | null;
  contract: { symbol: string; strike: number; side: "call" | "put"; expiry: string; dte: number; mid: number; delta: number | null; score: number; tag: string | null } | null;
  slot: string;
}

export interface TradeRecord {
  id: string;
  status: TradeStatus;
  symbol: string;
  direction: "long" | "short";
  side: "call" | "put" | null;
  contract: string | null;
  strike: number | null;
  expiry: string | null;
  entryPremium: number | null;
  qty: number;
  entryAt: string;
  exitPremium: number | null;
  exitAt: string | null;
  pnl: number | null;
  riskDollars: number | null;
  mae: number | null;
  mfe: number | null;
  setup: string | null;
  lifecycle: string | null;
  marketState: string | null;
  confidence: number | null;
  trigger: number | null;
  invalidation: number | null;
  targets: number[] | null;
  snapshot: TradeSnapshot | null;
  strikeTag: string | null;
  aligned: boolean | null;
  skippedReason: string | null;
  outcome: Outcome | null;
  reviewTags: string[];
  notes: string | null;
}
