// ─────────────────────────────────────────────────────────
// Polygon implementation of MarketDataProvider.
//
// Capabilities are derived from POLYGON_PLAN so the terminal tells
// the truth about what it can show. Set POLYGON_PLAN=starter after
// upgrading to unlock intraday panels; realtime enables streaming.
// ─────────────────────────────────────────────────────────

import { fetchJson } from "./http";
import type {
  DataQuality,
  MarketDataProvider,
  NewsItem,
  OHLCV,
  ProviderCapabilities,
  Quote,
  TickerDetails,
  Timeframe,
} from "./marketData";

const BASE = "https://api.polygon.io";

type Plan = "free" | "starter" | "realtime";

function plan(): Plan {
  const p = (process.env.POLYGON_PLAN ?? "free").toLowerCase();
  return p === "starter" || p === "realtime" ? p : "free";
}

const TF_MAP: Record<Timeframe, { mult: number; span: string } | null> = {
  "10s": { mult: 10, span: "second" },
  "15s": { mult: 15, span: "second" },
  "30s": { mult: 30, span: "second" },
  "1m": { mult: 1, span: "minute" },
  "2m": { mult: 2, span: "minute" },
  "3m": { mult: 3, span: "minute" },
  "5m": { mult: 5, span: "minute" },
  "10m": { mult: 10, span: "minute" },
  "15m": { mult: 15, span: "minute" },
  "30m": { mult: 30, span: "minute" },
  "1h": { mult: 1, span: "hour" },
  "4h": { mult: 4, span: "hour" },
  "1d": { mult: 1, span: "day" },
  "1w": { mult: 1, span: "week" },
};

export function polygonCapabilities(): ProviderCapabilities {
  const p = plan();
  const intraday = p !== "free";
  const quality: DataQuality = p === "realtime" ? "realtime" : p === "starter" ? "delayed15" : "eod";
  return {
    name: `Polygon.io (${p})`,
    timeframes: intraday
      ? (Object.keys(TF_MAP) as Timeframe[])
      : (["1d", "1w"] as Timeframe[]),
    intraday,
    quotes: p === "realtime",
    streaming: p === "realtime",
    premarket: intraday,
    halts: p === "realtime",
    floatData: false, // Polygon reference lacks true free float
    news: true,
    quality,
  };
}

async function poly<T>(path: string, params: Record<string, string> = {}, revalidate = 60): Promise<T | null> {
  const key = process.env.POLYGON_API_KEY;
  if (!key) return null;
  const url = new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set("apiKey", key);
  const res = await fetchJson<T>(url.toString(), {
    source: "Polygon.io",
    revalidateSeconds: revalidate,
    timeoutMs: 9000,
    retries: 2,
  });
  return res.ok ? res.data : null;
}

export const polygonProvider: MarketDataProvider = {
  capabilities: polygonCapabilities(),

  async getBars(symbol, timeframe, limit = 300) {
    const caps = polygonCapabilities();
    if (!caps.timeframes.includes(timeframe)) return null; // honest: unsupported on this plan
    const tf = TF_MAP[timeframe];
    if (!tf) return null;

    const end = new Date();
    // Window sized so `limit` bars are plausibly covered.
    const daysBack = tf.span === "day" ? limit * 1.6 : tf.span === "week" ? limit * 9 : 10;
    const start = new Date(Date.now() - daysBack * 86400e3);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const data = await poly<{ results?: OHLCV[] }>(
      `/v2/aggs/ticker/${symbol}/range/${tf.mult}/${tf.span}/${fmt(start)}/${fmt(end)}`,
      { adjusted: "true", sort: "asc", limit: String(Math.min(limit * 2, 5000)) }
    );
    return data?.results ?? null;
  },

  async getQuote(symbol) {
    const caps = polygonCapabilities();
    if (!caps.quotes) return null; // no entitlement — caller shows DATA UNAVAILABLE
    const data = await poly<{ results?: { P?: number; p?: number; S?: number } }>(
      `/v2/last/nbbo/${symbol}`,
      {},
      0
    );
    if (!data?.results) return null;
    return {
      symbol,
      bid: data.results.p ?? null,
      ask: data.results.P ?? null,
      last: null,
      stamp: { quality: caps.quality, asOf: new Date().toISOString(), source: caps.name },
    } satisfies Quote;
  },

  async getTickerDetails(symbol) {
    const caps = polygonCapabilities();
    const data = await poly<{
      results?: {
        name?: string;
        primary_exchange?: string;
        sic_description?: string;
        market_cap?: number;
        share_class_shares_outstanding?: number;
        weighted_shares_outstanding?: number;
      };
    }>(`/v3/reference/tickers/${symbol}`, {}, 86400);
    if (!data?.results) return null;
    const r = data.results;
    return {
      symbol,
      name: r.name ?? null,
      exchange: r.primary_exchange ?? null,
      sector: null, // Polygon gives SIC description, mapped to sector separately
      industry: r.sic_description ?? null,
      marketCap: r.market_cap ?? null,
      sharesOutstanding: r.weighted_shares_outstanding ?? r.share_class_shares_outstanding ?? null,
      floatShares: null, // never guessed
      stamp: { quality: "cached", asOf: new Date().toISOString(), source: caps.name },
    } satisfies TickerDetails;
  },

  async getNews(symbol, limit = 10) {
    const data = await poly<{
      results?: {
        title: string;
        publisher?: { name?: string };
        published_utc: string;
        article_url: string;
        tickers?: string[];
        insights?: { ticker: string; sentiment?: string }[];
      }[];
    }>(`/v2/reference/news`, { ticker: symbol, limit: String(limit), order: "desc", sort: "published_utc" }, 900);
    return (data?.results ?? []).map((r) => ({
      headline: r.title,
      publisher: r.publisher?.name ?? "Unknown",
      publishedAt: r.published_utc,
      url: r.article_url,
      tickers: r.tickers ?? [symbol],
      providerSentiment: r.insights?.find((i) => i.ticker === symbol)?.sentiment,
    })) satisfies NewsItem[];
  },

  async getGroupedDaily(date) {
    const data = await poly<{ results?: ({ T: string } & OHLCV)[] }>(
      `/v2/aggs/grouped/locale/us/market/stocks/${date}`,
      { adjusted: "true" },
      300
    );
    if (!data?.results) return null;
    const map = new Map<string, OHLCV>();
    for (const b of data.results) map.set(b.T, b);
    return map;
  },
};

export function getProvider(): MarketDataProvider {
  return polygonProvider;
}
