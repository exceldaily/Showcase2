-- Options trade journal: every trade the trader records by hand, and
-- every setup they chose NOT to take, with the setup snapshot at that
-- moment so results can be sliced by setup, state, confidence, strike
-- choice and timeframe alignment later.
create table if not exists option_trades (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  status            text not null check (status in ('open','closed','skipped')),
  symbol            text not null,
  direction         text not null check (direction in ('long','short')),
  side              text check (side in ('call','put')),
  contract          text,
  strike            numeric,
  expiry            date,
  entry_premium     numeric,
  qty               integer not null default 1,
  entry_at          timestamptz not null default now(),
  exit_premium      numeric,
  exit_at           timestamptz,
  pnl               numeric,
  risk_dollars      numeric,
  mae               numeric,
  mfe               numeric,
  setup             text,
  lifecycle         text,
  market_state      text,
  confidence        integer,
  trigger_price     numeric,
  invalidation      numeric,
  targets           jsonb,
  snapshot          jsonb,
  strike_tag        text,
  aligned           boolean,
  skipped_reason    text,
  outcome           text check (outcome in ('WORKED','FAILED','UNRESOLVED')),
  review_tags       text[] not null default '{}',
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_option_trades_user_time on option_trades(user_id, entry_at desc);
