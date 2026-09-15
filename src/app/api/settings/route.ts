// Owner-only app settings. GET returns the merged settings; PATCH
// updates the email toggles.
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/users";
import { DEFAULT_EMAIL, emailSettings, setSetting, type EmailSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  return NextResponse.json({ email: await emailSettings() });
}

export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  let body: { email?: Partial<EmailSettings> };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const current = await emailSettings();
  const next: EmailSettings = { ...DEFAULT_EMAIL, ...current };
  for (const k of ["morning", "buySignals", "security"] as const) {
    if (typeof body.email?.[k] === "boolean") next[k] = body.email[k] as boolean;
  }
  await setSetting("email", next);
  return NextResponse.json({ email: next });
}
