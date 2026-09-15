// Options trade journal: the signed-in member's own trades and skipped
// setups. Nothing here touches a broker.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/users";
import { createTrade, deleteTrade, listTrades, updateTrade, type NewTrade, type TradePatch } from "@/lib/journal/db";
import { REVIEW_TAGS } from "@/lib/journal/types";

export const dynamic = "force-dynamic";

async function user() {
  const u = await getCurrentUser();
  if (!u || u.id === "local") return null;
  return u;
}
const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function GET() {
  const u = await user();
  if (!u) return NextResponse.json({ error: "sign in required" }, { status: 401 });
  return NextResponse.json({ trades: await listTrades(u.id) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const u = await user();
  if (!u) return NextResponse.json({ error: "sign in required" }, { status: 401 });
  let b: Partial<NewTrade>;
  try { b = (await request.json()) as Partial<NewTrade>; } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }
  const status = b.status === "open" || b.status === "skipped" || b.status === "closed" ? b.status : null;
  const symbol = typeof b.symbol === "string" ? b.symbol.toUpperCase().replace(/[^A-Z.]/g, "").slice(0, 6) : "";
  const direction = b.direction === "long" || b.direction === "short" ? b.direction : null;
  if (!status || !symbol || !direction) return NextResponse.json({ error: "status, symbol and direction are required" }, { status: 400 });
  const t: NewTrade = {
    status, symbol, direction,
    side: b.side === "call" || b.side === "put" ? b.side : null,
    contract: typeof b.contract === "string" ? b.contract.slice(0, 32) : null,
    strike: numOrNull(b.strike), expiry: typeof b.expiry === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.expiry) ? b.expiry : null,
    entryPremium: numOrNull(b.entryPremium), qty: Math.max(1, Math.min(100, Math.floor(numOrNull(b.qty) ?? 1))),
    riskDollars: numOrNull(b.riskDollars), setup: typeof b.setup === "string" ? b.setup.slice(0, 40) : null,
    lifecycle: typeof b.lifecycle === "string" ? b.lifecycle.slice(0, 20) : null, marketState: typeof b.marketState === "string" ? b.marketState.slice(0, 20) : null,
    confidence: numOrNull(b.confidence) !== null ? Math.round(numOrNull(b.confidence)!) : null,
    trigger: numOrNull(b.trigger), invalidation: numOrNull(b.invalidation),
    targets: Array.isArray(b.targets) ? b.targets.filter((x): x is number => typeof x === "number").slice(0, 3) : null,
    snapshot: b.snapshot && typeof b.snapshot === "object" ? b.snapshot : null,
    strikeTag: typeof b.strikeTag === "string" ? b.strikeTag.slice(0, 16) : null,
    aligned: typeof b.aligned === "boolean" ? b.aligned : null,
    skippedReason: typeof b.skippedReason === "string" ? b.skippedReason.slice(0, 80) : null,
    notes: typeof b.notes === "string" ? b.notes.slice(0, 2000) : null,
  };
  return NextResponse.json({ trade: await createTrade(u.id, t) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const u = await user();
  if (!u) return NextResponse.json({ error: "sign in required" }, { status: 401 });
  let b: { id?: string } & TradePatch;
  try { b = (await request.json()) as typeof b; } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }
  if (!b.id || !isUuid(b.id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const patch: TradePatch = {};
  if (b.exitPremium !== undefined) patch.exitPremium = numOrNull(b.exitPremium);
  if (b.exitAt !== undefined) patch.exitAt = typeof b.exitAt === "string" && Number.isFinite(Date.parse(b.exitAt)) ? new Date(b.exitAt).toISOString() : null;
  if (b.mae !== undefined) patch.mae = numOrNull(b.mae);
  if (b.mfe !== undefined) patch.mfe = numOrNull(b.mfe);
  if (Array.isArray(b.reviewTags)) patch.reviewTags = b.reviewTags.filter((t): t is string => typeof t === "string" && (REVIEW_TAGS as readonly string[]).includes(t));
  if (b.notes !== undefined) patch.notes = typeof b.notes === "string" ? b.notes.slice(0, 2000) : null;
  if (b.outcome !== undefined) patch.outcome = b.outcome === "WORKED" || b.outcome === "FAILED" || b.outcome === "UNRESOLVED" ? b.outcome : null;
  if (b.status === "open" || b.status === "closed" || b.status === "skipped") patch.status = b.status;
  const t = await updateTrade(u.id, b.id, patch);
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ trade: t });
}

export async function DELETE(request: Request) {
  const u = await user();
  if (!u) return NextResponse.json({ error: "sign in required" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!isUuid(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  return NextResponse.json({ ok: await deleteTrade(u.id, id) });
}
