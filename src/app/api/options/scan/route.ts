// Options scanner endpoint: cheap batched first pass over a universe,
// full pipeline on the most active names. Site-gated by middleware.

import { NextResponse } from "next/server";
import { scanOptionsUniverse } from "@/lib/optionsScan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const universe = url.searchParams.get("universe") ?? "megacaps";
  if (!/^[a-z0-9]{1,20}$/.test(universe)) return NextResponse.json({ error: "invalid universe" }, { status: 400 });
  const symbols = (url.searchParams.get("symbols") ?? "").split(",").filter(Boolean);
  const top = Math.min(16, Math.max(4, parseInt(url.searchParams.get("top") ?? "10", 10) || 10));
  const profile = (url.searchParams.get("profile") ?? "BALANCED").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 16);
  try {
    return NextResponse.json(await scanOptionsUniverse(universe, symbols, top, profile));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "scan failed";
    return NextResponse.json({ error: msg.replace(/APCA[^\s]*/g, "") }, { status: 502 });
  }
}
