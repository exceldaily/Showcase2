-- ─────────────────────────────────────────────────────────
-- 0005: paper trading engine columns
-- Positions freeze the full plan at open; fills simulate against
-- daily bars. Statuses: Watching -> Active -> ClosedTarget /
-- ClosedStop / ClosedTime / Expired (never triggered).
-- ─────────────────────────────────────────────────────────

alter table paper_trades add column if not exists direction text not null default 'Long';
alter table paper_trades add column if not exists symbol text;
alter table paper_trades add column if not exists setup_type text;
alter table paper_trades add column if not exists score int;
alter table paper_trades add column if not exists entry_zone_low numeric;
alter table paper_trades add column if not exists entry_zone_high numeric;
alter table paper_trades add column if not exists target_1 numeric;
alter table paper_trades add column if not exists target_2 numeric;
alter table paper_trades add column if not exists target_3 numeric;
alter table paper_trades add column if not exists t1_hit boolean default false;
alter table paper_trades add column if not exists activated_at date;
alter table paper_trades add column if not exists r_multiple numeric;
alter table paper_trades add column if not exists watch_started date;

create index if not exists idx_paper_open on paper_trades(status) where status in ('Watching','Active');
