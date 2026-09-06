// Clears the session cookie. GET redirects (used by the nav link and by
// the layout when a session was revoked); POST returns JSON.
import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/login";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));
  const reason = url.searchParams.get("reason");
  const target = new URL(next, url.origin);
  if (reason) target.searchParams.set("reason", reason);
  return clearSession(NextResponse.redirect(target));
}

export async function POST() {
  return clearSession(NextResponse.json({ ok: true }));
}
