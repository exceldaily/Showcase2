// ─────────────────────────────────────────────────────────
// Scanner cron endpoint — called by Vercel Cron every 15 min (market hours).
// Protected by CRON_SECRET. Gracefully reports "not configured" until the
// Polygon key and Neon DATABASE_URL are present, so deploying early is safe.
// ─────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { hasDatabase } from "@/lib/db";
import { hasPolygonKey } from "@/lib/polygon";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Auth: require the cron secret if one is configured.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const ready = hasPolygonKey() && hasDatabase();
  if (!ready) {
    return NextResponse.json({
      status: "skipped",
      reason: "Scanner not yet configured — add POLYGON_API_KEY and DATABASE_URL.",
      needs: {
        polygon: hasPolygonKey(),
        database: hasDatabase(),
      },
    });
  }

  // TODO(phase1): implement the scan pipeline:
  //   1. gate on market regime
  //   2. universe filter (price > 5, vol > 1M, relVol > 1.5)
  //   3. sector filter (> 70)
  //   4. catalyst check (news + filings → Claude classification)
  //   5. technical scan (setup type detection)
  //   6. smart money scoring
  //   7. setup generation (entry/stop/targets, R/R >= 3)
  //   8. AlphaForge scoring + gate (>= 80)
  //   9. upsert into trade_setups + fire alerts
  return NextResponse.json({
    status: "ok",
    scannedAt: new Date().toISOString(),
    message: "Scan pipeline wiring lands in Phase 1 Week 2.",
  });
}
