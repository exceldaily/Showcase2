// Owner-only: a member's signed-in devices and recent sign-in history,
// and signing one device out.
import { NextResponse } from "next/server";
import { hasDatabase } from "@/lib/db";
import { requireOwner } from "@/lib/auth/users";
import { activeSessions, revokeSession, signinHistory } from "@/lib/auth/deviceSessions";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/;

export async function GET(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  const user = new URL(request.url).searchParams.get("user") ?? "";
  if (!UUID_RE.test(user)) return NextResponse.json({ error: "user required" }, { status: 400 });
  if (!hasDatabase()) return NextResponse.json({ sessions: [], history: [] });
  const [sessions, history] = await Promise.all([activeSessions(user), signinHistory(user, 15)]);
  return NextResponse.json({ sessions, history });
}

export async function DELETE(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  const ok = await revokeSession(id, "owner");
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
