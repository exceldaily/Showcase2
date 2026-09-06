// Ends this device's session and clears the cookie. GET redirects (used
// by the nav link and by the layout when a session was revoked); POST
// returns JSON.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearSession } from "@/lib/auth/users";
import { revokeSession } from "@/lib/auth/deviceSessions";
import { SESSION_COOKIE, authSecret, verifySession } from "@/lib/auth/session";
import { hasDatabase } from "@/lib/db";

export const dynamic = "force-dynamic";

function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/login";
}

async function endDeviceSession(): Promise<void> {
  const secret = authSecret();
  if (!secret || !hasDatabase()) return;
  const payload = await verifySession(cookies().get(SESSION_COOKIE)?.value, secret);
  if (payload) await revokeSession(payload.sid, "user", payload.uid).catch(() => undefined);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));
  const reason = url.searchParams.get("reason");
  const target = new URL(next, url.origin);
  if (reason) target.searchParams.set("reason", reason);
  await endDeviceSession();
  return clearSession(NextResponse.redirect(target));
}

export async function POST() {
  await endDeviceSession();
  return clearSession(NextResponse.json({ ok: true }));
}
