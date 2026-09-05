// Siren watchlist: extra symbols the sweep monitors beyond megacaps.

import { NextResponse } from "next/server";
import { hasDatabase, query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasDatabase()) return NextResponse.json({ symbols: [] });
  const rows = await query<{ symbol: string }>(`select symbol from alert_watch order by symbol`);
  return NextResponse.json({ symbols: rows.map((r) => r.symbol) });
}

export async function POST(request: Request) {
  if (!hasDatabase()) return NextResponse.json({ error: "no database" }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { symbols?: unknown };
  const syms = Array.isArray(body.symbols)
    ? body.symbols.map((s) => String(s).toUpperCase()).filter((s) => /^[A-Z.]{1,6}$/.test(s)).slice(0, 60)
    : [];
  for (const s of syms) await query(`insert into alert_watch (symbol) values ($1) on conflict do nothing`, [s]);
  const rows = await query<{ symbol: string }>(`select symbol from alert_watch order by symbol`);
  return NextResponse.json({ symbols: rows.map((r) => r.symbol) });
}

export async function DELETE(request: Request) {
  if (!hasDatabase()) return NextResponse.json({ error: "no database" }, { status: 503 });
  const s = (new URL(request.url).searchParams.get("symbol") ?? "").toUpperCase();
  if (!/^[A-Z.]{1,6}$/.test(s)) return NextResponse.json({ error: "invalid symbol" }, { status: 400 });
  await query(`delete from alert_watch where symbol = $1`, [s]);
  const rows = await query<{ symbol: string }>(`select symbol from alert_watch order by symbol`);
  return NextResponse.json({ symbols: rows.map((r) => r.symbol) });
}
