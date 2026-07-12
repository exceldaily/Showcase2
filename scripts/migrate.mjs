// ─────────────────────────────────────────────────────────
// One-shot migration runner.
// Usage: node scripts/migrate.mjs
// Reads DATABASE_URL_UNPOOLED (preferred for DDL) or DATABASE_URL
// from the environment / .env.local and applies db/migrations + db/seed.
// ─────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Minimal .env.local loader (no dotenv dependency needed)
const envFile = resolve(root, ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("No DATABASE_URL/_UNPOOLED found in env or .env.local");
  process.exit(1);
}

const files = [
  "db/migrations/0001_init.sql",
  "db/seed/tickers.sql",
];

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log("Connected to", new URL(url).hostname);

for (const f of files) {
  const sql = readFileSync(resolve(root, f), "utf8");
  process.stdout.write(`Running ${f} ... `);
  await client.query(sql);
  console.log("OK");
}

// Verify
const { rows: tables } = await client.query(
  "select table_name from information_schema.tables where table_schema='public' order by table_name"
);
const { rows: [{ count }] } = await client.query("select count(*)::int as count from tickers");
console.log(`\nTables created (${tables.length}):`, tables.map((t) => t.table_name).join(", "));
console.log(`Tickers seeded: ${count}`);

await client.end();
