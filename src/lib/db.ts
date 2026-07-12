// ─────────────────────────────────────────────────────────
// Postgres client (Neon).
// Single pooled connection, lazily created. Degrades to "not configured"
// when DATABASE_URL is unset so the rest of the app can fall back to
// mock data instead of throwing.
// ─────────────────────────────────────────────────────────

import { Pool, type QueryResultRow } from "pg";

let pool: Pool | null = null;

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // Neon requires TLS; sslmode=require is in the URL
      max: 5,
    });
  }
  return pool;
}

// Returns [] when the database isn't configured — callers should treat
// an empty result the same as "no live data yet" and fall back to mock.
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  if (!hasDatabase()) return [];
  const client = await getPool().connect();
  try {
    const res = await client.query<T>(text, params);
    return res.rows;
  } finally {
    client.release();
  }
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
