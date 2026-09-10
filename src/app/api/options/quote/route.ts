// Lightweight quote for the 2-second price feed: one snapshot call,
// cached 1s server-side. Returns the latest print, bid/ask, and the
// current minute bar so the client can move the live candle.
import { NextResponse } from "next/server";
import { getStockSnapshots, hasAlpacaKeys } from "@/providers/alpaca";
import { etStamp, sessionOf } from "@/lib/intraday";
import { INDEX_ALIASES } from "@/lib/optionsTerminal";
import { getIndexRatio, resolveIndex } from "@/lib/indexMode";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const raw = (new URL(request.url).searchParams.get("symbol") ?? "").toUpperCase();
  if (!/^[A-Z.]{1,6}$/.test(raw)) return NextResponse.json({ error: "symbol required" }, { status: 400 });
  if (!hasAlpacaKeys()) return NextResponse.json({ error: "Alpaca not configured" }, { status: 503 });
  const index = resolveIndex(raw);
  const symbol = index ? index.proxy : INDEX_ALIASES[raw]?.etf ?? raw;
  try {
    const snaps = await getStockSnapshots([symbol], 1_000);
    const s = snaps[symbol];
    if (!s) return NextResponse.json({ error: "no quote" }, { status: 404 });
    const now = Date.now();
    const ratio = index ? (await getIndexRatio(index)).ratio : 1;
    const sc = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n * ratio * 100) / 100);
    // Alpaca's dailyBar stays on the last completed session until today's
    // bar exists, so the reference close is whichever bar is not today.
    const dailyIsToday = s.dailyBar ? etStamp(Date.parse(s.dailyBar.t)).date === etStamp(now).date : false;
    const refClose = dailyIsToday ? (s.prevDailyBar?.c ?? null) : (s.dailyBar?.c ?? s.prevDailyBar?.c ?? null);
    return NextResponse.json({
      symbol: raw,
      price: sc(s.latestTrade?.p ?? s.minuteBar?.c ?? null),
      tradeTs: s.latestTrade?.t ? Date.parse(s.latestTrade.t) : null,
      bid: sc(s.latestQuote?.bp ?? null),
      ask: sc(s.latestQuote?.ap ?? null),
      quoteTs: s.latestQuote?.t ? Date.parse(s.latestQuote.t) : null,
      prevClose: sc(refClose),
      dailyClose: dailyIsToday ? sc(s.dailyBar?.c ?? null) : null,
      session: sessionOf(now),
      asOf: now,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "quote failed" }, { status: 502 });
  }
}
