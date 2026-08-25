// ─────────────────────────────────────────────────────────
// Daily bar cache access + refresh.
// Reads cached OHLCV from Neon; refreshes the latest trading day for
// the ENTIRE universe with a single Polygon grouped-daily call.
// ─────────────────────────────────────────────────────────

import { query } from "./db";

export interface Bar {
  c: number;
  h: number;
  l: number;
  o: number;
  v: number;
  vw: number;
  t: number;
}

interface BarRow {
  symbol: string;
  date: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  vwap: string | null;
}

// Load bars for many symbols at once (ascending by date).
export async function loadBars(symbols: string[], days = 260): Promise<Map<string, Bar[]>> {
  if (symbols.length === 0) return new Map();
  const rows = await query<BarRow>(
    `select symbol, date::text, open, high, low, close, volume, vwap
     from (
       select *, row_number() over (partition by symbol order by date desc) rn
       from daily_bars where symbol = any($1)
     ) x where rn <= $2
     order by symbol, date asc`,
    [symbols, days]
  );
  const map = new Map<string, Bar[]>();
  for (const r of rows) {
    const arr = map.get(r.symbol) ?? [];
    arr.push({
      o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close),
      v: Number(r.volume), vw: r.vwap ? Number(r.vwap) : Number(r.close),
      t: new Date(r.date).getTime(),
    });
    map.set(r.symbol, arr);
  }
  return map;
}

// Append the most recent trading day for all tracked symbols.
// Stocks: ONE grouped call for the whole US market (last weekday).
// Crypto (X: prefixed): ONE grouped crypto call (trades 24/7, so the
// most recent complete UTC day). Returns the number of bars upserted.
export async function refreshLatestBars(trackedSymbols: string[]): Promise<number> {
  const key = process.env.POLYGON_API_KEY;
  if (!key || trackedSymbols.length === 0) return 0;

  const stockSymbols = trackedSymbols.filter((s) => !s.startsWith("X:"));
  const cryptoSymbols = trackedSymbols.filter((s) => s.startsWith("X:"));

  let upserted = 0;

  if (stockSymbols.length > 0) {
    // Most recent weekday (stock grouped data is EOD).
    const d = new Date();
    for (let i = 0; i < 5; i++) {
      d.setDate(d.getDate() - 1);
      const dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6) break;
    }
    upserted += await upsertGrouped(
      `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${d.toISOString().slice(0, 10)}?adjusted=true&apiKey=${key}`,
      stockSymbols,
      d.toISOString().slice(0, 10)
    );
  }

  if (cryptoSymbols.length > 0) {
    // Crypto trades every day; yesterday UTC is the last complete bar.
    const d = new Date(Date.now() - 86400e3);
    upserted += await upsertGrouped(
      `https://api.polygon.io/v2/aggs/grouped/locale/global/market/crypto/${d.toISOString().slice(0, 10)}?adjusted=true&apiKey=${key}`,
      cryptoSymbols
    );
  }

  return upserted;
}

async function upsertGrouped(url: string, wantedSymbols: string[], marketDate?: string): Promise<number> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return 0;
  const data = (await res.json()) as { results?: ({ T: string } & Bar)[] };

  // Keep the ENTIRE stock snapshot (~10k symbols) for whole-market
  // scanning; it was already downloaded, storing it costs no API calls.
  if (marketDate) await persistMarketDaily(data.results ?? [], marketDate);

  const wanted = new Set(wantedSymbols);
  const bars = (data.results ?? []).filter((b) => wanted.has(b.T));

  let upserted = 0;
  for (const b of bars) {
    await query(
      `insert into daily_bars (symbol, date, open, high, low, close, volume, vwap)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (symbol, date) do update set
         open=excluded.open, high=excluded.high, low=excluded.low,
         close=excluded.close, volume=excluded.volume, vwap=excluded.vwap`,
      [b.T, new Date(b.t).toISOString().slice(0, 10), b.o, b.h, b.l, b.c, b.v, b.vw ?? b.c]
    );
    upserted++;
  }
  return upserted;
}

// Whole-market snapshot persistence with ~130-day retention (enough
// for a 20-day RVOL baseline plus history, small enough for Neon free).
async function persistMarketDaily(results: ({ T: string } & Bar)[], date: string): Promise<void> {
  const rows = results.filter((b) => /^[A-Z]{1,5}$/.test(b.T));
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((b, j) => {
      const base = j * 7;
      values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`);
      params.push(b.T, date, b.o, b.h, b.l, b.c, Math.round(b.v));
    });
    if (values.length) {
      await query(
        `insert into market_daily (symbol, date, open, high, low, close, volume)
         values ${values.join(",")}
         on conflict (symbol, date) do update set
           open=excluded.open, high=excluded.high, low=excluded.low,
           close=excluded.close, volume=excluded.volume`,
        params
      );
    }
  }
  await query(`delete from market_daily where date < (select max(date) from market_daily) - interval '130 days'`);
}
