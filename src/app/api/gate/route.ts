// Passcode check endpoint. Sets the 30-day gate cookie on success.
import { NextResponse } from "next/server";

async function cookieValue(secret: string): Promise<string> {
  const data = new TextEncoder().encode("alphaforge-gate:" + secret);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function POST(request: Request) {
  const secret = process.env.SITE_PASSCODE;
  if (!secret) {
    return NextResponse.json({ ok: true, open: true });
  }

  let passcode = "";
  try {
    const body = (await request.json()) as { passcode?: string };
    passcode = body.passcode ?? "";
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (passcode !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("af_gate", await cookieValue(secret), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
