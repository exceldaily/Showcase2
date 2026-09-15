// IO for the catalyst panel: FRED release dates (cached 30 minutes) and
// the owner-entered market_events table.

import { fetchJson } from "@/providers/http";
import { hasDatabase, query } from "./db";
import { fromFredRelease, type CatalystEvent, type Impact } from "./catalysts";

let fredCache: { at: number; events: CatalystEvent[]; ok: boolean } | null = null;

/** Scheduled releases for today through the next 7 days. `ok` is false when FRED is unavailable or unconfigured. */
export async function fredReleaseEvents(nowMs = Date.now()): Promise<{ events: CatalystEvent[]; ok: boolean }> {
  if (fredCache && nowMs - fredCache.at < 30 * 60_000) return { events: fredCache.events, ok: fredCache.ok };
  const key = process.env.FRED_API_KEY;
  if (!key) return { events: [], ok: false };
  const today = new Date(nowMs).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const end = new Date(nowMs + 7 * 86400e3).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const url = new URL("https://api.stlouisfed.org/fred/releases/dates");
  url.searchParams.set("api_key", key);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("realtime_start", today);
  url.searchParams.set("realtime_end", end);
  url.searchParams.set("include_release_dates_with_no_data", "true");
  url.searchParams.set("limit", "1000");
  const r = await fetchJson<{ release_dates?: { release_id: number; release_name: string; date: string }[] }>(url.toString(), { source: "FRED release calendar", revalidateSeconds: 1800, timeoutMs: 8_000, retries: 1 });
  const events: CatalystEvent[] = [];
  if (r.ok && r.data?.release_dates) {
    for (const d of r.data.release_dates) {
      if (d.date < today || d.date > end) continue;
      const e = fromFredRelease(d.release_id, d.release_name, d.date);
      if (e) events.push(e);
    }
  }
  fredCache = { at: nowMs, events, ok: r.ok };
  return { events, ok: r.ok };
}

interface Row { id: string; at: string; title: string; impact: Impact; affects: string }

export async function manualEvents(nowMs = Date.now()): Promise<CatalystEvent[]> {
  if (!hasDatabase()) return [];
  const rows = await query<Row>(
    "select id, at::text, title, impact, affects from market_events where at > $1 and at < $2 order by at",
    [new Date(nowMs - 6 * 3600e3).toISOString(), new Date(nowMs + 14 * 86400e3).toISOString()]
  ).catch(() => [] as Row[]);
  return rows.map((r) => ({ id: `manual:${r.id}`, at: new Date(r.at).toISOString(), title: r.title, impact: r.impact, source: "manual" as const, affects: r.affects, typicalTime: false }));
}

export async function addManualEvent(e: { at: string; title: string; impact: Impact; affects: string; createdBy: string | null }): Promise<string> {
  const rows = await query<{ id: string }>(
    "insert into market_events (at, title, impact, affects, created_by) values ($1, $2, $3, $4, $5) returning id",
    [e.at, e.title, e.impact, e.affects, e.createdBy]
  );
  return rows[0].id;
}

export async function deleteManualEvent(id: string): Promise<void> {
  await query("delete from market_events where id = $1", [id]);
}
