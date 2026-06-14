// ─────────────────────────────────────────────────────────
// Polygon.io market-data client
// Gracefully degrades: if POLYGON_API_KEY is unset, callers should
// fall back to mock data. No throwing on missing key.
// ─────────────────────────────────────────────────────────

const BASE = "https://api.polygon.io";

export function hasPolygonKey(): boolean {
  return Boolean(process.env.POLYGON_API_KEY);
}

interface AggBar {
  c: number; // close
  h: number; // high
  l: number; // low
  o: number; // open
  v: number; // volume
  vw: number; // volume-weighted avg price
  t: number; // timestamp ms
}

async function polyFetch<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  const key = process.env.POLYGON_API_KEY;
  if (!key) return null;
  const url = new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set("apiKey", key);
  try {
    const res = await fetch(url.toString(), { next: { revalidate: 60 } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// Daily bars for the last N days — used for MAs, ATR, rel-volume.
export async function getDailyBars(symbol: string, days = 220): Promise<AggBar[] | null> {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - Math.ceil(days * 1.5)); // pad for weekends/holidays
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const data = await polyFetch<{ results?: AggBar[] }>(
    `/v2/aggs/ticker/${symbol}/range/1/day/${fmt(start)}/${fmt(end)}`,
    { adjusted: "true", sort: "asc", limit: "5000" }
  );
  return data?.results ?? null;
}

export interface SnapshotMetrics {
  symbol: string;
  price: number;
  volume: number;
  avgVolume: number;
  relVolume: number;
  vwap: number;
  ema9: number;
  ema20: number;
  ema50: number;
  ema200: number;
  atr14: number;
  rsi14: number;
  above50d: boolean;
  above200d: boolean;
}

export async function getSnapshotMetrics(symbol: string): Promise<SnapshotMetrics | null> {
  const bars = await getDailyBars(symbol);
  if (!bars || bars.length < 20) return null;
  return computeMetricsFromBars(symbol, bars);
}

export function computeMetricsFromBars(symbol: string, bars: AggBar[]): SnapshotMetrics {
  const closes = bars.map((b) => b.c);
  const last = bars[bars.length - 1];
  const vols = bars.map((b) => b.v);
  const avgVolume = mean(vols.slice(-30));

  return {
    symbol,
    price: last.c,
    volume: last.v,
    avgVolume,
    relVolume: avgVolume > 0 ? round2(last.v / avgVolume) : 0,
    vwap: last.vw,
    ema9: ema(closes, 9),
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    ema200: ema(closes, 200),
    atr14: atr(bars, 14),
    rsi14: rsi(closes, 14),
    above50d: last.c > ema(closes, 50),
    above200d: last.c > ema(closes, 200),
  };
}

// ── indicator math ──
function ema(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const slice = values.slice(-Math.max(period * 3, period));
  const k = 2 / (period + 1);
  let e = slice[0];
  for (let i = 1; i < slice.length; i++) e = slice[i] * k + e * (1 - k);
  return round2(e);
}

function rsi(values: number[], period = 14): number {
  if (values.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return round2(100 - 100 / (1 + rs));
}

function atr(bars: AggBar[], period = 14): number {
  if (bars.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = bars.length - period; i < bars.length; i++) {
    const cur = bars[i];
    const prev = bars[i - 1];
    trs.push(
      Math.max(cur.h - cur.l, Math.abs(cur.h - prev.c), Math.abs(cur.l - prev.c))
    );
  }
  return round2(mean(trs));
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
