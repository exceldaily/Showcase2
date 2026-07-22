# Broker Integration Plan

Goal: the bot proposes trades, the user approves each one, the broker executes. Supervised semi-automation, never unattended.

## Why NOT MetaTrader 4 (for this platform)

MT4 is a forex/CFD platform, and that matters here:

1. **Asset mismatch.** AlphaForge scans US-listed stocks and crypto. MT4 brokers offer stocks only as CFDs (contracts for difference), and CFDs are prohibited for US retail traders. A US resident cannot legally trade NVDA/META CFDs through an MT4 broker.
2. **No API.** MT4 has no REST API. Integration means writing an MQL4 Expert Advisor that polls our signals endpoint from inside the terminal, plus a Windows VPS to keep the terminal running. Fragile, unauditable, and outside our stack.
3. **Wrong signals anyway.** Our engine is built on daily equity bars, sector strength, and equity market regime. Pointing it at EUR/USD would be applying a model to data it was never designed or validated for.

If forex trading via MT4 ever becomes a real goal, that is a separate product with its own data, detectors, and backtests. Parked unless explicitly revived.

## Recommended path: Alpaca

[Alpaca](https://alpaca.markets) is the natural fit and was already named in the original platform spec:
- Commission-free US stocks AND crypto (matches our universe including BTC/ETH)
- First-class REST API with a **paper trading environment** (fake money, real fills) — our current simulated tracker can graduate to broker-grade paper fills
- Real-time order status, positions, and account state
- Keys are free; no funding required for paper trading

## Safety architecture (non-negotiable, from the original spec)

- `ENABLE_LIVE_TRADING=false` by default; the app refuses live order functions while false
- Paper trading first, for months, until the forward test proves positive expectancy after costs
- Every order requires explicit manual confirmation in the UI; the bot never fires unattended
- Kill switch, daily loss limit, max open positions, max order value, duplicate-order protection
- Stale-price and market-hours checks before any order ticket is even shown

## Order of work

1. Prove the strategy first. A broker connection cannot fix a negative-expectancy signal engine; the current redesign (stop widths, benched shorts, RS leaders) must show a positive forward test before any order flows anywhere.
2. Broker provider interface + Alpaca paper adapter (needs user-created Alpaca keys: `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY`).
3. Order-ticket UI with manual confirm, wired to paper only.
4. Months of broker-paper validation with full audit logging.
5. Live enablement is a deliberate, separate decision gated by documented performance, and stays supervised.
