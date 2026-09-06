// ─────────────────────────────────────────────────────────
// Invite-only sign-in gate.
// Every page and API route needs a valid signed session cookie
// (see lib/auth/session.ts). The Edge runtime can only verify the
// signature; pages and sensitive routes re-check the user in Postgres.
// Cron/monitoring endpoints carry their own CRON_SECRET auth and stay
// public. With no AUTH_SECRET and no SITE_PASSCODE the site is open
// (local dev default).
// ─────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authSecret, verifySession } from "@/lib/auth/session";

const PUBLIC_PREFIXES = [
  "/login", "/join", "/claim", "/api/auth",
  "/api/scan", "/api/backtest", "/api/catalyst-sweep", "/api/alerts/sweep", "/api/health",
];

export async function middleware(req: NextRequest) {
  const secret = authSecret();
  if (!secret) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value, secret);
  if (session) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (pathname !== "/") url.searchParams.set("from", pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next static assets and favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
