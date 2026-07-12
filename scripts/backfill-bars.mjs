// ─────────────────────────────────────────────────────────
// One-time bar history backfill.
// Pulls ~260 trading days of daily bars for every ticker in the
// universe (plus SPY/QQQ for the regime engine) from Polygon and
// upserts into daily_bars. Respects the free-tier 5 req/min limit.
// Usage: node scripts/backfill-bars.mjs
// ─────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = resolve(root, ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const DB_URL = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
const POLY_KEY = process.env.POLYGON_API_KEY;
if (!DB_URL || !POLY_KEY) {
  console.error("Need DATABASE_URL(_UNPOOLED) and POLYGON_API_KEY");
  process.exit(1);
}

const client = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const { rows: tickers } = await client.query("select symbol from tickers order by symbol");
const symbols = ["SPY", "QQQ", ...tickers.map((t) => t.symbol)];

const end = new Date().toISOString().slice(0, 10);
const start = new Date(Date.now() - 400 * 86400e3).toISOString().slice(0, 10);

// Free tier: 5 requests/minute. 13s spacing keeps us safely under.
const SPACING_MS = 13_000;
let done = 0;
let failed = [];

for (const sym of symbols) {
  const url = `https://api.polygon.io/v2/aggs/ticker/${sym}/range/1/day/${start}/${end}?adjusted=true&sort=asc&limit=5000&apiKey=${POLY_KEY}`;
  try {
    const res = await fetch(url);
    if (res.status === 429) {
      // Rate limited: wait a full minute and retry once.
      await new Promise((r) => setTimeout(r, 61_000));
      const retry = await fetch(url);
      if (!retry.ok) throw new Error(`retry ${retry.status}`);
      await upsert(sym, (await retry.json()).results ?? []);
    } else if (!res.ok) {
      throw new Error(`${res.status}`);
    } else {
      await upsert(sym, (await res.json()).results ?? []);
    }
    done++;
    console.log(`[${done}/${symbols.length}] ${sym} OK`);
  } catch (e) {
    failed.push(sym);
    console.log(`[${done}/${symbols.length}] ${sym} FAILED: ${e.message}`);
  }
  if (sym !== symbols[symbols.length - 1]) {
    await new Promise((r) => setTimeout(r, SPACING_MS));
  }
}

async function upsert(sym, bars) {
  if (!bars.length) return;
  // Batch insert with on-conflict upsert, 500 rows per statement.
  for (let i = 0; i < bars.length; i += 500) {
    const chunk = bars.slice(i, i + 500);
    const values = [];
    const params = [];
    chunk.forEach((b, j) => {
      const base = j * 8;
      values.push(
        `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8})`
      );
      params.push(
        sym,
        new Date(b.t).toISOString().slice(0, 10),
        b.o, b.h, b.l, b.c, b.v, b.vw ?? null
      );
    });
    await client.query(
      `insert into daily_bars (symbol, date, open, high, low, close, volume, vwap)
       values ${values.join(",")}
       on conflict (symbol, date) do update set
         open=excluded.open, high=excluded.high, low=excluded.low,
         close=excluded.close, volume=excluded.volume, vwap=excluded.vwap`,
      params
    );
  }
}

const { rows: [{ count }] } = await client.query("select count(*)::int as count from daily_bars");
console.log(`\nBackfill complete. ${done}/${symbols.length} symbols. Failed: ${failed.join(", ") || "none"}. Total bars: ${count}`);
await client.end();
