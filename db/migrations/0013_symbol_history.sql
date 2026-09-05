-- ─────────────────────────────────────────────────────────
-- 0013: Per-symbol history stats from Alpaca minute data.
-- volume_profile: 26 cumulative RTH volume fractions (15-min bins).
-- stats: breakout backtest summary (setups/confirmed/t1Hit/failed...).
-- Recomputed at most once per ~20 hours per symbol, on demand.
-- ─────────────────────────────────────────────────────────

create table if not exists symbol_history (
  symbol          text primary key,
  computed_at     timestamptz not null default now(),
  sessions        int not null default 0,
  volume_profile  jsonb,
  stats           jsonb not null default '{}'::jsonb
);
