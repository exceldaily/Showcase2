-- ─────────────────────────────────────────────────────────
-- AlphaForge — starter ticker universe
-- Run AFTER 0001_init.sql. Liquid, > $5 names across the 7 target
-- sectors plus recent IPOs. Expand over time; the scanner only acts on
-- names that also pass the live volume / price / catalyst filters.
-- ─────────────────────────────────────────────────────────

insert into tickers (symbol, company_name, sector, exchange, is_ipo_36mo) values
  -- AI
  ('NVDA','NVIDIA Corp.','AI','NASDAQ',false),
  ('MSFT','Microsoft Corp.','AI','NASDAQ',false),
  ('GOOGL','Alphabet Inc.','AI','NASDAQ',false),
  ('META','Meta Platforms','AI','NASDAQ',false),
  ('PLTR','Palantir Technologies','AI','NYSE',false),
  ('AI','C3.ai Inc.','AI','NYSE',false),
  ('SNOW','Snowflake Inc.','AI','NYSE',false),
  ('PATH','UiPath Inc.','AI','NYSE',false),

  -- Semiconductors
  ('AMD','Advanced Micro Devices','Semiconductors','NASDAQ',false),
  ('AVGO','Broadcom Inc.','Semiconductors','NASDAQ',false),
  ('TSM','Taiwan Semiconductor','Semiconductors','NYSE',false),
  ('MU','Micron Technology','Semiconductors','NASDAQ',false),
  ('MRVL','Marvell Technology','Semiconductors','NASDAQ',false),
  ('SMCI','Super Micro Computer','Semiconductors','NASDAQ',false),
  ('ARM','Arm Holdings','Semiconductors','NASDAQ',true),
  ('LRCX','Lam Research','Semiconductors','NASDAQ',false),
  ('ASML','ASML Holding','Semiconductors','NASDAQ',false),

  -- Oil
  ('XOM','Exxon Mobil','Oil','NYSE',false),
  ('CVX','Chevron Corp.','Oil','NYSE',false),
  ('COP','ConocoPhillips','Oil','NYSE',false),
  ('OXY','Occidental Petroleum','Oil','NYSE',false),
  ('SLB','Schlumberger','Oil','NYSE',false),
  ('HAL','Halliburton','Oil','NYSE',false),
  ('DVN','Devon Energy','Oil','NYSE',false),

  -- Energy
  ('NEE','NextEra Energy','Energy','NYSE',false),
  ('VST','Vistra Corp.','Energy','NYSE',false),
  ('CEG','Constellation Energy','Energy','NASDAQ',true),
  ('ENPH','Enphase Energy','Energy','NASDAQ',false),
  ('FSLR','First Solar','Energy','NASDAQ',false),
  ('GEV','GE Vernova','Energy','NYSE',true),

  -- Crypto ecosystem
  ('COIN','Coinbase Global','Crypto','NASDAQ',false),
  ('MSTR','MicroStrategy','Crypto','NASDAQ',false),
  ('MARA','Marathon Digital','Crypto','NASDAQ',false),
  ('RIOT','Riot Platforms','Crypto','NASDAQ',false),
  ('CLSK','CleanSpark Inc.','Crypto','NASDAQ',false),
  ('HOOD','Robinhood Markets','Crypto','NASDAQ',false),
  ('CORZ','Core Scientific','Crypto','NASDAQ',true),

  -- Biotech
  ('VRTX','Vertex Pharmaceuticals','Biotech','NASDAQ',false),
  ('REGN','Regeneron','Biotech','NASDAQ',false),
  ('MRNA','Moderna Inc.','Biotech','NASDAQ',false),
  ('ALNY','Alnylam Pharmaceuticals','Biotech','NASDAQ',false),
  ('CRSP','CRISPR Therapeutics','Biotech','NASDAQ',false),
  ('NTLA','Intellia Therapeutics','Biotech','NASDAQ',false),

  -- Pharmaceuticals
  ('LLY','Eli Lilly','Pharmaceuticals','NYSE',false),
  ('PFE','Pfizer Inc.','Pharmaceuticals','NYSE',false),
  ('MRK','Merck & Co.','Pharmaceuticals','NYSE',false),
  ('ABBV','AbbVie Inc.','Pharmaceuticals','NYSE',false),
  ('BMY','Bristol-Myers Squibb','Pharmaceuticals','NYSE',false),
  ('AMGN','Amgen Inc.','Pharmaceuticals','NASDAQ',false),

  -- Recent IPOs / newly public (cross-sector)
  ('RDDT','Reddit Inc.','AI','NYSE',true),
  ('ALAB','Astera Labs','Semiconductors','NASDAQ',true),
  ('BIRK','Birkenstock Holding','Pharmaceuticals','NYSE',true),
  ('SARO','StandardAero','Energy','NYSE',true)
on conflict (symbol) do nothing;
