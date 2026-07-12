-- ─────────────────────────────────────────────────────────
-- 0002: daily OHLCV bar cache
-- Bootstrap once per ticker from Polygon history, then append one
-- grouped-daily call per trading day. All indicator math reads from
-- this table so the scanner never hits API rate limits.
-- ─────────────────────────────────────────────────────────

create table if not exists daily_bars (
  id         uuid primary key default gen_random_uuid(),
  symbol     text not null,
  date       date not null,
  open numeric, high numeric, low numeric, close numeric,
  volume numeric, vwap numeric,
  unique (symbol, date)
);
create index if not exists idx_daily_bars_symbol_date on daily_bars(symbol, date desc);
