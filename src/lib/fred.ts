// ─────────────────────────────────────────────────────────
// FRED (Federal Reserve Economic Data) client — free macro data.
// Used by the regime engine for VIX, Treasury yields, dollar index.
// Degrades to null if FRED_API_KEY is unset.
// ─────────────────────────────────────────────────────────

import { fetchJson } from "@/providers/http";

const BASE = "https://api.stlouisfed.org/fred";

export function hasFredKey(): boolean {
  return Boolean(process.env.FRED_API_KEY);
}

// Series IDs we care about.
export const FRED_SERIES = {
  VIX: "VIXCLS", // CBOE Volatility Index
  TEN_YEAR: "DGS10", // 10-Year Treasury yield
  TWO_YEAR: "DGS2", // 2-Year Treasury yield
  DOLLAR: "DTWEXBGS", // Broad Dollar Index
} as const;

// Latest non-null observation for a series.
export async function getLatestSeriesValue(seriesId: string): Promise<number | null> {
  const key = process.env.FRED_API_KEY;
  if (!key) return null;
  const url = new URL(`${BASE}/series/observations`);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", key);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", "5");
  const result = await fetchJson<{ observations?: { value: string }[] }>(url.toString(), {
    source: "FRED (St. Louis Fed)",
    revalidateSeconds: 1800,
    timeoutMs: 8_000,
    retries: 2,
  });
  if (!result.ok || !result.data) return null;
  for (const o of result.data.observations ?? []) {
    const v = parseFloat(o.value);
    if (!Number.isNaN(v)) return v;
  }
  return null;
}

export async function getVix(): Promise<number | null> {
  return getLatestSeriesValue(FRED_SERIES.VIX);
}
