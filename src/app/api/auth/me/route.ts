import { NextResponse } from "next/server";
import { authEnabled } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!authEnabled()) return NextResponse.json({ user: { username: "local", role: "owner" }, open: true });
  return NextResponse.json({ user: await getCurrentUser() });
}
