// ─────────────────────────────────────────────────────────
// MarketDataProvider — the vendor boundary (spec §36).
//
// Everything in the terminal talks to THIS interface, never to a
// vendor SDK directly. Swapping Polygon for Alpaca (or adding a
// real-time feed alongside the EOD feed) means implementing this
// interface, not rewriting the app.
//
// Capability flags are first-class: the UI reads them to decide
// whether a panel renders data or an honest "DATA UNAVAILABLE —
// requires real-time feed" state (spec §51). We never fabricate.
// ─────────────────────────────────────────────────────────

export type Timeframe =
  | "10s" | "15s" | "30s"
  | "1m" | "2m" | "3m" | "5m" | "10m" | "15m" | "30m"
  | "1h" | "4h"
  | "1d" | "1w";

/** Freshness of a value, surfaced in the UI next to every number. */
export type DataQuality = "realtime" | "delayed15" | "eod" | "cached" | "unavailable";

export interface DataStamp {
  quality: DataQuality;
  /** ISO timestamp of the underlying observation (not fetch time). */
  asOf: string | null;
  source: string;
}

export interface OHLCV {
  t: number; // epoch ms of bar open
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vw?: number;
}

export interface Quote {
  symbol: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  stamp: DataStamp;
}

export interface TickerDetails {
  symbol: string;
  name: string | null;
  exchange: string | null;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  sharesOutstanding: number | null;
  /** Free float. Null on providers that do not supply it — never guessed. */
  floatShares: number | null;
  stamp: DataStamp;
}

export interface NewsItem {
  headline: string;
  publisher: string;
  publishedAt: string;
  url: string;
  tickers: string[];
  providerSentiment?: string;
}

/** What a given provider can actually do. Drives UI gating. */
export interface ProviderCapabilities {
  name: string;
  /** Bar intervals the provider can serve. */
  timeframes: Timeframe[];
  intraday: boolean;
  quotes: boolean;          // bid/ask/spread
  streaming: boolean;       // websocket push
  premarket: boolean;       // extended-hours bars
  halts: boolean;
  floatData: boolean;
  news: boolean;
  /** Baseline freshness for this provider's price data. */
  quality: DataQuality;
}

export interface MarketDataProvider {
  capabilities: ProviderCapabilities;

  /** Historical/most-recent bars. Returns null when unsupported. */
  getBars(symbol: string, timeframe: Timeframe, limit?: number): Promise<OHLCV[] | null>;

  /** Latest quote. Null when the provider has no quote entitlement. */
  getQuote(symbol: string): Promise<Quote | null>;

  /** Reference/company data. Null fields where the vendor lacks them. */
  getTickerDetails(symbol: string): Promise<TickerDetails | null>;

  getNews(symbol: string, limit?: number): Promise<NewsItem[]>;

  /** Whole-market snapshot for one session; powers universe scans. */
  getGroupedDaily(date: string): Promise<Map<string, OHLCV> | null>;

  /** Streaming hooks — no-ops on providers without entitlement. */
  subscribeTrades?(symbols: string[], onTrade: (symbol: string, price: number, size: number, ts: number) => void): () => void;
  subscribeQuotes?(symbols: string[], onQuote: (q: Quote) => void): () => void;
}

/** Helper for panels: is this feature usable right now? */
export function requires(
  cap: ProviderCapabilities,
  feature: keyof Pick<ProviderCapabilities, "intraday" | "quotes" | "streaming" | "premarket" | "halts" | "floatData">
): { available: boolean; reason: string } {
  if (cap[feature]) return { available: true, reason: "" };
  const labels: Record<string, string> = {
    intraday: "intraday minute bars",
    quotes: "real-time quotes (bid/ask)",
    streaming: "a streaming WebSocket feed",
    premarket: "extended-hours data",
    halts: "halt status data",
    floatData: "float / shares-outstanding reference data",
  };
  return {
    available: false,
    reason: `DATA UNAVAILABLE — requires ${labels[feature]}. Current feed: ${cap.name} (${cap.quality}).`,
  };
}
