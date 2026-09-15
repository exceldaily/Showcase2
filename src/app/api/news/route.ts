// Per-ticker headlines from publishers' feeds. Refreshes at most every
// ten minutes per symbol; the first call for a symbol waits for the
// fetch, later calls read the stored headlines.
import { NextResponse } from "next/server";
import { getSymbolNews, refreshSymbolNews } from "@/lib/newsFeedsLive";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol")?.toUpperCase().replace(/[^A-Z.]/g, "").slice(0, 6) ?? "";
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });
  const force = url.searchParams.get("refresh") === "1";
  const stored = await getSymbolNews(symbol);
  if (force || stored.refreshedAt === null) await refreshSymbolNews(symbol, force);
  else void refreshSymbolNews(symbol).catch(() => undefined);
  const fresh = force || stored.refreshedAt === null ? await getSymbolNews(symbol) : stored;
  return NextResponse.json({ symbol, ...fresh, sources: ["Yahoo Finance RSS", "Google News RSS", "SEC EDGAR filings"] }, { headers: { "Cache-Control": "no-store" } });
}
