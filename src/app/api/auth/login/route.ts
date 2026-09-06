// Username + password sign-in. Sets the signed session cookie.
import { NextResponse } from "next/server";
import { hasDatabase } from "@/lib/db";
import { authEnabled, normalizeUsername } from "@/lib/auth/session";
import { attachSession, checkLogin, clearFailures, loginLocked, noteFailure } from "@/lib/auth/users";

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
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const key = `${ip}:${username}`;
  if (loginLocked(key)) return NextResponse.json({ error: "Too many attempts. Try again in 10 minutes." }, { status: 429 });

  const user = await checkLogin(username, String(body.password ?? ""));
  if (!user) {
    noteFailure(key);
    await new Promise((r) => setTimeout(r, 800));
    return NextResponse.json({ error: "Wrong username or password." }, { status: 401 });
  }
  clearFailures(key);
  const res = NextResponse.json({ ok: true, user: { username: user.username, role: user.role } });
  return attachSession(res, user);
}
