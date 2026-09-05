-- ─────────────────────────────────────────────────────────
-- 0012: Siren alerts.
-- siren_events: every fired alert (deduped per symbol/kind/session).
-- alert_watch: extra symbols the sweep monitors beyond the megacap
--              universe (managed from the terminal UI).
-- alert_runs:  sweep bookkeeping for throttling and daily caps.
-- ─────────────────────────────────────────────────────────

create table if not exists siren_events (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  dedupe_key    text not null unique,
  symbol        text not null,
  kind          text not null,
  direction     text not null,
  urgency       text not null,
  title         text not null,
  body          text not null,
  contract      text,
  opportunity   int,
  emailed       boolean not null default false,
  email_error   text
);
create index if not exists idx_siren_events_created on siren_events(created_at desc);

create table if not exists alert_watch (
  symbol      text primary key,
  added_at    timestamptz not null default now()
);

create table if not exists alert_runs (
  id          bigserial primary key,
  ran_at      timestamptz not null default now(),
  symbols     int not null default 0,
  fired       int not null default 0,
  note        text
);
create index if not exists idx_alert_runs_ran_at on alert_runs(ran_at desc);
