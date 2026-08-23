// ─────────────────────────────────────────────────────────
// Universe expansion.
// 1. One grouped call ranks the entire US market by dollar volume.
// 2. Top N liquid common-ticker symbols not already tracked are added
//    with sector 'General' (sector strength computes from their own
//    momentum bucket; Polygon reference enrichment can come later).
// 3. Bar history is backfilled for the new symbols (rate-limit aware,
//    ~13s per symbol on the free tier).
// Usage: node scripts/expand-universe.mjs [count]
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
const KEY = process.env.POLYGON_API_KEY;
const COUNT = parseInt(process.argv[2] ?? "250", 10);
// Optional price band: node scripts/expand-universe.mjs 150 1 20
const MIN_PRICE = parseFloat(process.argv[3] ?? "5");
const MAX_PRICE = process.argv[4] !== undefined ? parseFloat(process.argv[4]) : Infinity;
if (!DB_URL || !KEY) {
  console.error("Need DATABASE_URL(_UNPOOLED) and POLYGON_API_KEY");
  process.exit(1);
}

const client = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

// Most recent weekday
const d = new Date();
for (let i = 0; i < 5; i++) {
  d.setDate(d.getDate() - 1);
  const dow = d.getUTCDay();
  if (dow !== 0 && dow !== 6) break;
}
const date = d.toISOString().slice(0, 10);

console.log(`Fetching grouped daily for ${date}...`);
const res = await fetch(
  `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&apiKey=${KEY}`
);
if (!res.ok) {
  console.error(`Grouped call failed: ${res.status}`);
  process.exit(1);
}
const data = await res.json();

const { rows: existing } = await client.query("select symbol from tickers");
const have = new Set(existing.map((r) => r.symbol));

const candidates = (data.results ?? [])
  .filter((b) => /^[A-Z]{1,5}$/.test(b.T)) // plain common tickers only
  .filter((b) => b.c >= MIN_PRICE && b.c <= MAX_PRICE)
  .filter((b) => !have.has(b.T))
  .map((b) => ({ symbol: b.T, dollarVol: b.c * b.v }))
  .sort((a, b) => b.dollarVol - a.dollarVol)
  .slice(0, COUNT);

console.log(`Adding ${candidates.length} symbols priced $${MIN_PRICE}–${MAX_PRICE === Infinity ? "∞" : MAX_PRICE} (top by dollar volume, excluding ${have.size} existing)...`);

for (const c of candidates) {
  await client.query(
    `insert into tickers (symbol, company_name, sector, exchange, is_ipo_36mo)
     values ($1, $1, 'General', null, false)
     on conflict (symbol) do nothing`,
    [c.symbol]
  );
}

// Backfill bars for the new symbols
const end = new Date().toISOString().slice(0, 10);
const start = new Date(Date.now() - 400 * 86400e3).toISOString().slice(0, 10);
let done = 0;
let failed = 0;

for (const c of candidates) {
  const url = `https://api.polygon.io/v2/aggs/ticker/${c.symbol}/range/1/day/${start}/${end}?adjusted=true&sort=asc&limit=5000&apiKey=${KEY}`;
  try {
    let r = await fetch(url);
    if (r.status === 429) {
      await new Promise((x) => setTimeout(x, 61_000));
      r = await fetch(url);
    }
    if (!r.ok) throw new Error(String(r.status));
    const bars = (await r.json()).results ?? [];
    for (let i = 0; i < bars.length; i += 500) {
      const chunk = bars.slice(i, i + 500);
      const values = [];
      const params = [];
      chunk.forEach((b, j) => {
        const base = j * 8;
        values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8})`);
        params.push(c.symbol, new Date(b.t).toISOString().slice(0, 10), b.o, b.h, b.l, b.c, b.v, b.vw ?? null);
      });
      if (values.length) {
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
    done++;
    if (done % 25 === 0) console.log(`[${done}/${candidates.length}] backfilled`);
  } catch (e) {
    failed++;
    console.log(`${c.symbol} FAILED: ${e.message}`);
  }
  await new Promise((x) => setTimeout(x, 13_000));
}

const { rows: [{ syms, bars }] } = await client.query(
  "select count(distinct symbol)::int as syms, count(*)::int as bars from daily_bars"
);
console.log(`\nExpansion complete. ${done} backfilled, ${failed} failed. Universe bars: ${syms} symbols, ${bars} rows.`);
await client.end();
