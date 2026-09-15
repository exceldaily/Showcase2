// IO for symbol news: fetch the three feeds (at most once per ten
// minutes per symbol), store the headlines, and read them back.

import { hasDatabase, query, queryOne } from "./db";
import { buildNews, feedUrls, parseFeed, type FeedItem, type NewsItem } from "./newsFeeds";

const UA = "AlphaForge/1.0 (+https://www.thisistemporary.us)";
const REFRESH_MS = 10 * 60_000;
const inflight = new Map<string, Promise<RefreshResult>>();
const lastLocal = new Map<string, number>();

export interface RefreshResult { ok: boolean; sourcesOk: number; items: number; note: string | null }

async function fetchFeed(url: string): Promise<FeedItem[] | null> {
  try {
    // EDGAR is the slow one (5s is normal); give it room without holding the others.
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5" }, cache: "no-store", signal: AbortSignal.timeout(/sec\.gov/.test(url) ? 14_000 : 8_000) });
    if (!r.ok) return null;
    return parseFeed(await r.text());
  } catch {
    return null;
  }
}

async function companyName(symbol: string): Promise<string | null> {
  if (!hasDatabase()) return null;
  const row = await queryOne<{ n: string | null }>("select company_name as n from tickers where symbol = $1", [symbol]).catch(() => null);
  return row?.n ?? null;
}

/** Fetches and stores news for a symbol unless refreshed within ten minutes. `force` bypasses the throttle. */
export async function refreshSymbolNews(symbol: string, force = false): Promise<RefreshResult> {
  if (!hasDatabase()) return { ok: false, sourcesOk: 0, items: 0, note: "no database" };
  const running = inflight.get(symbol);
  if (running) return running;
  const local = lastLocal.get(symbol) ?? 0;
  if (!force && Date.now() - local < REFRESH_MS) return { ok: true, sourcesOk: 0, items: 0, note: "fresh" };
  const p = (async () => {
    if (!force) {
      const meta = await queryOne<{ refreshed_at: string }>("select refreshed_at::text from symbol_news_refresh where symbol = $1", [symbol]).catch(() => null);
      if (meta && Date.now() - Date.parse(meta.refreshed_at) < REFRESH_MS) { lastLocal.set(symbol, Date.parse(meta.refreshed_at)); return { ok: true, sourcesOk: 0, items: 0, note: "fresh" }; }
    }
    const name = await companyName(symbol);
    const feeds = feedUrls(symbol, name);
    const results = await Promise.all(feeds.map(async (f) => ({ source: f.source, items: await fetchFeed(f.url) })));
    const okFeeds = results.filter((r) => r.items !== null);
    const news = buildNews(symbol, okFeeds.map((r) => ({ source: r.source, items: r.items as FeedItem[] })), 7, Date.now(), name).slice(0, 60);
    if (news.length) {
      // One round trip: unnest the columns instead of a query per headline.
      await query(
        `insert into symbol_news (symbol, url, title, source, publisher, tier, tags, direct, published_at, fetched_at)
         select $1, u, t, s, p, ti, string_to_array(tg, ','), d, pa, now() from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::text[], $8::boolean[], $9::timestamptz[]) as x(u, t, s, p, ti, tg, d, pa)
         on conflict (symbol, url) do update set title = excluded.title, publisher = excluded.publisher, tier = excluded.tier, tags = excluded.tags, direct = excluded.direct, published_at = coalesce(excluded.published_at, symbol_news.published_at)`,
        [symbol, news.map((n) => n.url), news.map((n) => n.title.slice(0, 300)), news.map((n) => n.source), news.map((n) => n.publisher), news.map((n) => n.tier), news.map((n) => n.tags.join(",")), news.map((n) => n.direct), news.map((n) => n.publishedAt)]
      ).catch(() => undefined);
    }
    const failed = results.filter((r) => r.items === null).map((r) => r.source);
    const note = failed.length ? `${failed.join(", ")} feed unavailable` : null;
    await query(
      "insert into symbol_news_refresh (symbol, refreshed_at, ok, sources_ok, note) values ($1, now(), $2, $3, $4) on conflict (symbol) do update set refreshed_at = now(), ok = excluded.ok, sources_ok = excluded.sources_ok, note = excluded.note",
      [symbol, okFeeds.length > 0, okFeeds.length, note]
    ).catch(() => undefined);
    // Keep the table bounded: a month of headlines per symbol is plenty.
    await query("delete from symbol_news where symbol = $1 and fetched_at < now() - interval '30 days'", [symbol]).catch(() => undefined);
    lastLocal.set(symbol, Date.now());
    return { ok: okFeeds.length > 0, sourcesOk: okFeeds.length, items: news.length, note };
  })();
  inflight.set(symbol, p);
  try { return await p; } finally { inflight.delete(symbol); }
}

export interface StoredNews extends NewsItem { fetchedAt: string }

export async function getSymbolNews(symbol: string, limit = 25): Promise<{ items: StoredNews[]; refreshedAt: string | null; sourcesOk: number | null; note: string | null }> {
  if (!hasDatabase()) return { items: [], refreshedAt: null, sourcesOk: null, note: "no database" };
  const [rows, meta] = await Promise.all([
    query<{ symbol: string; url: string; title: string; source: NewsItem["source"]; publisher: string | null; tier: number; tags: string; direct: boolean; published_at: string | null; fetched_at: string }>(
      "select symbol, url, title, source, publisher, tier, array_to_string(tags, ',') as tags, direct, published_at::text, fetched_at::text from symbol_news where symbol = $1 order by direct desc, published_at desc nulls last, fetched_at desc limit $2", [symbol, limit]
    ).catch(() => []),
    queryOne<{ refreshed_at: string; sources_ok: number; note: string | null }>("select refreshed_at::text, sources_ok, note from symbol_news_refresh where symbol = $1", [symbol]).catch(() => null),
  ]);
  return {
    items: rows.map((r) => ({ symbol: r.symbol, url: r.url, title: r.title, source: r.source, publisher: r.publisher, tier: r.tier as 1 | 2 | 3 | 4, tags: r.tags ? r.tags.split(",").filter(Boolean) : [], direct: r.direct, publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null, fetchedAt: new Date(r.fetched_at).toISOString() })),
    refreshedAt: meta ? new Date(meta.refreshed_at).toISOString() : null,
    sourcesOk: meta?.sources_ok ?? null,
    note: meta?.note ?? null,
  };
}

/** Best recent headline for the catalyst score: newest tier 1 or 2 within 3 days, else newest of any tier within 24 hours. */
export async function latestCatalyst(symbol: string): Promise<{ headline: string; publisher: string | null; tier: number; publishedAt: string | null; url: string | null; measured: boolean } | null> {
  if (!hasDatabase()) return null;
  const meta = await queryOne<{ refreshed_at: string }>("select refreshed_at::text from symbol_news_refresh where symbol = $1", [symbol]).catch(() => null);
  if (!meta) return null;
  const row = await queryOne<{ title: string; publisher: string | null; tier: number; published_at: string | null; url: string }>(
    `select title, publisher, tier, published_at::text, url from symbol_news
     where symbol = $1 and direct and published_at is not null and published_at > now() - interval '3 days'
     order by (case when tier <= 2 then 0 else 1 end), published_at desc limit 1`, [symbol]
  ).catch(() => null);
  if (!row) return { headline: "", publisher: null, tier: 4, publishedAt: null, url: null, measured: true };
  return { headline: row.title, publisher: row.publisher, tier: row.tier, publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null, url: row.url, measured: true };
}
