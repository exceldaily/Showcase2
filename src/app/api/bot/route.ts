// Bot state, settings and the stop switch. Owner only.
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/users";
import { botSnapshot, logEvent, stopBot } from "@/lib/bot/engine";
import { getBotSettings, saveBotSettings } from "@/lib/bot/settings";
import { sanitizeSettings } from "@/lib/bot/rules";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  return NextResponse.json(await botSnapshot(), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }
  const prev = await getBotSettings(true);
  const next = sanitizeSettings(body, prev);
  // "Reset budget" starts the count again from now: earlier losses stop eating the budget.
  if (body.resetBudget === true) next.budgetSince = new Date().toISOString();
  const saved = await saveBotSettings(next);
  if (saved.mode !== prev.mode) await logEvent("info", null, `Bot switched to ${saved.mode === "trade" ? "TRADING" : saved.mode === "dry-run" ? "DRY RUN" : "OFF"}.`);
  if (saved.budget !== prev.budget || body.resetBudget === true) await logEvent("info", null, `Budget set to $${saved.budget}${body.resetBudget === true ? " and reset" : ""}.`);
  return NextResponse.json(await botSnapshot());
}

export async function POST(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  const action = new URL(request.url).searchParams.get("action");
  if (action !== "pause" && action !== "stop") return NextResponse.json({ error: "unknown action" }, { status: 400 });
  const r = await stopBot(action === "stop");
  return NextResponse.json({ ...r, ...(await botSnapshot()) });
}
