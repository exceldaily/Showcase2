# AlphaForge

Evidence-driven stock and crypto research platform. Scans a curated universe across AI, semiconductors, oil, energy, crypto (including Bitcoin and Ethereum directly), biotech, pharma, emerging growth and fresh IPOs. Every setup carries structural entries, stops, documented targets, reward-to-risk, and a fully explained score.

> Research and education tool. **Not financial advice. No guarantee of profit. No live trading.** Every number shown is computed deterministically from sourced market data; the AI layer (Phase 2) only explains computed results and never invents prices, news, or signals.

## Tech stack
Next.js 14 (App Router) plus TypeScript, Tailwind, Neon serverless Postgres, Vercel hosting with daily cron, Polygon.io market data (EOD stocks + crypto), FRED macro data, site passcode gate.

## Running locally
```bash
npm install
cp .env.example .env.local   # fill in keys as you get them
npm run dev                  # app renders demo data until keys exist
npm test                     # vitest unit suite (scoring, regime, indicators)
```

## Environment
See `.env.example` for every variable with purpose notes. Presence (never values) is reported at `/api/health` along with database reachability, latest bar date, active setup count, and last scan time. Required for live data: `DATABASE_URL`, `POLYGON_API_KEY`, `CRON_SECRET`. Optional: `SITE_PASSCODE` (gate), `FRED_API_KEY` (real VIX; realized-vol proxy used until set).

## Architecture
```
src/
  providers/      HTTP core: timeout, retry, exponential backoff, 429
                  handling, source attribution, redacted logging
  lib/            polygon + fred clients (via providers), bars cache,
                  scanner pipeline, scoring, regime, db pool, env checks
  app/            dashboard, scanner, setup/[id], market-regime,
                  paper-trading, gate, api/scan, api/health, api/gate
  components/     Nav, RegimeBanner, SectorHeatmap, SetupCard, badges
db/
  migrations/     0001 core schema, 0002 daily_bars
  seed/           tickers.sql (universe), 0003_crypto.sql (BTC, ETH)
scripts/          migrate.mjs, backfill-bars.mjs
docs/             AUDIT.md (full repository audit)
```

## Data flow
1. `scripts/backfill-bars.mjs` bootstraps ~1 year of daily bars per symbol (one-time, rate-limit aware).
2. Daily cron hits `/api/scan`: one grouped Polygon call refreshes all stock bars, one more refreshes crypto, then the pipeline recomputes regime, sector strength, setup detection, plans, and scores entirely from cached bars.
3. UI reads from Neon. Every price shows a freshness badge (End-of-day plus bar date). Demo cards are labeled Demo data.

## Honesty guardrails
- Catalyst pillar is currently a volume/momentum proxy and is labeled as such on every card (news engine is Phase 2).
- Setups below 3:1 reward-to-risk are rejected, not shown.
- The scanner says "No trade today" when nothing clears the quality gate.
- Crypto symbols are exempt from the share-volume floor (volume is coin-denominated); the dollar-volume liquidity of BTC/ETH far exceeds the bar.

## Known limitations (current data plan)
- Polygon free tier is end-of-day only: no intraday timeframes, options chains, short interest, or fundamentals. Those engines (per the target spec) activate with a plan upgrade.
- Vercel Hobby cron runs once daily; intraday scanning needs Pro or an external scheduler.
- Next.js held at 14.2.35: criticals patched; two advisories (image optimizer disk cache, a DoS variant) are only fixed in Next 16, a major upgrade deferred deliberately.
- `pg` connects to Neon with TLS but without CA verification (`rejectUnauthorized: false`), a documented tradeoff.

## Phase roadmap (target spec)
- **Phase 1 (done)**: audit (docs/AUDIT.md), CVE upgrade, provider layer, env validation + health endpoint, freshness labels, gate hardening, unit tests, Bitcoin/Ethereum
- **Phase 2**: stock detail page, Polygon news timeline with source tiers, AI plain-English explanations grounded in computed data
- **Phase 3**: short-stock engine (thesis-only until borrow data), documented target methods, per-instrument scoring
- **Phase 4**: options module (needs Polygon options plan)
- **Phase 5**: paper tracker, backtesting, alerts
- **Phase 6**: performance, monitoring, admin
