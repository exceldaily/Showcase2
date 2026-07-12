// ─────────────────────────────────────────────────────────
// Site passcode gate.
// When SITE_PASSCODE is set, every page requires the visitor to have
// entered it once (30-day cookie). The cookie stores a SHA-256 hash,
// never the passcode itself. /api/scan stays reachable for the cron.
// When SITE_PASSCODE is unset the site is open (local dev default).
// ─────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PREFIXES = ["/gate", "/api/gate", "/api/scan"];

async function expectedCookieValue(secret: string): Promise<string> {
  const data = new TextEncoder().encode("alphaforge-gate:" + secret);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function middleware(req: NextRequest) {
  const secret = process.env.SITE_PASSCODE;
  if (!secret) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get("af_gate")?.value;
  if (cookie && cookie === (await expectedCookieValue(secret))) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = "/gate";
  url.search = "";
  if (pathname !== "/") url.searchParams.set("from", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next static assets and favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
