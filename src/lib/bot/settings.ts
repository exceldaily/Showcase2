// Bot settings in the app_settings table (key "bot"), always passed through sanitizeSettings.
import { hasDatabase, query, queryOne } from "../db";
import { DEFAULT_BOT, sanitizeSettings, type BotSettings } from "./rules";

let cached: { at: number; value: BotSettings } | null = null;

export async function getBotSettings(fresh = false): Promise<BotSettings> {
  if (!hasDatabase()) return DEFAULT_BOT;
  if (!fresh && cached && Date.now() - cached.at < 15_000) return cached.value;
  const r = await queryOne<{ value: Record<string, unknown> }>("select value from app_settings where key = 'bot'").catch(() => null);
  const value = sanitizeSettings(r?.value ?? {}, DEFAULT_BOT);
  cached = { at: Date.now(), value };
  return value;
}

export async function saveBotSettings(next: BotSettings): Promise<BotSettings> {
  const value = sanitizeSettings(next as unknown as Record<string, unknown>, next);
  if (hasDatabase()) {
    await query("insert into app_settings (key, value, updated_at) values ('bot', $1::jsonb, now()) on conflict (key) do update set value = excluded.value, updated_at = now()", [JSON.stringify(value)]);
  }
  cached = { at: Date.now(), value };
  return value;
}
