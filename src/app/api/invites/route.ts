// Owner-only invite management. POST creates a single-use link (and
// emails it when Brevo is configured); the raw token is returned ONCE
// so the owner can copy it. DELETE cancels a pending invite.
import { NextResponse } from "next/server";
import { hasDatabase } from "@/lib/db";
import { createInvite, listInvites, markInviteEmail, requireOwner, revokeInvite, INVITE_DAYS } from "@/lib/auth/users";
import { inviteEmailConfigured, sendEmail } from "@/lib/alertsEmail";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function siteOrigin(request: Request): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  if (host) return `${proto}://${host}`;
  return process.env.SITE_URL ?? new URL(request.url).origin;
}

export async function GET() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  if (!hasDatabase()) return NextResponse.json({ invites: [], emailConfigured: false });
  return NextResponse.json({ invites: await listInvites(), emailConfigured: inviteEmailConfigured(), inviteDays: INVITE_DAYS });
}

export async function POST(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  if (!hasDatabase()) return NextResponse.json({ error: "database not configured" }, { status: 503 });
  let body: { email?: string; note?: string; send?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (email && !EMAIL_RE.test(email)) return NextResponse.json({ error: "That email does not look right." }, { status: 400 });
  const note = String(body.note ?? "").trim().slice(0, 120) || null;

  const invite = await createInvite(owner.id, email || null, note);
  const link = `${siteOrigin(request)}/join/${invite.token}`;

  let emailed: { sent: boolean; reason?: string } = { sent: false, reason: email ? "not sent" : "no email given" };
  if (email && body.send !== false) {
    if (!inviteEmailConfigured()) {
      emailed = { sent: false, reason: "email not configured; copy the link instead" };
    } else {
      emailed = await sendEmail({
        to: email,
        subject: `${owner.username} invited you to AlphaForge`,
        text:
          `${owner.username} invited you to AlphaForge, a private options trading terminal.\n\n` +
          `Create your account here (pick any username and password, no email confirmation):\n${link}\n\n` +
          `This link works once and expires in ${INVITE_DAYS} days.${note ? `\n\nNote from ${owner.username}: ${note}` : ""}`,
        senderName: "AlphaForge",
      });
    }
    await markInviteEmail(invite.id, emailed.sent, emailed.sent ? null : (emailed.reason ?? null));
  }
  return NextResponse.json({ ok: true, id: invite.id, link, expiresAt: invite.expiresAt, emailed }, { status: 201 });
}

export async function DELETE(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  const ok = await revokeInvite(id);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
