// Health + configuration endpoint. Reports env presence (never values),
// database reachability, bar-cache freshness, and last scan time.
import { NextResponse } from "next/server";
import { checkEnv, missingRequired } from "@/lib/env";
import { hasDatabase, query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const env = checkEnv().map((c) => ({ name: c.name, present: c.present, purpose: c.purpose }));
  const missing = missingRequired();

  let db: { reachable: boolean; latestBarDate?: string; activeSetups?: number; lastScan?: string } = {
    reachable: false,
  };
  if (hasDatabase()) {
    try {
      const [bars, setups, scan] = await Promise.all([
        query<{ d: string }>("select max(date)::text as d from daily_bars"),
        query<{ n: string }>("select count(*)::int as n from trade_setups where is_active"),
        query<{ t: string }>("select max(ts)::text as t from market_regime_log"),
      ]);
      db = {
        reachable: true,
        latestBarDate: bars[0]?.d ?? undefined,
        activeSetups: Number(setups[0]?.n ?? 0),
        lastScan: scan[0]?.t ?? undefined,
      };
    } catch {
      db = { reachable: false };
    }
  }

  return NextResponse.json({
    status: missing.length === 0 && db.reachable ? "healthy" : "degraded",
    missingRequired: missing,
    env,
    db,
    checkedAt: new Date().toISOString(),
  });
}
