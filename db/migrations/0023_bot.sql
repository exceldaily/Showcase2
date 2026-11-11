-- Options bot: every order the bot sends is a row here, charged against
-- the budget before it goes out. Long options only (buy to open, sell to
-- close), so the most a trade can lose is what `reserved` / `cost` says.
create table if not exists bot_trades (
  id              uuid primary key default gen_random_uuid(),
  symbol          text not null,
  occ             text not null,
  side            text not null check (side in ('call','put')),
  qty             integer not null check (qty > 0),
  status          text not null check (status in ('PENDING_ENTRY','OPEN','PENDING_EXIT','CLOSED','CANCELED','REJECTED')),
  paper           boolean not null default true,
  limit_price     numeric not null,
  reserved        numeric not null,
  entry_order_id  text,
  entry_fill      numeric,
  cost            numeric not null default 0,
  exit_order_id   text,
  exit_attempts   integer not null default 0,
  exit_fill       numeric,
  pnl             numeric not null default 0,
  reason_in       text,
  reason_out      text,
  trigger         numeric,
  target          numeric,
  invalidation    numeric,
  setup_score     integer,
  features        jsonb,
  expiry          date,
  day             date not null,
  opened_at       timestamptz not null default now(),
  filled_at       timestamptz,
  exit_sent_at    timestamptz,
  closed_at       timestamptz
);
create index if not exists idx_bot_trades_status on bot_trades(status);
create index if not exists idx_bot_trades_day on bot_trades(day desc);

create table if not exists bot_events (
  id       bigserial primary key,
  at       timestamptz not null default now(),
  level    text not null default 'info',
  symbol   text,
  message  text not null
);
create index if not exists idx_bot_events_at on bot_events(at desc);

-- One row: the tick lock, so two schedulers can never trade at once.
create table if not exists bot_state (
  id       integer primary key default 1 check (id = 1),
  tick_at  timestamptz,
  summary  jsonb
);
insert into bot_state (id) values (1) on conflict (id) do nothing;
