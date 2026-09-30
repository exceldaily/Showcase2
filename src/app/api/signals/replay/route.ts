// Owner action: replay recent sessions for one symbol into the signal log.
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/users";
import { replaySymbolSessions } from "@/lib/signals/replayLive";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  const url = new URL(request.url);
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
  if (!/^[A-Z.]{1,6}$/.test(symbol)) return NextResponse.json({ error: "symbol required" }, { status: 400 });
  const sessions = Math.max(1, Math.min(8, Number(url.searchParams.get("sessions") ?? 3) || 3));
  try {
    return NextResponse.json(await replaySymbolSessions(symbol, sessions));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "replay failed";
    return NextResponse.json({ error: msg.replace(/APCA[^\s]*/g, "") }, { status: 502 });
  }
}
