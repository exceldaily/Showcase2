// Creates a member account from an invite link. No email confirmation:
// the invite itself is the proof. Signs the new user in on this device.
import { NextResponse } from "next/server";
import { hasDatabase } from "@/lib/db";
import { authEnabled } from "@/lib/auth/session";
import { attachSession, registerWithInvite } from "@/lib/auth/users";
import { startSession } from "@/lib/auth/deviceSessions";
import { factsFromHeaders } from "@/lib/auth/devices";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!authEnabled() || !hasDatabase()) return NextResponse.json({ error: "accounts not configured" }, { status: 503 });
  let body: { token?: string; username?: string; password?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const result = await registerWithInvite(String(body.token ?? ""), String(body.username ?? ""), String(body.password ?? ""));
  if (!result.user) return NextResponse.json({ error: result.error }, { status: result.status });
  const started = await startSession(result.user, factsFromHeaders(request.headers));
  const res = NextResponse.json({ ok: true, user: { username: result.user.username, role: result.user.role } }, { status: 201 });
  return attachSession(res, result.user, started.sid);
}
