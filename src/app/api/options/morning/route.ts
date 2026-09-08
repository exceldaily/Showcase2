// Morning watch. GET returns today's list (locked if frozen, else live,
// cached 5 minutes; ?refresh=1 recomputes). POST locks + emails it:
// owner session or Bearer CRON_SECRET.
import { NextResponse } from "next/server";
import { getMorningWatch, lockMorningWatch } from "@/lib/morningWatch";
import { getCurrentUser } from "@/lib/auth/users";
import { authEnabled } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const u = new URL(request.url);
  const topN = Math.min(3, Math.max(1, Number(u.searchParams.get("n") ?? 2) || 2));
  const refresh = u.searchParams.get("refresh") === "1";
  try {
    return NextResponse.json(await getMorningWatch({ topN, refresh }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "morning watch failed" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const cron = !!secret && request.headers.get("authorization") === `Bearer ${secret}`;
  if (!cron && authEnabled()) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "sign in required" }, { status: 401 });
    if (user.role !== "owner") return NextResponse.json({ error: "owner only" }, { status: 403 });
  }
  try {
    return NextResponse.json(await lockMorningWatch(2));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "lock failed" }, { status: 502 });
  }
}
