// Health + configuration endpoint. Reports env presence (never values),
// database reachability, bar-cache freshness, and last scan time.
// Public callers get only { status }. Full detail requires the
// CRON_SECRET bearer or the site gate cookie (page fetches).
import { NextResponse } from "next/server";
import { checkEnv, missingRequired } from "@/lib/env";
import { hasDatabase, query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const env = checkEnv().map((c) => ({ name: c.name, present: c.present, purpose: c.purpose }));
  const missing = missingRequired();

  const secret = process.env.CRON_SECRET;
  const authorized =
    !secret || request.headers.get("authorization") === `Bearer ${secret}`;

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

  const status = missing.length === 0 && db.reachable ? "healthy" : "degraded";
  if (!authorized) {
    // Public shape: enough for uptime monitors, nothing operational.
    return NextResponse.json({ status, checkedAt: new Date().toISOString() });
  }
  return NextResponse.json({
    status,
    missingRequired: missing,
    env,
    db,
    checkedAt: new Date().toISOString(),
  });
}
