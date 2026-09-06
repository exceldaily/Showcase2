-- ─────────────────────────────────────────────────────────
-- 0015: Device sessions + sign-in log.
-- login_sessions: one row per signed-in device (the cookie carries its
--                 id). Revoking a row signs that device out; the device
--                 cap kicks the oldest one. (Note: `sessions` from 0001 is
--                 an unused Auth.js table, hence the different name.)
-- signin_log:     every sign-in attempt with IP, rough location, device.
-- users.device_limit: per-member cap (default 2). users.flagged_at/reason:
--                 set when the same account is used from two places at once.
-- ─────────────────────────────────────────────────────────

alter table users add column if not exists device_limit  int not null default 2;
alter table users add column if not exists flagged_at    timestamptz;
alter table users add column if not exists flag_reason   text;

create table if not exists login_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  ip             text,
  city           text,
  region         text,
  country        text,
  user_agent     text,
  device         text,
  revoked_at     timestamptz,
  revoke_reason  text
);
create index if not exists idx_login_sessions_user on login_sessions(user_id, revoked_at, last_seen_at desc);

create table if not exists signin_log (
  id          uuid primary key default gen_random_uuid(),
  at          timestamptz not null default now(),
  user_id     uuid references users(id) on delete cascade,
  username    text,
  outcome     text not null,          -- success | failed | locked
  ip          text,
  city        text,
  region      text,
  country     text,
  device      text,
  user_agent  text
);
create index if not exists idx_signin_log_user on signin_log(user_id, at desc);
create index if not exists idx_signin_log_at on signin_log(at desc);
