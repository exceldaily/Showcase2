// Seeds default universes + scanner presets (idempotent).
// Usage: node scripts/seed-terminal.mjs
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

const DB = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
const client = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
await client.connect();

// Universes and presets mirror src/lib/universe.ts. Kept in sync manually
// because the seeder is plain node (no TS transpile step).
const UNIVERSES = [
  ["low-price", "Low Price", 0.25, 5, 500000, "$0.25–$5. Small caps and momentum runners. Higher volatility and spread risk."],
  ["small-cap-momentum", "Small-Cap Momentum", 1, 20, 1000000, "$1–$20 with meaningful liquidity."],
  ["mid-price-momentum", "Mid-Price Momentum", 5, 50, 2000000, "$5–$50 momentum names."],
  ["large-cap", "Large Cap", 20, null, 10000000, "$20+ established liquid names."],
  ["all-stocks", "All Stocks", 0.25, null, 250000, "Everything above the minimum liquidity floor."],
];

for (const [slug, name, minP, maxP, minDv, desc] of UNIVERSES) {
  await client.query(
    `insert into universes (user_id, slug, name, min_price, max_price, min_dollar_volume, description, is_default)
     values (null,$1,$2,$3,$4,$5,$6,true)
     on conflict (user_id, slug) do update set
       name=excluded.name, min_price=excluded.min_price, max_price=excluded.max_price,
       min_dollar_volume=excluded.min_dollar_volume, description=excluded.description`,
    [slug, name, minP, maxP, minDv, desc]
  );
}

const PRESETS = [
  ["premarket-gappers","Premarket Gappers","all-stocks","Stocks gapping before the open on premarket volume.",
   {logic:"AND",conditions:[{field:"gapPct",op:"gte",value:5},{field:"premarketVolume",op:"gte",value:50000},{field:"price",op:"gte",value:0.5}]},
   ["symbol","price","gapPct","premarketChangePct","premarketVolume","floatShares","rvol","marketCap","catalystStatus"]],
  ["low-float-under-5","Low Float Under $5","low-price","Editable defaults: $0.50–$5, float under 50M, +10% day, RVOL 2+.",
   {logic:"AND",conditions:[{field:"price",op:"between",value:0.5,value2:5},{field:"floatShares",op:"lt",value:50000000},{field:"changePct",op:"gte",value:10},{field:"rvol",op:"gte",value:2}]},
   ["symbol","price","changePct","floatShares","rvol","volume","atrPct","catalystStatus","dilutionRisk"]],
  ["high-rvol","High RVOL","all-stocks","Unusual volume relative to the 30-day average.",
   {logic:"AND",conditions:[{field:"rvol",op:"gte",value:3},{field:"price",op:"gte",value:0.25},{field:"dollarVolume",op:"gte",value:1000000}]},
   ["symbol","price","changePct","volume","rvol","atrPct","vwapDistancePct","sector"]],
  ["hod-break","High Of Day Break","all-stocks","Trading at or breaking the intraday high.",
   {logic:"AND",conditions:[{field:"hodDistancePct",op:"lte",value:1},{field:"changePct",op:"gte",value:3},{field:"rvol",op:"gte",value:2}]},
   ["symbol","price","changePct","hodDistancePct","rvol","volumeAcceleration","vwapDistancePct","catalystStatus"]],
  ["vwap-reclaim","VWAP Reclaim","all-stocks","Price reclaiming VWAP with the EMA stack aligned.",
   {logic:"AND",conditions:[{field:"vwapState",op:"eq",value:"Reclaim"},{field:"emaState",op:"in",values:["9>20>50","9>20"]},{field:"rvol",op:"gte",value:1.5}]},
   ["symbol","price","changePct","volume","rvol","atrPct","vwapDistancePct","sector"]],
  ["volume-surge","Volume Surge","all-stocks","Volume accelerating well above its normal pace.",
   {logic:"AND",conditions:[{field:"volumeAcceleration",op:"gte",value:3},{field:"changePct",op:"gte",value:2}]},
   ["symbol","price","changePct","volumeAcceleration","volumeVelocity1m","rvol","catalystStatus"]],
  ["large-cap-momentum","Large Cap Momentum","large-cap","Liquid large caps trending with the EMA stack and above VWAP.",
   {logic:"AND",conditions:[{field:"emaState",op:"eq",value:"9>20>50"},{field:"vwapDistancePct",op:"gte",value:0},{field:"rvol",op:"gte",value:1.2},{field:"aboveSma200",op:"isTrue"}]},
   ["symbol","price","changePct","volume","rvol","atrPct","vwapDistancePct","sector"]],
  ["coiled-breakout","Coiled / Primed To Break","all-stocks","Tight coil under resistance with EMA 9>20>50 and rising VWAP.",
   {logic:"AND",conditions:[{field:"emaState",op:"eq",value:"9>20>50"},{field:"coilPct",op:"lte",value:9},{field:"vwapDistancePct",op:"gte",value:0}]},
   ["symbol","price","changePct","coilPct","rvol","vwapDistancePct","setupScore","sector"]],
  ["oversold-reversal","Oversold Reversal","all-stocks","Washed-out RSI with volume returning.",
   {logic:"AND",conditions:[{field:"rsi14",op:"lte",value:32},{field:"rvol",op:"gte",value:1.5},{field:"price",op:"gte",value:1}]},
   ["symbol","price","changePct","volume","rvol","atrPct","vwapDistancePct","sector"]],
];

for (const [slug, name, universe, desc, rules, columns] of PRESETS) {
  await client.query(
    `insert into scanner_presets (user_id, slug, name, description, universe_slug, rules, columns, is_default, sort_field, sort_dir)
     values (null,$1,$2,$3,$4,$5::jsonb,$6::jsonb,true,'rvol','desc')
     on conflict (user_id, slug) do update set
       name=excluded.name, description=excluded.description, universe_slug=excluded.universe_slug,
       rules=excluded.rules, columns=excluded.columns, updated_at=now()`,
    [slug, name, desc, universe, JSON.stringify(rules), JSON.stringify(columns)]
  );
}

const { rows: [{ u }] } = await client.query("select count(*)::int u from universes");
const { rows: [{ p }] } = await client.query("select count(*)::int p from scanner_presets");
console.log(`Seeded. Universes: ${u}, scanner presets: ${p}`);
await client.end();
