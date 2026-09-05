// Recent siren events for the on-page alert bar (site-gated).

import { NextResponse } from "next/server";
import { hasDatabase, query } from "@/lib/db";
import { emailConfigured } from "@/lib/alertsEmail";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasDatabase()) return NextResponse.json({ events: [], emailConfigured: false, lastRun: null });
  const [events, runs] = await Promise.all([
    query<{ id: string; created_at: string; symbol: string; kind: string; direction: string; urgency: string; title: string; body: string; contract: string | null; opportunity: number | null; emailed: boolean }>(
      `select id, created_at, symbol, kind, direction, urgency, title, body, contract, opportunity, emailed
       from siren_events order by created_at desc limit 20`
    ),
    query<{ ran_at: string; note: string | null }>(`select ran_at, note from alert_runs order by ran_at desc limit 1`),
  ]);
  return NextResponse.json({
    events: events.map((e) => ({ ...e, createdAt: e.created_at })),
    emailConfigured: emailConfigured(),
    lastRun: runs[0] ? { at: runs[0].ran_at, note: runs[0].note } : null,
  });
}
