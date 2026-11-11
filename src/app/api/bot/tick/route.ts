// One bot pass. Called once a minute by a scheduler with the CRON_SECRET
// bearer, or by the owner's open Bot page. Nobody else can run it: this
// endpoint can place orders.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/users";
import { runBotTick } from "@/lib/bot/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  const byCron = !!secret && request.headers.get("authorization") === `Bearer ${secret}`;
  if (!byCron) {
    const me = await getCurrentUser().catch(() => null);
    if (!me || me.role !== "owner") return NextResponse.json({ error: "owner or scheduler only" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runBotTick(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ran: false, reason: e instanceof Error ? e.message.replace(/APCA[^\s]*/g, "").slice(0, 200) : "tick failed" }, { status: 500 });
  }
}
export const GET = handle;
export const POST = handle;
