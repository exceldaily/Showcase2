-- ─────────────────────────────────────────────────────────
-- 0008: terminal core (spec §39)
-- Universes, scanner presets/rules/columns, watchlists, workspaces,
-- user settings, notes, journal, alert rules + events.
-- Market ticks are NOT stored here (transient state stays in memory).
-- ─────────────────────────────────────────────────────────

-- ── Reference data on tickers ──
alter table tickers add column if not exists industry text;
alter table tickers add column if not exists shares_outstanding numeric;
alter table tickers add column if not exists is_active boolean default true;
alter table tickers add column if not exists last_reference_sync timestamptz;

-- ── Configurable universes (spec §2) ──
create table if not exists universes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references users(id) on delete cascade,
  slug            text not null,
  name            text not null,
  min_price       numeric not null default 0.25,
  max_price       numeric,
  min_dollar_volume numeric not null default 250000,
  description     text,
  is_default      boolean default false,
  created_at      timestamptz default now(),
  unique (user_id, slug)
);

-- ── Scanner presets + rules + columns (spec §19-21) ──
create table if not exists scanner_presets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references users(id) on delete cascade,
  slug          text not null,
  name          text not null,
  description   text,
  universe_slug text,
  /* Rule tree: {logic, conditions[], groups[]} */
  rules         jsonb not null default '{"logic":"AND","conditions":[]}'::jsonb,
  /* Ordered column keys */
  columns       jsonb not null default '[]'::jsonb,
  sort_field    text,
  sort_dir      text default 'desc',
  is_default    boolean default false,
  is_enabled    boolean default true,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique (user_id, slug)
);
create index if not exists idx_scanner_presets_user on scanner_presets(user_id, is_enabled);

-- Latest match set per scanner (refreshed each scan; not a tick log).
create table if not exists scanner_results (
  id            uuid primary key default gen_random_uuid(),
  preset_id     uuid references scanner_presets(id) on delete cascade,
  scan_at       timestamptz default now(),
  symbol        text not null,
  metrics       jsonb not null default '{}'::jsonb,
  explain       jsonb not null default '[]'::jsonb,
  rank          int
);
create index if not exists idx_scanner_results_preset on scanner_results(preset_id, scan_at desc);

-- ── Watchlists (spec §22) ──
create table if not exists watchlists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references users(id) on delete cascade,
  name        text not null,
  sort_order  int default 0,
  created_at  timestamptz default now()
);

create table if not exists watchlist_items (
  id            uuid primary key default gen_random_uuid(),
  watchlist_id  uuid references watchlists(id) on delete cascade,
  symbol        text not null,
  notes         text,
  tags          text[],
  added_from    text,           -- scanner slug or 'manual'
  sort_order    int default 0,
  added_at      timestamptz default now(),
  unique (watchlist_id, symbol)
);

-- ── Workspaces / layouts (spec §32) ──
create table if not exists workspaces (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references users(id) on delete cascade,
  name        text not null,
  slug        text not null,
  /* Panel tree: sizes, positions, chart timeframes, scanner ids */
  layout      jsonb not null default '{}'::jsonb,
  is_default  boolean default false,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (user_id, slug)
);

-- ── User settings (spec §39) ──
create table if not exists user_settings (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references users(id) on delete cascade unique,
  account_size      numeric default 25000,
  max_risk_dollars  numeric default 150,
  max_risk_pct      numeric default 0.5,
  default_universe  text default 'all-stocks',
  chart_prefs       jsonb default '{}'::jsonb,
  indicator_prefs   jsonb default '{}'::jsonb,
  hotkeys           jsonb default '{}'::jsonb,
  float_thresholds  jsonb default '{"ultraLow":5000000,"low":20000000,"moderate":50000000}'::jsonb,
  updated_at        timestamptz default now()
);

-- ── Notes + journal (spec §42) ──
create table if not exists stock_notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references users(id) on delete cascade,
  symbol      text not null,
  body        text not null,
  created_at  timestamptz default now()
);

create table if not exists journal_entries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references users(id) on delete cascade,
  symbol        text not null,
  trade_date    date,
  entry_price   numeric,
  exit_price    numeric,
  shares        numeric,
  pnl           numeric,
  setup         text,
  scanner_source text,
  screenshot_url text,
  notes         text,
  mistakes      text,
  emotion       text,
  catalyst      text,
  tags          text[],
  /* auto-attached context: spy trend, sector, rvol, float, setup score */
  market_context jsonb default '{}'::jsonb,
  created_at    timestamptz default now()
);
create index if not exists idx_journal_user_date on journal_entries(user_id, trade_date desc);

-- ── Alert rules + events (spec §29, §30) ──
create table if not exists alert_rules (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references users(id) on delete cascade,
  name            text not null,
  symbol          text,              -- null = applies to scanner matches
  preset_id       uuid references scanner_presets(id) on delete set null,
  trigger_type    text not null,     -- price | pctChange | rvol | vwapReclaim | hodBreak | emaCross | volumeAccel | catalyst | halt | setup | enterScanner | exitScanner
  params          jsonb default '{}'::jsonb,
  /* cooldown + state-change rules so alerts don't spam (spec §30) */
  cooldown_seconds int default 300,
  reset_rule      jsonb default '{}'::jsonb,
  sound           boolean default true,
  browser_push    boolean default false,
  is_enabled      boolean default true,
  created_at      timestamptz default now()
);

create table if not exists alert_events (
  id            uuid primary key default gen_random_uuid(),
  rule_id       uuid references alert_rules(id) on delete cascade,
  symbol        text not null,
  fired_at      timestamptz default now(),
  message       text,
  payload       jsonb default '{}'::jsonb,
  acknowledged  boolean default false
);
create index if not exists idx_alert_events_recent on alert_events(fired_at desc);
create index if not exists idx_alert_events_rule_symbol on alert_events(rule_id, symbol, fired_at desc);

-- ── Trade tags ──
create table if not exists trade_tags (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid references users(id) on delete cascade,
  name      text not null,
  color     text,
  unique (user_id, name)
);
