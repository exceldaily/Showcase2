// ─────────────────────────────────────────────────────────
// Pure helpers for device sessions: request geo/device parsing, the
// device-cap kick rule, and the "same account, two places at once"
// detector. No IO, unit-tested.
// ─────────────────────────────────────────────────────────

export interface RequestFacts {
  ip: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  userAgent: string | null;
  device: string;
}

/** Vercel stamps geo headers on every request; locally they are absent. */
export function factsFromHeaders(h: { get(name: string): string | null }): RequestFacts {
  const ua = h.get("user-agent");
  const dec = (v: string | null) => (v ? safeDecode(v) : null);
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null,
    city: dec(h.get("x-vercel-ip-city")),
    region: dec(h.get("x-vercel-ip-country-region")),
    country: h.get("x-vercel-ip-country"),
    userAgent: ua,
    device: deviceLabel(ua),
  };
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/** Rough "Chrome on Windows" label from a user agent string. */
export function deviceLabel(ua: string | null): string {
  if (!ua) return "Unknown device";
  const os = /iPhone/.test(ua) ? "iPhone"
    : /iPad/.test(ua) ? "iPad"
    : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "Mac"
    : /CrOS/.test(ua) ? "ChromeOS"
    : /Linux/.test(ua) ? "Linux"
    : "Unknown OS";
  const browser = /Edg\//.test(ua) ? "Edge"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) && !/Chromium/.test(ua) ? "Chrome"
    : /Safari\//.test(ua) && /Version\//.test(ua) ? "Safari"
    : /curl\//.test(ua) ? "curl"
    : "Browser";
  return `${browser} on ${os}`;
}

export function placeLabel(p: { city: string | null; region: string | null; country: string | null }): string {
  const parts = [p.city, p.region && p.region !== p.city ? p.region : null, p.country].filter(Boolean);
  return parts.length ? parts.join(", ") : "unknown location";
}

export interface ActiveSession {
  id: string;
  lastSeenAt: number;   // ms
  createdAt: number;    // ms
  city: string | null;
  region: string | null;
  country: string | null;
  ip: string | null;
}

/** Which existing sessions to revoke so that, after adding one more, the count fits the limit. Oldest activity goes first. */
export function sessionsToKick(active: ActiveSession[], limit: number): string[] {
  const cap = Math.max(1, Math.floor(limit));
  const room = cap - 1;
  if (active.length <= room) return [];
  const sorted = [...active].sort((a, b) => a.lastSeenAt - b.lastSeenAt || a.createdAt - b.createdAt);
  return sorted.slice(0, active.length - room).map((s) => s.id);
}

const NEAR_MS = 30 * 60_000;

/**
 * "Two places at once": another session on the same account was active within
 * the window from a different city (or, when city is unknown, a different IP).
 */
export function concurrentElsewhere(
  current: { city: string | null; country: string | null; ip: string | null },
  others: ActiveSession[],
  now: number,
  windowMs = NEAR_MS
): ActiveSession | null {
  for (const o of others) {
    if (now - o.lastSeenAt > windowMs) continue;
    const knownCities = current.city && o.city;
    if (knownCities) {
      if (o.city !== current.city || (o.country && current.country && o.country !== current.country)) return o;
    } else if (current.ip && o.ip && o.ip !== current.ip) {
      return o;
    }
  }
  return null;
}

/** First sign-in from a country this account has never used before (only meaningful once there is history). */
export function isNewCountry(country: string | null, previousCountries: (string | null)[]): boolean {
  if (!country) return false;
  const seen = previousCountries.filter((c): c is string => Boolean(c));
  return seen.length > 0 && !seen.includes(country);
}
