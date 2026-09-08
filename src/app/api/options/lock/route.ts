// Owner-only: re-pick today's locked level for a symbol. The next
// analysis refresh chooses a fresh trigger from the current structure.
import { NextResponse } from "next/server";
import { etStamp } from "@/lib/intraday";
import { releaseLock, getLock } from "@/lib/setupLock";
import { requireOwner } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const symbol = (new URL(request.url).searchParams.get("symbol") ?? "").toUpperCase();
  if (!/^[A-Z.]{1,6}$/.test(symbol)) return NextResponse.json({ error: "symbol required" }, { status: 400 });
  return NextResponse.json({ lock: await getLock(symbol, etStamp(Date.now()).date) });
}

export async function DELETE(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  const symbol = (new URL(request.url).searchParams.get("symbol") ?? "").toUpperCase();
  if (!/^[A-Z.]{1,6}$/.test(symbol)) return NextResponse.json({ error: "symbol required" }, { status: 400 });
  await releaseLock(symbol, etStamp(Date.now()).date, `re-picked by ${owner.username}`);
  return NextResponse.json({ ok: true });
}
