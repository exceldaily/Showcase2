// ─────────────────────────────────────────────────────────
// Accounts + invites (server only). Invite-only: the sole way to
// create an account is a valid invite token issued by the owner, or
// the one-time owner claim (site passcode, only while no users exist).
// ─────────────────────────────────────────────────────────

import { cache } from "react";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { hasDatabase, query, queryOne } from "@/lib/db";
import { hashPassword, verifyPassword } from "./password";
import {
  SESSION_COOKIE, SESSION_DAYS, authEnabled, authSecret, normalizeUsername, signSession, validateCredentials, verifySession,
  type Role, type SessionPayload,
} from "./session";

export interface UserRow {
  id: string;
  username: string;
  role: Role;
  disabled: boolean;
  session_version: number;
  created_at: string;
  last_login_at: string | null;
}

export interface CurrentUser {
  id: string;
  username: string;
  role: Role;
}

export interface SessionState {
  user: CurrentUser | null;
  /** Cookie had a valid signature but the account is gone, disabled, or signed out everywhere. */
  revoked: boolean;
}

export const INVITE_DAYS = 7;

/** Per-request cached read of the session cookie plus a DB validity check. */
export const sessionState = cache(async (): Promise<SessionState> => {
  const secret = authSecret();
  if (!secret) return { user: null, revoked: false };
  const token = cookies().get(SESSION_COOKIE)?.value;
  const payload = await verifySession(token, secret);
  if (!payload) return { user: null, revoked: false };
  if (!hasDatabase()) return { user: { id: payload.uid, username: payload.name, role: payload.role }, revoked: false };
  const row = await queryOne<Pick<UserRow, "id" | "username" | "role" | "disabled" | "session_version">>(
    "select id, username, role, disabled, session_version from users where id = $1", [payload.uid]
  );
  if (!row || row.disabled || row.session_version !== payload.v) return { user: null, revoked: true };
  return { user: { id: row.id, username: row.username, role: row.role }, revoked: false };
});

export async function getCurrentUser(): Promise<CurrentUser | null> {
  return (await sessionState()).user;
}

/** Route helper: 401 JSON when signed out. */
export async function requireUser(): Promise<CurrentUser | NextResponse> {
  if (!authEnabled()) return { id: "local", username: "local", role: "owner" };
  const u = await getCurrentUser();
  return u ?? NextResponse.json({ error: "sign in required" }, { status: 401 });
}

/** Route helper: 403 JSON unless the caller is the owner. */
export async function requireOwner(): Promise<CurrentUser | NextResponse> {
  const u = await requireUser();
  if (u instanceof NextResponse) return u;
  return u.role === "owner" ? u : NextResponse.json({ error: "owner only" }, { status: 403 });
}

export async function userCount(): Promise<number> {
  const r = await queryOne<{ n: number }>("select count(*)::int as n from users");
  return r ? Number(r.n) : 0;
}

export async function findUserByUsername(username: string): Promise<(UserRow & { password_hash: string }) | null> {
  return queryOne(
    "select id, username, password_hash, role, disabled, session_version, created_at::text, last_login_at::text from users where username = $1",
    [username]
  );
}

/** Sets the signed session cookie on a response. */
export async function attachSession(
  res: NextResponse,
  user: { id: string; username: string; role: Role; session_version: number }
): Promise<NextResponse> {
  const secret = authSecret();
  if (!secret) return res;
  const payload: SessionPayload = {
    uid: user.id, name: user.username, role: user.role, v: user.session_version,
    exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400,
  };
  res.cookies.set(SESSION_COOKIE, await signSession(payload, secret), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86400,
  });
  return res;
}

export function clearSession(res: NextResponse): NextResponse {
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0,
  });
  return res;
}

// ── Login ────────────────────────────────────────────────

const attempts = new Map<string, { n: number; until: number }>();
const MAX_ATTEMPTS = 8;
const LOCK_MS = 10 * 60_000;

/** Best-effort in-memory throttle (per serverless instance). */
export function loginLocked(key: string): boolean {
  const a = attempts.get(key);
  return Boolean(a && a.n >= MAX_ATTEMPTS && a.until > Date.now());
}
export function noteFailure(key: string): void {
  const a = attempts.get(key);
  if (!a || a.until < Date.now()) attempts.set(key, { n: 1, until: Date.now() + LOCK_MS });
  else a.n += 1;
}
export function clearFailures(key: string): void {
  attempts.delete(key);
}

export async function checkLogin(usernameRaw: string, password: string): Promise<UserRow | null> {
  const username = normalizeUsername(String(usernameRaw ?? ""));
  const row = await findUserByUsername(username);
  if (!row || row.disabled) return null;
  if (!verifyPassword(String(password ?? ""), row.password_hash)) return null;
  await query("update users set last_login_at = now() where id = $1", [row.id]);
  return row;
}

// ── Owner claim (one time) ───────────────────────────────

export async function claimOwner(usernameRaw: string, password: string): Promise<{ user?: UserRow; error?: string; status: number }> {
  const username = normalizeUsername(usernameRaw);
  const bad = validateCredentials(username, password);
  if (bad) return { error: bad, status: 400 };
  if ((await userCount()) > 0) return { error: "The owner account already exists.", status: 409 };
  const user = await queryOne<UserRow>(
    `insert into users (username, password_hash, role) values ($1, $2, 'owner')
     returning id, username, role, disabled, session_version, created_at::text, last_login_at::text`,
    [username, hashPassword(password)]
  );
  return user ? { user, status: 201 } : { error: "could not create the account", status: 500 };
}

// ── Invites ──────────────────────────────────────────────

export interface InviteRow {
  id: string;
  email: string | null;
  note: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_by_name: string | null;
  revoked_at: string | null;
  email_sent: boolean;
  email_error: string | null;
}

export function hashToken(token: string): string {
  return createHash("sha256").update("alphaforge-invite:" + token).digest("hex");
}

export async function createInvite(
  ownerId: string,
  email: string | null,
  note: string | null
): Promise<{ id: string; token: string; expiresAt: string }> {
  const token = randomBytes(24).toString("base64url");
  const row = await queryOne<{ id: string; expires_at: string }>(
    `insert into invites (token_hash, email, note, created_by, expires_at)
     values ($1, $2, $3, $4, now() + make_interval(days => $5::int))
     returning id, expires_at::text`,
    [hashToken(token), email, note, ownerId, INVITE_DAYS]
  );
  if (!row) throw new Error("could not create invite");
  return { id: row.id, token, expiresAt: row.expires_at };
}

export async function markInviteEmail(id: string, sent: boolean, error: string | null): Promise<void> {
  await query("update invites set email_sent = $2, email_error = $3 where id = $1", [id, sent, error]);
}

export async function listInvites(): Promise<InviteRow[]> {
  return query<InviteRow>(
    `select i.id, i.email, i.note, i.created_at::text, i.expires_at::text, i.used_at::text, u.username as used_by_name,
            i.revoked_at::text, i.email_sent, i.email_error
     from invites i left join users u on u.id = i.used_by
     order by i.created_at desc limit 200`
  );
}

export async function revokeInvite(id: string): Promise<boolean> {
  const r = await query(
    "update invites set revoked_at = now() where id = $1 and used_at is null and revoked_at is null returning id",
    [id]
  );
  return r.length > 0;
}

export type InvitePeek =
  | { ok: true; id: string; invitedBy: string; email: string | null; expiresAt: string }
  | { ok: false; reason: "invalid" | "used" | "expired" | "revoked" };

export async function peekInvite(token: string): Promise<InvitePeek> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { ok: false, reason: "invalid" };
  const row = await queryOne<{
    id: string; email: string | null; expires_at: string; used_at: string | null; revoked_at: string | null; expired: boolean; inviter: string;
  }>(
    `select i.id, i.email, i.expires_at::text, i.used_at::text, i.revoked_at::text, (i.expires_at < now()) as expired, u.username as inviter
     from invites i join users u on u.id = i.created_by where i.token_hash = $1`,
    [hashToken(token)]
  );
  if (!row) return { ok: false, reason: "invalid" };
  if (row.used_at) return { ok: false, reason: "used" };
  if (row.revoked_at) return { ok: false, reason: "revoked" };
  if (row.expired) return { ok: false, reason: "expired" };
  return { ok: true, id: row.id, invitedBy: row.inviter, email: row.email, expiresAt: row.expires_at };
}

const PEEK_MESSAGES: Record<Extract<InvitePeek, { ok: false }>["reason"], string> = {
  invalid: "That invite link is not valid.",
  used: "That invite was already used.",
  expired: "That invite has expired. Ask for a new one.",
  revoked: "That invite was cancelled.",
};

export function inviteProblem(reason: Extract<InvitePeek, { ok: false }>["reason"]): string {
  return PEEK_MESSAGES[reason];
}

/** Creates the member, then claims the invite; the guarded update prevents reuse of one link. */
export async function registerWithInvite(
  token: string,
  usernameRaw: string,
  password: string
): Promise<{ user?: UserRow; error?: string; status: number }> {
  const username = normalizeUsername(usernameRaw);
  const bad = validateCredentials(username, password);
  if (bad) return { error: bad, status: 400 };
  const peek = await peekInvite(token);
  if (!peek.ok) return { error: inviteProblem(peek.reason), status: 410 };
  if (await findUserByUsername(username)) return { error: "That username is taken.", status: 409 };
  const inviter = await queryOne<{ created_by: string }>("select created_by from invites where id = $1", [peek.id]);
  const user = await queryOne<UserRow>(
    `insert into users (username, password_hash, role, invited_by) values ($1, $2, 'member', $3)
     returning id, username, role, disabled, session_version, created_at::text, last_login_at::text`,
    [username, hashPassword(password), inviter?.created_by ?? null]
  );
  if (!user) return { error: "could not create the account", status: 500 };
  const claimed = await query(
    "update invites set used_at = now(), used_by = $2 where id = $1 and used_at is null and revoked_at is null returning id",
    [peek.id, user.id]
  );
  if (claimed.length === 0) {
    // Lost a race with another registration on the same link: undo.
    await query("delete from users where id = $1", [user.id]);
    return { error: "That invite was already used.", status: 410 };
  }
  return { user, status: 201 };
}

// ── Members ──────────────────────────────────────────────

export interface MemberRow {
  id: string;
  username: string;
  role: Role;
  disabled: boolean;
  created_at: string;
  last_login_at: string | null;
  invited_by_name: string | null;
}

export async function listMembers(): Promise<MemberRow[]> {
  return query<MemberRow>(
    `select u.id, u.username, u.role, u.disabled, u.created_at::text, u.last_login_at::text, i.username as invited_by_name
     from users u left join users i on i.id = u.invited_by
     order by (u.role = 'owner') desc, u.created_at asc`
  );
}

/** Disabling also bumps session_version so every existing cookie stops working immediately. */
export async function setMemberDisabled(id: string, disabled: boolean): Promise<boolean> {
  const r = await query(
    "update users set disabled = $2, session_version = session_version + 1 where id = $1 and role = 'member' returning id",
    [id, disabled]
  );
  return r.length > 0;
}

export async function deleteMember(id: string): Promise<boolean> {
  const r = await query("delete from users where id = $1 and role = 'member' returning id", [id]);
  return r.length > 0;
}
