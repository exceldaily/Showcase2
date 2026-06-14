-- ─────────────────────────────────────────────────────────
-- AlphaForge — Phase 1 schema
-- Run in the Supabase SQL editor (or via the Supabase CLI).
-- ─────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ── Ticker universe ──
create table if not exists tickers (
  id            uuid primary key default gen_random_uuid(),
  symbol        text unique not null,
  company_name  text,
  sector        text,
  subsector     text,
  ipo_date      date,
  market_cap    numeric,
  float_shares  numeric,
  avg_volume_30d numeric,
  is_ipo_36mo   boolean default false,
  exchange      text,
  last_updated  timestamptz default now()
);

-- ── Market snapshots (every 15 min, market hours) ──
create table if not exists market_snapshots (
  id          uuid primary key default gen_random_uuid(),
  ticker_id   uuid references tickers(id) on delete cascade,
  ts          timestamptz default now(),
  price       numeric, open numeric, high numeric, low numeric, close numeric,
  volume      numeric, rel_volume numeric,
  vwap        numeric, ema9 numeric, ema20 numeric, ema50 numeric, ema200 numeric,
  atr14       numeric, rsi14 numeric,
  above_50d   boolean, above_200d boolean
);
create index if not exists idx_snapshots_ticker_ts on market_snapshots(ticker_id, ts desc);

-- ── Catalyst events (news + filings) ──
create table if not exists catalyst_events (
  id            uuid primary key default gen_random_uuid(),
  ticker_id     uuid references tickers(id) on delete cascade,
  source        text,
  headline      text,
  url           text,
  published_at  timestamptz,
  fetched_at    timestamptz default now(),
  catalyst_level int check (catalyst_level between 1 and 4),
  catalyst_type text,
  ai_summary    text,
  ai_reasoning  text,
  processed     boolean default false
);
create index if not exists idx_catalyst_ticker on catalyst_events(ticker_id, published_at desc);

-- ── Scores ──
create table if not exists scores (
  id            uuid primary key default gen_random_uuid(),
  ticker_id     uuid references tickers(id) on delete cascade,
  snapshot_id   uuid references market_snapshots(id) on delete set null,
  scored_at     timestamptz default now(),
  catalyst_score numeric, smart_money_score numeric, technical_score numeric,
  sector_strength_score numeric, market_regime_score numeric,
  alphaforge_score numeric, confidence_score numeric,
  institutional_accum numeric, revenue_growth numeric, earnings_growth numeric,
  rel_volume_score numeric, insider_buying_score numeric, news_catalyst_score numeric,
  sector_strength_raw numeric
);

-- ── Trade setups (score >= 80) ──
create table if not exists trade_setups (
  id              uuid primary key default gen_random_uuid(),
  ticker_id       uuid references tickers(id) on delete cascade,
  score_id        uuid references scores(id) on delete set null,
  catalyst_event_id uuid references catalyst_events(id) on delete set null,
  generated_at    timestamptz default now(),
  opportunity_type text,
  setup_type      text,
  market_regime   text,
  entry_zone_low  numeric, entry_zone_high numeric,
  entry_aggressive numeric, entry_conservative numeric,
  stop_loss       numeric, stop_basis text,
  target_1 numeric, target_2 numeric, target_3 numeric,
  expected_pct_move numeric, expected_hold_days int,
  risk_reward_ratio numeric, risk_rating text,
  bull_thesis text, bear_thesis text,
  decision        text,
  is_active       boolean default true,
  expired_at      timestamptz
);
create index if not exists idx_setups_active on trade_setups(is_active, generated_at desc);

-- ── Paper trades ──
create table if not exists paper_trades (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid,
  setup_id      uuid references trade_setups(id) on delete set null,
  ticker_id     uuid references tickers(id) on delete cascade,
  opened_at     timestamptz default now(),
  closed_at     timestamptz,
  entry_price   numeric, exit_price numeric,
  shares        numeric, position_value numeric,
  stop_loss     numeric, target_hit int,
  status        text,  -- Open | ClosedWin | ClosedLoss | StopHit | ManualClose
  pnl_dollars   numeric, pnl_pct numeric,
  hold_days     int, exit_reason text
);

-- ── Daily performance snapshot ──
create table if not exists paper_performance (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid,
  date          date,
  total_trades  int, wins int, losses int,
  win_rate numeric, avg_win_pct numeric, avg_loss_pct numeric,
  profit_factor numeric, max_drawdown numeric, expectancy numeric, total_pnl numeric,
  best_sector text, worst_sector text,
  best_setup_type text, worst_setup_type text
);

-- ── Market regime log ──
create table if not exists market_regime_log (
  id            uuid primary key default gen_random_uuid(),
  ts            timestamptz default now(),
  spy_trend text, qqq_trend text,
  vix_level numeric, breadth_score numeric,
  sector_rotation_signal text,
  regime text, trade_gate text
);

-- ── Sector strength daily ──
create table if not exists sector_strength_daily (
  id            uuid primary key default gen_random_uuid(),
  date          date,
  sector        text,
  score         numeric, rank int,
  momentum_5d numeric, momentum_20d numeric,
  unique (date, sector)
);

-- ── Institutional holdings (13F) ──
create table if not exists institutional_holdings (
  id            uuid primary key default gen_random_uuid(),
  ticker_id     uuid references tickers(id) on delete cascade,
  filer_name text, cik text,
  report_date date, shares_held numeric,
  pct_change_qoq numeric, is_new_position boolean
);

-- ── IPO tracker ──
create table if not exists ipo_tracker (
  id            uuid primary key default gen_random_uuid(),
  ticker_id     uuid references tickers(id) on delete cascade,
  ipo_date date, lockup_expiry date,
  offering_price numeric, first_close numeric,
  lockup_expired boolean default false,
  insider_selling_detected boolean default false,
  institutional_participation_score numeric
);

-- ── Self-learning reports (30-day) ──
create table if not exists learning_reports (
  id            uuid primary key default gen_random_uuid(),
  generated_at  timestamptz default now(),
  period_start date, period_end date,
  total_setups int, qualified_setups int,
  win_rate numeric, avg_rr_realized numeric,
  best_catalyst_types jsonb, worst_catalyst_types jsonb,
  best_sectors jsonb, worst_sectors jsonb,
  best_setup_types jsonb, worst_setup_types jsonb,
  best_market_regimes jsonb, worst_market_regimes jsonb,
  score_weight_recommendations jsonb,
  notes text
);

-- ── User watchlists ──
create table if not exists user_watchlists (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid,
  ticker_id     uuid references tickers(id) on delete cascade,
  added_at      timestamptz default now(),
  notes         text
);
