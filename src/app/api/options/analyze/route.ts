// Options terminal analysis endpoint. Site-gated by middleware; the
// Alpaca keys never leave the server. `at` (ISO) activates replay
// mode: the identical pipeline evaluated at a past moment.

import { NextResponse } from "next/server";
import { buildOptionsAnalysis } from "@/lib/optionsTerminal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
  if (!/^[A-Z.]{1,6}$/.test(symbol)) {
    return NextResponse.json({ error: "invalid symbol" }, { status: 400 });
  }
  const profile = url.searchParams.get("profile") ?? undefined;
  const at = url.searchParams.get("at");
  let replayCutoffMs: number | undefined;
  if (at) {
    const t = Date.parse(at);
    if (!Number.isFinite(t) || t > Date.now()) {
      return NextResponse.json({ error: "invalid replay time" }, { status: 400 });
    }
    replayCutoffMs = t;
  }
  try {
    const analysis = await buildOptionsAnalysis(symbol, { profile, replayCutoffMs });
    return NextResponse.json(analysis);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "analysis failed";
    return NextResponse.json({ error: msg.replace(/APCA[^\s]*/g, "") }, { status: 502 });
  }
}
