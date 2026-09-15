-- Per-ticker headlines gathered from publishers' own feeds (Yahoo
-- Finance RSS, Google News RSS, SEC EDGAR filings). Stored so the
-- catalyst score and the panel read from the database, and the feeds
-- are polled at most every ten minutes per symbol.
create table if not exists symbol_news (
  symbol        text not null,
  url           text not null,
  title         text not null,
  source        text not null,
  publisher     text,
  tier          int not null check (tier between 1 and 4),
  tags          text[] not null default '{}',
  direct        boolean not null default true,
  published_at  timestamptz,
  fetched_at    timestamptz not null default now(),
  primary key (symbol, url)
);
create index if not exists idx_symbol_news_recent on symbol_news(symbol, published_at desc);

create table if not exists symbol_news_refresh (
  symbol        text primary key,
  refreshed_at  timestamptz not null default now(),
  ok            boolean not null default true,
  sources_ok    int not null default 0,
  note          text
);
