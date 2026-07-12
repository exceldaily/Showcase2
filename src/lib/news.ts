// ─────────────────────────────────────────────────────────
// Polygon news (included in the free tier).
// Context only for now: news is displayed with source-quality tiers
// and links but does NOT feed the score until the Phase 2 catalyst
// engine classifies it. Never invented; only what the API returns.
// ─────────────────────────────────────────────────────────

import { fetchJson } from "@/providers/http";

export interface NewsItem {
  headline: string;
  publisher: string;
  publishedAt: string;
  url: string;
  tier: 1 | 2 | 3 | 4;
  tierLabel: string;
  sentiment?: string; // Polygon-provided insight when present, never generated
}

interface PolygonNewsResponse {
  results?: {
    title: string;
    publisher?: { name?: string };
    published_utc: string;
    article_url: string;
    insights?: { ticker: string; sentiment?: string }[];
  }[];
}

const TIER2 = [
  "reuters", "associated press", "bloomberg", "cnbc", "marketwatch", "barron",
  "wall street journal", "dow jones", "investor's business daily", "financial times",
  "globenewswire", "business wire", "pr newswire", "benzinga",
];
const TIER3 = [
  "motley fool", "seeking alpha", "zacks", "investorplace", "simply wall st",
  "tipranks", "stocktwits", "invezz", "247wallst", "gurufocus",
];

function classifyPublisher(name: string): { tier: 1 | 2 | 3 | 4; label: string } {
  const n = name.toLowerCase();
  if (n.includes("sec.gov") || n.includes("federal reserve")) return { tier: 1, label: "Primary source" };
  if (TIER2.some((t) => n.includes(t))) return { tier: 2, label: "Established publisher" };
  if (TIER3.some((t) => n.includes(t))) return { tier: 3, label: "Secondary analysis" };
  return { tier: 3, label: "Secondary analysis" };
}

export async function getTickerNews(symbol: string, limit = 6): Promise<NewsItem[]> {
  const key = process.env.POLYGON_API_KEY;
  if (!key) return [];
  // Crypto pairs rarely have ticker-tagged news on this endpoint.
  const url = `https://api.polygon.io/v2/reference/news?ticker=${encodeURIComponent(symbol)}&limit=${limit}&order=desc&sort=published_utc&apiKey=${key}`;
  const res = await fetchJson<PolygonNewsResponse>(url, {
    source: "Polygon.io News",
    revalidateSeconds: 900, // 15 minutes
    timeoutMs: 8_000,
    retries: 1,
  });
  if (!res.ok || !res.data?.results) return [];

  return res.data.results.map((r) => {
    const publisher = r.publisher?.name ?? "Unknown publisher";
    const cls = classifyPublisher(publisher);
    const insight = r.insights?.find((i) => i.ticker === symbol);
    return {
      headline: r.title,
      publisher,
      publishedAt: r.published_utc,
      url: r.article_url,
      tier: cls.tier,
      tierLabel: cls.label,
      sentiment: insight?.sentiment,
    };
  });
}
