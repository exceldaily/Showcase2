# AlphaForge Repository Audit
Date: 2026-07-12 · Auditor: automated + manual review · Scope: full repo at commit `edcd7fc`

## 1. Technology stack (current)
| Layer | Tech | State |
|---|---|---|
| Frontend | Next.js 14.2.15 App Router, TypeScript, Tailwind | Working |
| Backend | Next.js API routes (Node runtime) | Working |
| Database | Neon Postgres (`pg` pool), 18 tables | Working |
| Market data | Polygon.io free tier (end-of-day; 5 req/min) | Working |
| Macro data | FRED client implemented, key not yet configured | Latent |
| Hosting | Vercel Hobby, daily cron 13:00 UTC weekdays | Working |
| Auth | Site passcode gate (middleware + hashed cookie) | Working |
| AI | None wired yet (Phase 2: Anthropic for explanation only) | Absent |

## 2. Working functionality (verified live)
- Daily scan pipeline: 1 grouped Polygon call refreshes 55 symbols; deterministic setup detection (Breakout, Pullback, IPO Base Breakout); structural stops; 3:1 R/R gate; v1 weighted scoring; persistence to Neon
- Bar cache: 15,015 daily bars, backfill + refresh scripts
- Market regime engine (SPY/QQQ trend, realized-vol proxy for VIX, real universe breadth)
- Sector strength from real 5d/20d momentum, daily persistence
- Dashboard, scanner, setup detail pages reading live DB rows
- Passcode gate verified: redirect, reject, accept, cron exempt

## 3. Broken / risky functionality
| # | Severity | Finding |
|---|---|---|
| 1 | CRITICAL | Next.js 14.2.15 carries known CVEs including a middleware authorization bypass (GHSA-f82v-jwr5-mffw). Our passcode gate IS middleware. Fix: upgrade to patched 14.2.x. |
| 2 | HIGH | No provider layer: `polygon.ts`/`fred.ts` fetch directly with no timeout, retry, backoff, or schema validation. A hung fetch can burn the whole 60s function budget. |
| 3 | MEDIUM | Duplicate data path: `liveRegime.ts` fetches SPY/QQQ from the API even though bars are cached in Neon. Wastes 2 of 5 req/min. |
| 4 | MEDIUM | No data-freshness labels in the UI. Prices are end-of-day but displayed without timestamp or source. |
| 5 | MEDIUM | No environment validation; missing keys degrade silently. |
| 6 | LOW | `/api/gate` has no failure delay (brute-force friction). 10-digit numeric space makes practical brute force unlikely but friction is free. |
| 7 | LOW | `pg` uses `ssl.rejectUnauthorized: false` (TLS without cert verification) for Neon compatibility. Documented tradeoff. |
| 8 | LOW | Unused dependencies: `date-fns`, `clsx` (0 imports). |

## 4. Security review
- API keys server-side only, never shipped to browser ✓
- `.env*` gitignored; repo is public and history contains no secrets ✓
- `/api/scan` requires `CRON_SECRET` bearer ✓
- Passcode cookie stores SHA-256 hash, httpOnly, secure ✓
- Action items: #1 (Next CVEs), #6 (gate delay) above

## 5. Data-quality review
- All displayed prices derive from Polygon EOD aggregates cached in `daily_bars` with real dates ✓
- Catalyst pillar is a volume/momentum proxy, labeled as such on every setup ✓ (no invented news)
- VIX substituted by realized-vol proxy until FRED key exists, computed not invented ✓
- Gap: freshness/source badges not yet rendered in UI (finding #4)
- Gap: no stale-data refusal logic (scan runs on whatever bars exist)

## 6. Dead code / dead ends
- 6 schema tables have no code paths yet (market_snapshots, catalyst_events, learning_reports, institutional_holdings, ipo_tracker, user_watchlists). Intentional Phase 2/3 targets, kept.
- Paper Trading page is a labeled shell (Phase 3 per plan), not a broken link.
- Demo-data fallback renders when DB is empty; labeled by the nav pill.

## 7. Missing vs. the new target spec
Options analysis (chains, Greeks, call/put engines), short-stock engine (short interest, borrow status), news timeline + source tiers, SEC filings, fundamentals page, multi-timeframe intraday TA, backtesting, paper tracker, alerts, watchlists, per-instrument scoring. Free-tier Polygon provides EOD stocks + crypto + basic reference data; options chains, intraday granularity, short interest and fundamentals need plan upgrades or additional sources. Each phase below states its data dependency.

## 8. Recommended implementation order
- Phase 1 (this commit): Next CVE upgrade, provider layer with retry/backoff/timeout, env validation + health endpoint, freshness labels, gate hardening, dependency prune, unit tests, Bitcoin/Ethereum universe support
- Phase 2: stock detail page, news timeline (Polygon news is on free tier), plain-English AI explanations grounded in computed data only
- Phase 3: short-stock engine (thesis-only until borrow data exists), target-method documentation, per-instrument scoring
- Phase 4: options module (requires Polygon options plan)
- Phase 5: paper tracker, backtesting, alerts
- Phase 6: performance, monitoring, admin
