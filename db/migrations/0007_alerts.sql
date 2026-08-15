-- ─────────────────────────────────────────────────────────
-- 0007: breakout radar alerts
-- One alert per symbol + type + scan day (dedupe). "Primed" =
-- coiled under resistance; "Breakout" = lid gave way on volume.
-- ─────────────────────────────────────────────────────────

create table if not exists alerts (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz default now(),
  scan_date     date not null,
  symbol        text not null,
  alert_type    text not null,          -- Primed | Breakout | EMA Reclaim
  price         numeric,
  resistance    numeric,
  vwap          numeric,
  distance_pct  numeric,
  coil_pct      numeric,
  strength      int,
  sector        text,
  message       text,
  acknowledged  boolean default false,
  unique (symbol, alert_type, scan_date)
);
create index if not exists idx_alerts_recent on alerts(created_at desc);
create index if not exists idx_alerts_type_date on alerts(alert_type, scan_date desc);
