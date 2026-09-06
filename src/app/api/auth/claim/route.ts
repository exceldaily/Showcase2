// One-time owner bootstrap. Needs the site passcode and only works while
// the users table is empty; after that it always answers 409.
import { NextResponse } from "next/server";
import { hasDatabase } from "@/lib/db";
import { authEnabled } from "@/lib/auth/session";
import { attachSession, claimOwner, userCount } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!authEnabled() || !hasDatabase()) return NextResponse.json({ available: false });
  return NextResponse.json({ available: (await userCount()) === 0 });
}

export async function POST(request: Request) {
  if (!authEnabled() || !hasDatabase()) return NextResponse.json({ error: "accounts not configured" }, { status: 503 });
  const passcode = process.env.SITE_PASSCODE;
  if (!passcode) return NextResponse.json({ error: "SITE_PASSCODE is not set, so the owner claim is disabled" }, { status: 503 });
  let body: { passcode?: string; username?: string; password?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if ((await userCount()) > 0) return NextResponse.json({ error: "The owner account already exists." }, { status: 409 });
  if (String(body.passcode ?? "") !== passcode) {
    await new Promise((r) => setTimeout(r, 800));
    return NextResponse.json({ error: "Wrong passcode." }, { status: 401 });
  }
  const result = await claimOwner(String(body.username ?? ""), String(body.password ?? ""));
  if (!result.user) return NextResponse.json({ error: result.error }, { status: result.status });
  const res = NextResponse.json({ ok: true, user: { username: result.user.username, role: result.user.role } }, { status: 201 });
  return attachSession(res, result.user);
}
