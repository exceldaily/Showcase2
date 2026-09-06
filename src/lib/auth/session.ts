// ─────────────────────────────────────────────────────────
// Signed session cookie (HMAC-SHA256 over a small JSON payload).
// Uses WebCrypto only so it runs in both the Edge middleware and
// Node route handlers. Stateless: middleware verifies the signature;
// pages and sensitive routes re-check the user row in Postgres.
// ─────────────────────────────────────────────────────────

export const SESSION_COOKIE = "af_session";
export const SESSION_DAYS = 30;

export type Role = "owner" | "member";

export interface SessionPayload {
  uid: string;
  sid: string;   // login_sessions.id (device)
  name: string;
  role: Role;
  v: number;     // users.session_version at sign time
  exp: number;   // unix seconds
}

/** AUTH_SECRET, or a value derived from SITE_PASSCODE so the site is never open by accident. */
export function authSecret(): string | null {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (process.env.SITE_PASSCODE) return "derived:" + process.env.SITE_PASSCODE;
  return null;
}

export function authEnabled(): boolean {
  return authSecret() !== null;
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64url(new Uint8Array(sig));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifySession(token: string | undefined, secret: string, now = Date.now()): Promise<SessionPayload | null> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!constantTimeEqual(sig, await hmac(secret, body))) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(fromB64url(body))) as Partial<SessionPayload>;
    if (typeof p.uid !== "string" || typeof p.sid !== "string" || typeof p.name !== "string" || typeof p.exp !== "number" || typeof p.v !== "number") return null;
    if (p.role !== "owner" && p.role !== "member") return null;
    if (p.exp * 1000 < now) return null;
    return p as SessionPayload;
  } catch {
    return null;
  }
}

/** Username rules: 2-24 chars, lowercase letters/digits/._- and must start alphanumeric. */
export const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{1,23}$/;
export const PASSWORD_MIN = 4;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateCredentials(username: string, password: string): string | null {
  if (!USERNAME_RE.test(username)) return "Username: 2-24 characters, letters, numbers, dots, dashes or underscores.";
  if (typeof password !== "string" || password.length < PASSWORD_MIN) return `Password: at least ${PASSWORD_MIN} characters.`;
  if (password.length > 200) return "Password is too long.";
  return null;
}
