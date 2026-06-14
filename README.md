# AlphaForge

AI-powered catalyst-driven swing/day trading scanner. Finds high-conviction setups across AI, semiconductors, oil, energy, crypto, biotech, pharma, emerging growth and fresh IPOs — with structural entries, stops, profit targets, confidence scores, and paper-trading performance tracking.

> Research & education tool. **Not financial advice. No guarantee of profit. Paper trading only.** No live auto-trading.

## Tech stack
Next.js 14 (App Router) · TypeScript · Tailwind CSS · Supabase (Postgres/Auth) · Vercel (hosting + cron) · Polygon.io (market data) · FRED (macro) · Anthropic Claude (catalyst AI, Phase 2).

## Running locally
```bash
npm install
cp .env.local.example .env.local   # fill in keys as you get them
npm run dev
```
The app runs on **mock data** until keys are added — every page renders so you can see the full workflow before connecting any account.

## Environment / keys (added progressively)
| Phase | Key | Where |
|-------|-----|-------|
| 1 | `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` / `SERVICE_ROLE_KEY` | supabase.com → Project Settings → API |
| 1 | `POLYGON_API_KEY` | polygon.io → API Keys |
| 1 | `FRED_API_KEY` (free) | fred.stlouisfed.org |
| 1 | `CRON_SECRET` | any random string |
| 2 | `ANTHROPIC_API_KEY` | console.anthropic.com |
| 2 | `FMP_API_KEY`, `BENZINGA_API_KEY`, `NEWSAPI_KEY` | respective sites |
| 2 | `RESEND_API_KEY` | resend.com |

## Database
Run `supabase/migrations/0001_init.sql` in the Supabase SQL editor.

## Deploy (Vercel)
1. Import this repo into Vercel.
2. Add the env vars above in Project Settings → Environment Variables.
3. Point `thisistemporary.us` at the Vercel project (Vercel → Domains).
4. The scanner cron (`/api/scan`) runs every 15 min during US market hours.

## Build phases
- **Phase 1** — scanner core, market regime, sector strength, setup generation, dashboard ← *current*
- **Phase 2** — AI catalyst engine, smart money (13F/Form 4), email alerts, morning digest
- **Phase 3** — paper trading engine, IPO tracker, watchlists, charts
- **Phase 4** — 30-day self-learning engine, billing, polish

## Project structure
```
src/
  app/            routes (dashboard, scanner, setup/[id], market-regime, paper-trading, api/scan)
  components/     Nav, RegimeBanner, SectorHeatmap, SetupCard, ScoreBadge
  lib/            scoring, regime, polygon, supabase clients, data layer, types
  data/           mock data (renders UI before keys exist)
supabase/
  migrations/     0001_init.sql (full schema)
```
