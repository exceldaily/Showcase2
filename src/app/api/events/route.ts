// Catalyst events: FRED release calendar (typical times) plus
// owner-entered market events. GET for any member; POST/DELETE owner.
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/users";
import { addManualEvent, deleteManualEvent, fredReleaseEvents, manualEvents } from "@/lib/catalystsLive";
import { viewEvents } from "@/lib/catalysts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol")?.toUpperCase().replace(/[^A-Z.]/g, "").slice(0, 6) || null;
  const now = Date.now();
  const [fred, manual] = await Promise.all([fredReleaseEvents(now), manualEvents(now)]);
  const notes: string[] = [];
  if (!fred.ok) notes.push(process.env.FRED_API_KEY ? "Economic release calendar unavailable right now." : "Economic release calendar not configured (FRED_API_KEY).");
  notes.push("Release times are the usual slot for each report, not a published clock time.");
  notes.push("Fed speakers and earnings dates: not supported by the current data provider. Add them as manual events.");
  return NextResponse.json({ events: viewEvents([...fred.events, ...manual], now, symbol), fredOk: fred.ok, notes, asOf: new Date(now).toISOString() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  let body: { at?: string; title?: string; impact?: string; affects?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const at = body.at ? Date.parse(body.at) : NaN;
  const title = (body.title ?? "").trim().slice(0, 120);
  const impact = body.impact === "HIGH" || body.impact === "MEDIUM" || body.impact === "LOW" ? body.impact : null;
  const affects = (body.affects ?? "market").toUpperCase().replace(/[^A-Z.]/g, "").slice(0, 6) || "market";
  if (!Number.isFinite(at) || !title || !impact) return NextResponse.json({ error: "at, title and impact are required" }, { status: 400 });
  const id = await addManualEvent({ at: new Date(at).toISOString(), title, impact, affects: affects === "MARKET" ? "market" : affects, createdBy: owner.id === "local" ? null : owner.id });
  return NextResponse.json({ ok: true, id });
}

export async function DELETE(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  await deleteManualEvent(id);
  return NextResponse.json({ ok: true });
}
