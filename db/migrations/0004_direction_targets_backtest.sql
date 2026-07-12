-- ─────────────────────────────────────────────────────────
-- 0004: short setups, documented targets, backtest stats
-- ─────────────────────────────────────────────────────────

-- Long/Short direction on every setup
alter table trade_setups add column if not exists direction text not null default 'Long';

-- Documented method + evidence for each target and the stop
alter table trade_setups add column if not exists target_basis_1 text;
alter table trade_setups add column if not exists target_basis_2 text;
alter table trade_setups add column if not exists target_basis_3 text;

-- Aggregated backtest results per setup type + direction
create table if not exists backtest_stats (
  id            uuid primary key default gen_random_uuid(),
  run_at        timestamptz default now(),
  lookback_days int,
  setup_type    text not null,
  direction     text not null,
  signals       int not null,
  wins          int not null,
  losses        int not null,
  win_rate      numeric,
  avg_r         numeric,      -- average result in R multiples
  profit_factor numeric,      -- gross positive R / gross negative R
  avg_hold_days numeric,
  notes         text
);
create index if not exists idx_backtest_run on backtest_stats(run_at desc);
