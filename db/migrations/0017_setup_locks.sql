-- ─────────────────────────────────────────────────────────
-- 0017: Setup locks. Once a trigger level is chosen for a symbol on a
-- session day it stays fixed (break line, wrong line, targets) until the
-- setup resolves (FAILED / INVALIDATED), the trend flips before any
-- trigger, or the owner re-picks. Stops the level from walking away
-- from the trader every time price reaches it.
-- ─────────────────────────────────────────────────────────

create table if not exists setup_locks (
  symbol          text not null,
  day             text not null,               -- ET session date, YYYY-MM-DD
  direction       text not null check (direction in ('long', 'short')),
  trigger         numeric not null,
  invalidation    numeric not null,
  plan            jsonb not null,              -- full TradePlan as picked
  picked_at       timestamptz not null default now(),
  picked_price    numeric,
  released_at     timestamptz,
  release_reason  text,
  primary key (symbol, day)
);
