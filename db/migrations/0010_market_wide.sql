-- ─────────────────────────────────────────────────────────
-- 0010: Whole-market scanning on the free EOD feed.
--
-- The daily scan already downloads the ENTIRE US market in one
-- grouped call and discarded everything outside the tracked
-- universe. market_daily keeps that snapshot (with retention) so
-- scanners can sweep ~10,000 stocks for price/change/RVOL/dollar
-- volume with zero extra API calls.
--
-- catalyst_news caches the free Polygon news check per symbol so
-- "Has Catalyst" can be a real Found/None instead of Unknown.
-- ─────────────────────────────────────────────────────────

create unique index if not exists idx_universes_slug on universes(slug);

create table if not exists market_daily (
  symbol  text not null,
  date    date not null,
  open    numeric(18,4),
  high    numeric(18,4),
  low     numeric(18,4),
  close   numeric(18,4) not null,
  volume  numeric(18,0) not null default 0,
  primary key (symbol, date)
);
create index if not exists idx_market_daily_date on market_daily(date);

create table if not exists catalyst_news (
  symbol          text primary key,
  checked_at      timestamptz not null default now(),
  headline        text,
  publisher       text,
  tier            int,
  article_url     text,
  published_at    timestamptz
);

-- The whole-market pseudo-universe. min/max price and liquidity are
-- applied to the snapshot rows like any other universe.
insert into universes (slug, name, min_price, max_price, min_dollar_volume, description)
values ('entire-market', 'Entire Market', 1, null, 2000000,
        'Every US stock in the daily snapshot (~10,000 symbols). Price, % change, RVOL, volume and dollar volume only; chart-based metrics need tracked history.')
on conflict (slug) do update set
  name = excluded.name,
  min_price = excluded.min_price,
  max_price = excluded.max_price,
  min_dollar_volume = excluded.min_dollar_volume,
  description = excluded.description;

-- 5-Point checklist over the entire market.
insert into scanner_presets (slug, name, description, universe_slug, rules, columns, sort_field, sort_dir, is_enabled)
values (
  'five-point-market',
  '5-Point Momentum (Whole Market)',
  'The 5-point checklist swept across every US stock, not just tracked tickers: up 10%+, 5x relative volume, $2–$20. Preferred: float under 20M and a news catalyst.',
  'entire-market',
  '{"logic":"AND","conditions":[
     {"field":"price","op":"between","value":2,"value2":20},
     {"field":"changePct","op":"gte","value":10},
     {"field":"rvol","op":"gte","value":5},
     {"field":"floatShares","op":"lt","value":20000000,"soft":true},
     {"field":"catalystStatus","op":"eq","value":"Found","soft":true}
   ]}'::jsonb,
  '["symbol","price","changePct","rvol","volume","dollarVolume","floatShares","catalystStatus","criteria"]'::jsonb,
  'changePct', 'desc', true
)
on conflict (slug) do update set
  name = excluded.name, description = excluded.description,
  universe_slug = excluded.universe_slug, rules = excluded.rules,
  columns = excluded.columns, sort_field = excluded.sort_field,
  sort_dir = excluded.sort_dir, is_enabled = true;

-- Top gainers over the entire market: the daily movers board.
insert into scanner_presets (slug, name, description, universe_slug, rules, columns, sort_field, sort_dir, is_enabled)
values (
  'market-gainers',
  'Top Gainers (Whole Market)',
  'Every US stock up 10%+ on real liquidity ($5M+ traded). The full movers board the tracked universe can only sample.',
  'entire-market',
  '{"logic":"AND","conditions":[
     {"field":"price","op":"gte","value":1},
     {"field":"changePct","op":"gte","value":10},
     {"field":"dollarVolume","op":"gte","value":5000000},
     {"field":"rvol","op":"gte","value":2,"soft":true},
     {"field":"catalystStatus","op":"eq","value":"Found","soft":true}
   ]}'::jsonb,
  '["symbol","price","changePct","rvol","volume","dollarVolume","floatShares","catalystStatus","criteria"]'::jsonb,
  'changePct', 'desc', true
)
on conflict (slug) do update set
  name = excluded.name, description = excluded.description,
  universe_slug = excluded.universe_slug, rules = excluded.rules,
  columns = excluded.columns, sort_field = excluded.sort_field,
  sort_dir = excluded.sort_dir, is_enabled = true;
