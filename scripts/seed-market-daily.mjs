// ─────────────────────────────────────────────────────────
// Seed market_daily with past whole-market snapshots.
// One grouped call per weekday (free tier: 5 calls/min), so a
// 75-session backfill takes ~17 minutes and gives every US stock a
// 20-day RVOL baseline immediately.
// Usage: node scripts/seed-market-daily.mjs [weekdays=75]
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
const DAYS = parseInt(process.argv[2] ?? "75", 10);
if (!DB_URL || !KEY) {
  console.error("Need DATABASE_URL(_UNPOOLED) and POLYGON_API_KEY");
  process.exit(1);
}

const client = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const { rows: haveRows } = await client.query("select distinct date::text as d from market_daily");
const have = new Set(haveRows.map((r) => r.d));

// Walk back DAYS weekdays from yesterday.
const dates = [];
const d = new Date();
while (dates.length < DAYS) {
  d.setDate(d.getDate() - 1);
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) continue;
  dates.push(d.toISOString().slice(0, 10));
}

let ok = 0, skipped = 0, holidays = 0;
for (const date of dates) {
  if (have.has(date)) { skipped++; continue; }
  const url = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&apiKey=${KEY}`;
  let r = await fetch(url);
  if (r.status === 429) {
    await new Promise((x) => setTimeout(x, 61_000));
    r = await fetch(url);
  }
  if (!r.ok) {
    console.log(`${date} FAILED: HTTP ${r.status}`);
    await new Promise((x) => setTimeout(x, 13_000));
    continue;
  }
  const results = (await r.json()).results ?? [];
  const bars = results.filter((b) => /^[A-Z]{1,5}$/.test(b.T));
  if (!bars.length) { holidays++; await new Promise((x) => setTimeout(x, 13_000)); continue; }

  for (let i = 0; i < bars.length; i += 1000) {
    const chunk = bars.slice(i, i + 1000);
    const values = [];
    const params = [];
    chunk.forEach((b, j) => {
      const base = j * 7;
      values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`);
      params.push(b.T, date, b.o, b.h, b.l, b.c, Math.round(b.v));
    });
    await client.query(
      `insert into market_daily (symbol, date, open, high, low, close, volume)
       values ${values.join(",")}
       on conflict (symbol, date) do update set
         open=excluded.open, high=excluded.high, low=excluded.low,
         close=excluded.close, volume=excluded.volume`,
      params
    );
  }
  ok++;
  if (ok % 10 === 0) console.log(`[${ok}] sessions stored (latest ${date}, ${bars.length} symbols)`);
  await new Promise((x) => setTimeout(x, 13_000));
}

const { rows: [s] } = await client.query(
  "select count(distinct date)::int as days, count(*)::int as rows from market_daily"
);
console.log(`Seed done: +${ok} sessions (${skipped} already present, ${holidays} holidays). market_daily: ${s.days} days, ${s.rows} rows.`);
await client.end();
