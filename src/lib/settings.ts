// ─────────────────────────────────────────────────────────
// App settings (server only). Small key/value store with code defaults
// and a 60-second in-memory cache. First use: which emails go out.
// ─────────────────────────────────────────────────────────

import { hasDatabase, query, queryOne } from "@/lib/db";

export interface EmailSettings {
  /** The 9:10 ET look-ahead with the day's picks. */
  morning: boolean;
  /** Breakout / retest-held buy signals (the on-page siren always fires). */
  buySignals: boolean;
  /** Account security: same login used from two places at once. */
  security: boolean;
}

export const DEFAULT_EMAIL: EmailSettings = { morning: true, buySignals: false, security: true };

const cache = new Map<string, { at: number; value: unknown }>();
const TTL = 60_000;

async function getSetting<T>(key: string, fallback: T): Promise<T> {
  if (!hasDatabase()) return fallback;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as T;
  const r = await queryOne<{ value: unknown }>("select value from app_settings where key = $1", [key]).catch(() => null);
  const value = r ? ({ ...(fallback as object), ...(r.value as object) } as T) : fallback;
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  if (!hasDatabase()) return;
  await query(
    "insert into app_settings (key, value, updated_at) values ($1, $2::jsonb, now()) on conflict (key) do update set value = excluded.value, updated_at = now()",
    [key, JSON.stringify(value)]
  );
  cache.set(key, { at: Date.now(), value });
}

export function emailSettings(): Promise<EmailSettings> {
  return getSetting("email", DEFAULT_EMAIL);
}
