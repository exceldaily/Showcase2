// Per-symbol history stats (volume profile + breakout backtest) from
// Alpaca minute history. Cached ~20h; recompute costs a few Alpaca
// bar pages, so the UI calls this once per symbol load in the
// background and the analyze endpoint only READS the cache.

import { NextResponse } from "next/server";
import { computeAndCacheHistory, getCachedHistory } from "@/lib/historyStats";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
  if (!/^[A-Z.]{1,6}$/.test(symbol)) return NextResponse.json({ error: "invalid symbol" }, { status: 400 });
  const force = url.searchParams.get("force") === "1";
  try {
    const cached = force ? null : await getCachedHistory(symbol);
    if (cached) return NextResponse.json({ ...cached, cached: true });
    const fresh = await computeAndCacheHistory(symbol, 40);
    if (!fresh) return NextResponse.json({ error: "not enough history or not configured" }, { status: 404 });
    return NextResponse.json({ ...fresh, cached: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "history failed";
    return NextResponse.json({ error: msg.replace(/APCA[^\s]*/g, "") }, { status: 502 });
  }
}
