// Signal analytics: every number is counted from the signal log.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/users";
import { listSignals, replayCoverage, resolveLive } from "@/lib/signals/store";
import { blockedTable, bySymbol, conditionTable, modelSummary, type Source } from "@/lib/signals/stats";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const src = url.searchParams.get("source");
  const source: Source | "all" = src === "live" || src === "replay" ? src : "all";
  const days = Math.max(5, Math.min(365, Number(url.searchParams.get("days") ?? 90) || 90));
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
  // Settle live rows whose session has ended (a few per request, so this never stalls the page).
  const settled = await resolveLive(8).catch(() => ({ resolved: 0, closed: 0 }));
  const [rows, coverage, me] = await Promise.all([
    listSignals({ days, source, symbol: /^[A-Z.]{1,6}$/.test(symbol) ? symbol : undefined }),
    replayCoverage().catch(() => []),
    getCurrentUser().catch(() => null),
  ]);
  const entries = (model: "old" | "new") => rows.filter((r) => r.model === model && r.status === "ENTRY");
  const sessions = Array.from(new Set(rows.map((r) => r.day))).sort();
  return NextResponse.json({
    asOf: new Date().toISOString(), source, days,
    sessions: { count: sessions.length, first: sessions[0] ?? null, last: sessions[sessions.length - 1] ?? null },
    counts: { live: rows.filter((r) => r.source === "live").length, replay: rows.filter((r) => r.source === "replay").length },
    models: { old: modelSummary("old", rows), new: modelSummary("new", rows) },
    blocked: blockedTable(rows),
    conditions: { old: conditionTable(entries("old")), new: conditionTable(entries("new")) },
    symbols: { old: bySymbol(entries("old")), new: bySymbol(entries("new")) },
    recent: rows.filter((r) => r.status === "ENTRY" || r.status === "NO ENTRY").slice(0, 120).map((r) => ({
      symbol: r.symbol, day: r.day, model: r.model, source: r.source, direction: r.direction, trigger: r.trigger, status: r.status, blockedBy: r.blockedBy,
      firedAt: r.firedAt, price: r.price, outcome: r.outcome, r: r.r, quality: r.features?.quality ?? null, rvol: r.features?.rvol ?? null,
    })),
    coverage, settled, isOwner: me?.role === "owner",
  }, { headers: { "Cache-Control": "no-store" } });
}
