// Runs the historical backtest over cached bars and stores the stats.
// Protected by CRON_SECRET (same bearer as /api/scan).
import { NextResponse } from "next/server";
import { loadBars } from "@/lib/bars";
import { hasDatabase, query } from "@/lib/db";
import { persistBacktest, runBacktestOnBars } from "@/lib/backtest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  if (!hasDatabase()) {
    return NextResponse.json({ status: "skipped", reason: "DATABASE_URL missing" });
  }

  const universe = await query<{ symbol: string; is_ipo_36mo: boolean }>(
    "select symbol, is_ipo_36mo from tickers"
  );
  const barsMap = await loadBars(universe.map((u) => u.symbol), 400);
  const isIpo = new Map(universe.map((u) => [u.symbol, u.is_ipo_36mo]));

  const report = runBacktestOnBars(barsMap, isIpo);
  await persistBacktest(report);

  return NextResponse.json({ status: "ok", ...report });
}
