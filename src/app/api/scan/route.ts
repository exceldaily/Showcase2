// ─────────────────────────────────────────────────────────
// Scanner endpoint. Vercel Cron hits this once daily (Hobby limit);
// it can also be triggered manually with the CRON_SECRET.
// Runs the full live pipeline: bars refresh -> regime -> sectors ->
// setup detection -> scoring -> persist to Neon.
// ─────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { loadBars } from "@/lib/bars";
import { hasDatabase, query } from "@/lib/db";
import { openPositionsFromActiveSetups, processOpenPositions } from "@/lib/paper";
import { hasPolygonKey } from "@/lib/polygon";
import { runScan } from "@/lib/scanner";

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

  if (!hasPolygonKey() || !hasDatabase()) {
    return NextResponse.json({
      status: "skipped",
      reason: "Scanner not yet configured — add POLYGON_API_KEY and DATABASE_URL.",
      needs: { polygon: hasPolygonKey(), database: hasDatabase() },
    });
  }

  try {
    const result = await runScan();

    // Paper engine: advance existing positions on today's bar first
    // (yesterday's Watching entries can fill today), THEN open new
    // Watching positions from the fresh setup batch (they can only
    // fill starting next session — same rule as the backtester).
    const openSymbols = await query<{ symbol: string }>(
      `select distinct symbol from paper_trades where status in ('Watching','Active')`
    );
    const paperBars = await loadBars(openSymbols.map((r) => r.symbol), 2);
    const progressed = await processOpenPositions(paperBars);
    const opened = await openPositionsFromActiveSetups();

    return NextResponse.json({ status: "ok", ...result, paper: { ...progressed, opened } });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "scan failed" },
      { status: 500 }
    );
  }
}
