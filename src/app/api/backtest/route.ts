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
  const barsMap = await loadBars([...universe.map((u) => u.symbol), "SPY", "QQQ"], 400);
  const isIpo = new Map(universe.map((u) => [u.symbol, u.is_ipo_36mo]));

  // ?sweep=0.25,1,1.5,2 compares stop widths without persisting.
  const url = new URL(request.url);
  const sweepParam = url.searchParams.get("sweep");
  if (sweepParam) {
    const mults = sweepParam
      .split(",")
      .map((s) => parseFloat(s))
      .filter((n) => n > 0 && n <= 5)
      .slice(0, 6);
    const runs = mults.map((mult) => {
      const r = runBacktestOnBars(barsMap, isIpo, { stopAtrMult: mult });
      return {
        stopAtrMult: mult,
        totalSignals: r.totalSignals,
        buckets: r.buckets.map((b) => ({
          setup: `${b.setupType} ${b.direction}`,
          signals: b.signals,
          winRate: b.winRate,
          avgR: b.avgR,
          profitFactor: b.profitFactor,
        })),
      };
    });
    return NextResponse.json({ status: "ok", mode: "sweep", runs });
  }

  const report = runBacktestOnBars(barsMap, isIpo);
  await persistBacktest(report);

  return NextResponse.json({ status: "ok", ...report });
}
