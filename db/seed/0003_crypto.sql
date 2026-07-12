-- Crypto assets tracked directly (Polygon crypto aggregates).
-- Symbols use Polygon's X: prefix; the UI strips it for display.
insert into tickers (symbol, company_name, sector, exchange, is_ipo_36mo) values
  ('X:BTCUSD','Bitcoin (BTC/USD)','Crypto','CRYPTO',false),
  ('X:ETHUSD','Ethereum (ETH/USD)','Crypto','CRYPTO',false)
on conflict (symbol) do nothing;
