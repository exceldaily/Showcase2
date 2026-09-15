import { NextResponse } from "next/server";
import { buildMarketSnapshot } from "@/lib/marketStateLive";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snap = await buildMarketSnapshot();
    return NextResponse.json(snap, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "market state unavailable" }, { status: 503 });
  }
}
