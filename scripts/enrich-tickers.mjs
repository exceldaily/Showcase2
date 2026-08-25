// ─────────────────────────────────────────────────────────
// Ticker enrichment from Polygon's FREE reference endpoint.
// Fills sector (SIC description), market cap and shares outstanding
// for tracked tickers. Shares outstanding is stored as-is; the app
// uses it as a CONSERVATIVE float proxy (outstanding >= float, so
// "outstanding < 20M" guarantees "float < 20M").
// ~13s per symbol on the free tier; run in the background.
// Usage: node scripts/enrich-tickers.mjs [onlyMissing=true]
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
const ONLY_MISSING = (process.argv[2] ?? "true") !== "false";
if (!DB_URL || !KEY) {
  console.error("Need DATABASE_URL(_UNPOOLED) and POLYGON_API_KEY");
  process.exit(1);
}

const client = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const { rows } = await client.query(
  ONLY_MISSING
    ? `select symbol from tickers
       where symbol not like 'X:%'
         and (shares_outstanding is null or market_cap is null or sector = 'General' or sector is null)
       order by symbol`
    : `select symbol from tickers where symbol not like 'X:%' order by symbol`
);
console.log(`Enriching ${rows.length} tickers...`);

let ok = 0, failed = 0;
for (const { symbol } of rows) {
  const url = `https://api.polygon.io/v3/reference/tickers/${encodeURIComponent(symbol)}?apiKey=${KEY}`;
  try {
    let r = await fetch(url);
    if (r.status === 429) {
      await new Promise((x) => setTimeout(x, 61_000));
      r = await fetch(url);
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const t = (await r.json()).results;
    if (!t) throw new Error("no results");
    const shares = t.weighted_shares_outstanding ?? t.share_class_shares_outstanding ?? null;
    await client.query(
      `update tickers set
         company_name = coalesce(nullif($2, ''), company_name),
         sector = case when sector is null or sector = 'General' then coalesce(nullif($3, ''), sector) else sector end,
         exchange = coalesce(nullif($4, ''), exchange),
         market_cap = coalesce($5, market_cap),
         shares_outstanding = coalesce($6, shares_outstanding)
       where symbol = $1`,
      [symbol, t.name ?? "", t.sic_description ?? "", t.primary_exchange ?? "", t.market_cap ?? null, shares]
    );
    ok++;
    if (ok % 25 === 0) console.log(`[${ok}/${rows.length}] enriched`);
  } catch (e) {
    failed++;
    console.log(`${symbol} FAILED: ${e.message}`);
  }
  await new Promise((x) => setTimeout(x, 13_000));
}

const { rows: [s] } = await client.query(
  `select count(*) filter (where shares_outstanding is not null)::int as with_shares,
          count(*) filter (where sector is not null and sector <> 'General')::int as with_sector,
          count(*)::int as total
   from tickers where symbol not like 'X:%'`
);
console.log(`Enrichment done: ${ok} updated, ${failed} failed. ${s.with_shares}/${s.total} have shares outstanding, ${s.with_sector}/${s.total} have a real sector.`);
await client.end();
