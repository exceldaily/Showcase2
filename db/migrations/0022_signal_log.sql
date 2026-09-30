-- Signal log: every level the engine locks, under each model, with what
-- became of it. Analytics are counted from these rows and nothing else.
--   model   old = the original confirmation rules
--           new = the setup quality engine
--   source  live   = recorded while the app was analysing the symbol
--           replay = the same engine stepped through a past session
--   status  OPEN (session still running), ENTRY (the model said CALL or
--           PUT), NO ENTRY (confirmed break the model held back),
--           FAILED BREAKOUT, NEVER TRIGGERED
-- For NO ENTRY the outcome columns hold what entering at the
-- confirmation would have done, so the gates can be judged.
create table if not exists signal_log (
  id            uuid primary key default gen_random_uuid(),
  symbol        text not null,
  day           date not null,
  model         text not null check (model in ('old','new')),
  source        text not null check (source in ('live','replay')),
  direction     text not null check (direction in ('long','short')),
  trigger       numeric not null,
  invalidation  numeric not null,
  targets       jsonb not null default '[]',
  status        text not null check (status in ('OPEN','ENTRY','NO ENTRY','FAILED BREAKOUT','NEVER TRIGGERED')),
  blocked_by    text,
  fired_at      timestamptz,
  price         numeric,
  features      jsonb,
  outcome       text check (outcome in ('WIN','LOSS','BREAKEVEN')),
  r             numeric,
  mae_r         numeric,
  mfe_r         numeric,
  rr            numeric,
  exit          text,
  false_break   boolean,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (symbol, day, model, source, direction, trigger)
);
create index if not exists idx_signal_log_day on signal_log(day desc);
create index if not exists idx_signal_log_model on signal_log(model, source, status);
