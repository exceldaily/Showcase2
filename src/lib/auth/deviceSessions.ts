// ─────────────────────────────────────────────────────────
// Device sessions + sign-in log (server only).
// One login_sessions row per signed-in device; the cookie carries its
// id. A fresh sign-in enforces the member's device cap (oldest devices
// get kicked), logs IP/location/device, and flags the account when it
// is used from two places at once.
// ─────────────────────────────────────────────────────────

import { hasDatabase, query, queryOne } from "@/lib/db";
import { sendAlertEmail } from "@/lib/alertsEmail";
import { concurrentElsewhere, isNewCountry, placeLabel, sessionsToKick, type ActiveSession, type RequestFacts } from "./devices";
import type { Role } from "./session";

export interface SessionRow {
  id: string;
  created_at: string;
  last_seen_at: string;
  ip: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  device: string | null;
}

export interface SigninRow {
  at: string;
  outcome: string;
  ip: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  device: string | null;
}

interface SessionUser {
  id: string;
  username: string;
  role: Role;
}

export async function logSignin(
  outcome: "success" | "failed" | "locked",
  facts: RequestFacts,
  user: { id: string; username: string } | null,
  username?: string
): Promise<void> {
  if (!hasDatabase()) return;
  await query(
    `insert into signin_log (user_id, username, outcome, ip, city, region, country, device, user_agent)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [user?.id ?? null, user?.username ?? username ?? null, outcome, facts.ip, facts.city, facts.region, facts.country, facts.device, facts.userAgent?.slice(0, 300) ?? null]
  ).catch(() => undefined);
}

export async function activeSessions(userId: string): Promise<SessionRow[]> {
  return query<SessionRow>(
    `select id, created_at::text, last_seen_at::text, ip, city, region, country, device
     from login_sessions where user_id = $1 and revoked_at is null order by last_seen_at desc`,
    [userId]
  );
}

function toActive(s: SessionRow): ActiveSession {
  return {
    id: s.id, lastSeenAt: new Date(s.last_seen_at).getTime(), createdAt: new Date(s.created_at).getTime(),
    city: s.city, region: s.region, country: s.country, ip: s.ip,
  };
}

export async function revokeSession(id: string, reason: string, userId?: string): Promise<boolean> {
  const r = await query(
    `update login_sessions set revoked_at = now(), revoke_reason = $2
     where id = $1 and revoked_at is null ${userId ? "and user_id = $3" : ""} returning id`,
    userId ? [id, reason, userId] : [id, reason]
  );
  return r.length > 0;
}

export async function revokeAllSessions(userId: string, reason: string): Promise<number> {
  const r = await query(
    "update login_sessions set revoked_at = now(), revoke_reason = $2 where user_id = $1 and revoked_at is null returning id",
    [userId, reason]
  );
  return r.length;
}

async function kickSessions(ids: string[]): Promise<void> {
  if (ids.length) await query("update login_sessions set revoked_at = now(), revoke_reason = 'device_limit' where id = any($1::uuid[])", [ids]);
}

export interface StartResult {
  sid: string;
  kicked: number;
  /** Set when the account was just used from somewhere else at the same time. */
  sharingSuspect: { place: string; device: string | null } | null;
  newCountry: boolean;
}

export async function startSession(user: SessionUser, facts: RequestFacts): Promise<StartResult> {
  const limitRow = await queryOne<{ device_limit: number }>("select device_limit from users where id = $1", [user.id]);
  const limit = limitRow?.device_limit ?? 2;
  const existing = await activeSessions(user.id);
  const asActive = existing.map(toActive);

  const elsewhere = concurrentElsewhere({ city: facts.city, country: facts.country, ip: facts.ip }, asActive, Date.now());
  const history = await query<{ country: string | null }>(
    "select distinct country from signin_log where user_id = $1 and outcome = 'success'", [user.id]
  );
  const newCountry = isNewCountry(facts.country, history.map((h) => h.country));

  const kick = sessionsToKick(asActive, limit);
  await kickSessions(kick);
  const row = await queryOne<{ id: string }>(
    `insert into login_sessions (user_id, ip, city, region, country, user_agent, device)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [user.id, facts.ip, facts.city, facts.region, facts.country, facts.userAgent?.slice(0, 300) ?? null, facts.device]
  );
  if (!row) throw new Error("could not start session");
  await logSignin("success", facts, user);

  let sharingSuspect: StartResult["sharingSuspect"] = null;
  if (elsewhere) {
    const other = existing.find((s) => s.id === elsewhere.id);
    sharingSuspect = { place: placeLabel(elsewhere), device: other?.device ?? null };
    await query(
      "update users set flagged_at = now(), flag_reason = $2 where id = $1",
      [user.id, `Used from ${placeLabel(facts)} and ${sharingSuspect.place} within 30 minutes`]
    );
  }
  return { sid: row.id, kicked: kick.length, sharingSuspect, newCountry };
}

/** Emails the owner (ALERT_EMAIL_TO) about a suspicious sign-in. Best effort, never throws. */
export async function notifyOwnerOfSignin(user: SessionUser, facts: RequestFacts, r: StartResult): Promise<void> {
  if (!r.sharingSuspect && !r.newCountry) return;
  if (user.role === "owner" && !r.sharingSuspect) return; // the owner travelling is not news
  const lines = [`${user.username} just signed in from ${placeLabel(facts)} (${facts.device}${facts.ip ? `, ${facts.ip}` : ""}).`];
  if (r.sharingSuspect) {
    lines.push(
      `That account was ALSO active from ${r.sharingSuspect.place}${r.sharingSuspect.device ? ` on ${r.sharingSuspect.device}` : ""} within the last 30 minutes. ` +
      "Two places at once usually means a shared login."
    );
  }
  if (r.newCountry) lines.push("This is the first sign-in from that country for this account.");
  if (r.kicked) lines.push(`${r.kicked} older device session${r.kicked > 1 ? "s were" : " was"} signed out to stay under the device cap.`);
  lines.push("", `Review or disable the account at: ${process.env.SITE_URL ?? "https://www.thisistemporary.us"}/invites`);
  const subject = r.sharingSuspect ? `AlphaForge: ${user.username} used from two places` : `AlphaForge: ${user.username} signed in from a new country`;
  await sendAlertEmail(subject, lines.join("\n")).catch(() => undefined);
}

export async function signinHistory(userId: string, limit = 12): Promise<SigninRow[]> {
  return query<SigninRow>(
    "select at::text, outcome, ip, city, region, country, device from signin_log where user_id = $1 order by at desc limit $2",
    [userId, limit]
  );
}

/** Sets a member's cap (1-5) and immediately trims their devices down to it. */
export async function setDeviceLimit(id: string, limit: number): Promise<boolean> {
  const n = Math.min(5, Math.max(1, Math.floor(limit)));
  const r = await query("update users set device_limit = $2 where id = $1 and role = 'member' returning id", [id, n]);
  if (r.length === 0) return false;
  const active = (await activeSessions(id)).map(toActive);
  await kickSessions(sessionsToKick(active, n + 1)); // keep n, not n-1
  return true;
}

export async function clearFlag(id: string): Promise<boolean> {
  const r = await query("update users set flagged_at = null, flag_reason = null where id = $1 returning id", [id]);
  return r.length > 0;
}
