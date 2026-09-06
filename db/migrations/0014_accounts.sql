-- ─────────────────────────────────────────────────────────
-- 0014: Invite-only accounts.
-- users already exists from 0001 (unused Auth.js-style columns, empty),
-- so this extends it in place: username + scrypt password hash,
-- role owner|member, session_version (bump = sign out everywhere).
-- invites: single-use, expiring tokens (only the sha256 is stored).
-- ─────────────────────────────────────────────────────────

alter table users add column if not exists username        text;
alter table users add column if not exists password_hash   text;
alter table users add column if not exists role            text not null default 'member';
alter table users add column if not exists invited_by      uuid references users(id) on delete set null;
alter table users add column if not exists disabled        boolean not null default false;
alter table users add column if not exists session_version int not null default 1;
alter table users add column if not exists last_login_at   timestamptz;
alter table users alter column created_at set default now();
create unique index if not exists users_username_key on users(username);
alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check check (role in ('owner', 'member'));

create table if not exists invites (
  id           uuid primary key default gen_random_uuid(),
  token_hash   text not null unique,
  email        text,
  note         text,
  created_by   uuid not null references users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_at      timestamptz,
  used_by      uuid references users(id) on delete set null,
  revoked_at   timestamptz,
  email_sent   boolean not null default false,
  email_error  text
);
create index if not exists idx_invites_created on invites(created_at desc);
