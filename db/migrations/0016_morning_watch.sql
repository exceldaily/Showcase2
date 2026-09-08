-- ─────────────────────────────────────────────────────────
-- 0016: Morning watch. One row per ET session date: the premarket
-- ranking and the top picks. `locked` = the list was frozen (at ~9:10
-- ET by the siren sweep, or by the owner) and emailed; before that the
-- row is just the latest live computation so the page loads fast.
-- ─────────────────────────────────────────────────────────

create table if not exists morning_watch (
  day          text primary key,           -- ET date, YYYY-MM-DD
  computed_at  timestamptz not null default now(),
  locked       boolean not null default false,
  locked_at    timestamptz,
  picks        jsonb not null default '[]'::jsonb,
  ranked       jsonb not null default '[]'::jsonb,
  email_sent   boolean not null default false,
  email_error  text
);
