-- ─────────────────────────────────────────────────────────
-- 0011: Options command center journal.
-- Every order submitted through the terminal is journaled with the
-- setup snapshot that motivated it (state machine, trigger, targets,
-- scores) so the analytics layer can later measure which signals
-- actually work. client_order_id doubles as the idempotency key.
-- ─────────────────────────────────────────────────────────

create table if not exists option_journal (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  client_order_id  text not null unique,
  alpaca_order_id  text,
  occ_symbol       text not null,
  underlying       text not null,
  side             text not null,          -- buy / sell
  qty              int  not null,
  order_type       text not null,          -- market / limit
  limit_price      numeric(12,2),
  paper            boolean not null default true,
  -- Snapshot of the trade map at submission: setup state, quality,
  -- trigger/targets/invalidation, trend, rvol, contract score, greeks.
  setup_snapshot   jsonb,
  notes            text
);

create index if not exists idx_option_journal_underlying on option_journal(underlying, created_at desc);
