-- Owner-entered market events (earnings dates, Fed speakers, anything
-- the free calendar does not cover). Shown to every member with a
-- countdown and used by the no-entry buffer before high-impact events.
create table if not exists market_events (
  id          uuid primary key default gen_random_uuid(),
  at          timestamptz not null,
  title       text not null,
  impact      text not null check (impact in ('HIGH','MEDIUM','LOW')),
  affects     text not null default 'market',
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists idx_market_events_at on market_events(at);
