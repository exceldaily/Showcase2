// Username + password sign-in. Starts a device session (enforcing the
// member's device cap), logs IP/location/device, and sets the cookie.
import { NextResponse } from "next/server";
import { hasDatabase } from "@/lib/db";
import { authEnabled, normalizeUsername } from "@/lib/auth/session";
import { attachSession, checkLogin, clearFailures, loginLocked, noteFailure } from "@/lib/auth/users";
import { logSignin, notifyOwnerOfSignin, startSession } from "@/lib/auth/deviceSessions";
import { factsFromHeaders } from "@/lib/auth/devices";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!authEnabled()) return NextResponse.json({ ok: true, open: true });
  if (!hasDatabase()) return NextResponse.json({ error: "database not configured" }, { status: 503 });
  let body: { username?: string; password?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const username = normalizeUsername(String(body.username ?? ""));
  const facts = factsFromHeaders(request.headers);
  const key = `${facts.ip ?? "unknown"}:${username}`;
  if (loginLocked(key)) {
    await logSignin("locked", facts, null, username);
    return NextResponse.json({ error: "Too many attempts. Try again in 10 minutes." }, { status: 429 });
  }

  const user = await checkLogin(username, String(body.password ?? ""));
  if (!user) {
    noteFailure(key);
    await logSignin("failed", facts, null, username);
    await new Promise((r) => setTimeout(r, 800));
    return NextResponse.json({ error: "Wrong username or password." }, { status: 401 });
  }
  clearFailures(key);
  const started = await startSession(user, facts);
  await notifyOwnerOfSignin(user, facts, started);
  const res = NextResponse.json({ ok: true, user: { username: user.username, role: user.role }, kicked: started.kicked });
  return attachSession(res, user, started.sid);
}
