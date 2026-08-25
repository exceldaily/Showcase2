// ─────────────────────────────────────────────────────────
// Catalyst sweep: checks the free Polygon news feed for the day's
// top movers and caches the result in catalyst_news, so the
// "Has Catalyst" checklist criterion is a real Found/None.
//
// The free tier allows 5 calls/minute, so each invocation checks a
// few symbols (default 4) and an external scheduler (cron-job.org)
// calls this every minute for half an hour after the daily scan.
//
// Auth: Bearer CRON_SECRET bypasses all throttles. UNAUTHENTICATED
// calls are also allowed -- deliberately, so the external scheduler
// never needs the secret -- but they are cheap, idempotent, and
// hard-throttled (45s cooldown + daily cap) so an outsider hammering
// the URL cannot drain the market-data quota.
// ─────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { hasDatabase, query } from "@/lib/db";
import { getTickerNews } from "@/lib/news";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!hasDatabase()) {
    return NextResponse.json({ error: "no database" }, { status: 503 });
  }
  const secret = process.env.CRON_SECRET;
  const authed = !!secret && request.headers.get("authorization") === `Bearer ${secret}`;

  if (!authed) {
    const [gate] = await query<{ recent: number; today: number }>(
      `select
         count(*) filter (where checked_at > now() - interval '45 seconds')::int as recent,
         count(*) filter (where checked_at > date_trunc('day', now()))::int as today
       from catalyst_news`
    );
    if (gate && gate.recent > 0) {
      return NextResponse.json({ throttled: true, reason: "cooldown" }, { status: 429 });
    }
    if (gate && gate.today >= 300) {
      return NextResponse.json({ throttled: true, reason: "daily cap" }, { status: 429 });
    }
  }

  const url = new URL(request.url);
  const requested = parseInt(url.searchParams.get("limit") ?? "4", 10) || 4;
  const limit = Math.min(Math.max(requested, 1), authed ? 5 : 4);

  // Today's biggest liquid movers that have not been checked recently.
  // Movers first because a big move without news is itself the answer
  // the checklist wants ("None"), and movers WITH news are the targets.
  const candidates = await query<{ symbol: string }>(
    `with latest as (select max(date) as d from market_daily),
     today as (
       select m.symbol, m.close, m.volume,
         (select p.close from market_daily p
           where p.symbol = m.symbol and p.date < m.date
           order by p.date desc limit 1) as prev_close
       from market_daily m, latest
       where m.date = latest.d and m.close >= 1 and m.close * m.volume >= 2000000
     )
     select t.symbol
     from today t
     left join catalyst_news c on c.symbol = t.symbol
     where t.prev_close > 0
       and (t.close - t.prev_close) / t.prev_close >= 0.05
       and (c.symbol is null or c.checked_at < now() - interval '20 hours')
     order by (t.close - t.prev_close) / t.prev_close desc
     limit $1`,
    [limit]
  );

  const checked: { symbol: string; status: string }[] = [];
  for (const { symbol } of candidates) {
    const items = await getTickerNews(symbol, 3);
    const latest = items[0];
    await query(
      `insert into catalyst_news (symbol, checked_at, headline, publisher, tier, article_url, published_at)
       values ($1, now(), $2, $3, $4, $5, $6)
       on conflict (symbol) do update set
         checked_at = now(), headline = excluded.headline,
         publisher = excluded.publisher, tier = excluded.tier,
         article_url = excluded.article_url, published_at = excluded.published_at`,
      [
        symbol,
        latest?.headline ?? null,
        latest?.publisher ?? null,
        latest?.tier ?? null,
        latest?.url ?? null,
        latest?.publishedAt ?? null,
      ]
    );
    checked.push({ symbol, status: latest ? "news found" : "no news" });
  }

  const { rows: [totals] } = { rows: await query<{ n: string }>(`select count(*)::text as n from catalyst_news`) };
  return NextResponse.json({
    checked,
    remainingCandidatesHint: candidates.length === limit,
    totalCached: Number(totals?.n ?? 0),
  });
}
