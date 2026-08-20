# AlphaForge Terminal — Architecture & Implementation Plan
Audit date: 2026-08-15 · Scope: full repo · Target: professional real-time day-trading research terminal

---

## 1. Current architecture

| Layer | Implementation | Verdict |
|---|---|---|
| Framework | Next.js 14.2.35 App Router, TypeScript, Tailwind | **Keep** — correct foundation |
| Backend | Next.js API routes (Node runtime) | **Keep**, extend with a streaming service later |
| Database | Neon serverless Postgres via `pg` pool (`src/lib/db.ts`) | **Keep** |
| Market data | Polygon.io **free tier: end-of-day aggregates only** | **Hard constraint** — see §5 |
| Macro | FRED (VIX, yields) | Keep |
| Auth | Site passcode gate (middleware + hashed cookie); Auth.js tables exist unused | Keep for now; multi-user later |
| Jobs | Vercel Cron ×2/day (Hobby cap) | **Insufficient for intraday** — see §5 |
| Tests | Vitest, 48 passing | Keep, extend |

## 2. What already exists and works (preserve)

- **Bar cache** (`daily_bars`, 305 symbols, ~82k rows) + rate-limit-aware backfill scripts. One grouped Polygon call refreshes the entire universe per day.
- **Indicator math** (`polygon.ts::computeMetricsFromBars`): EMA 9/20/50/200, RSI14, ATR14, relative volume, above-50d/200d. Pure, unit-tested.
- **Anchored VWAP** (`vwap.ts`): swing-low anchored VWAP + rising/falling state.
- **Setup detection** (`setups.ts`): Breakout, Pullback, IPO Base, Support Breakdown, MA Rejection, RS Leader Coil — shared by scanner AND backtester so logic cannot drift.
- **Breakout radar** (`alerts.ts` + `alerts` table): EMA stack + anchored VWAP + coil-under-resistance detection, strength-scored.
- **Backtester** (`backtest.ts`): next-open fills, stop-before-target, R-multiple reporting. Proved Pullback edge (+0.14R, PF 1.25, 3,633 signals) and killed the MA Rejection short.
- **Paper engine** (`paper.ts`): account/research cohort split, risk-normalized sizing, honest fills.
- **Provider HTTP core** (`providers/http.ts`): timeout, retry, exponential backoff, 429 handling, redacted logging.
- **Market regime + sector strength** engines with persistence.

## 3. What needs replacing or restructuring

| # | Item | Action |
|---|---|---|
| 1 | Nav is a flat 6-link bar; pages are documents, not panels | Replace with **terminal shell**: persistent panel layout, global ticker context, keyboard shortcuts |
| 2 | Universe hard-filters `price >= $5`, `avgVolume >= 1M` | **Replace with configurable universes** (spec §2: $0.25+ must be supported) |
| 3 | Scanners are hardcoded in `scanner.ts` | **Replace with rule-engine + Scanner Builder** persisted to DB |
| 4 | 7 fixed sectors, 250 tickers labeled "General" | Replace with **real sector/industry reference data** from Polygon tickers endpoint |
| 5 | No charts at all | **New**: candlestick charts w/ VWAP, EMA, MACD, volume overlays |
| 6 | Direct `polygon.ts` coupling | **Wrap in `MarketDataProvider` interface** (spec §36) so vendors are swappable |
| 7 | `data.ts` mock fallback | Replace with explicit **DATA UNAVAILABLE** states (spec §51) |
| 8 | No watchlists / journal / risk calculator UI | **New** |

## 4. Reusable component inventory
`db.ts`, `providers/http.ts`, `bars.ts`, `polygon.ts` indicator math, `vwap.ts`, `setups.ts`, `alerts.ts`, `backtest.ts`, `paper.ts`, `scoring.ts`, `regime.ts`, `env.ts`, ScoreBadge/DirectionBadge. All survive the restructure.

## 5. Data-provider limitations — THE governing constraint

Current plan: **Polygon free = end-of-day aggregates, 5 req/min, no intraday, no quotes, no WebSocket, no float/shares-outstanding, no halt status.**

Spec features that are **impossible without a paid feed**, and will render as `DATA UNAVAILABLE — requires real-time feed`:

| Spec § | Feature | Requires |
|---|---|---|
| §5 | Premarket gappers, premarket volume | Real-time or 15-min delayed intraday |
| §6 | Volume velocity (10s/30s/1m) | Real-time trades stream |
| §5 | HOD/LOD intraday, momentum surge | Intraday minute bars |
| §8 | Session VWAP (resets daily) | Intraday minute bars |
| §12 | Float, shares outstanding | Fundamentals/reference feed |
| §15 | Halt tracking | Real-time status feed |
| §23 | Bid/Ask/Spread | Real-time quotes |
| §37, §49 | WebSocket streaming, LIVE indicator | WebSocket subscription |

**Upgrade ladder (user decision, not required to proceed):**
1. **Polygon Stocks Starter $29/mo** — 15-min delayed, unlimited calls, **intraday minute bars**. Unlocks: session VWAP, HOD/LOD, premarket metrics, velocity (15-min lagged), scanning every 15 min. Best value step.
2. **Alpaca free** — real-time IEX WebSocket (partial volume) + free fundamentals. Good complement.
3. **Polygon real-time ~$199/mo** — true tick WebSocket, full LIVE terminal.
4. Scheduling: Vercel Hobby caps cron at 1/day → use **free external scheduler** (GitHub Actions / cron-job.org) hitting `/api/scan`, or Vercel Pro $20/mo.

**Design rule:** the terminal is built against the provider interface. Adding a key lights up dark panels with no UI rewrite.

## 6. Database changes required

New tables (Phase 1): `universes`, `scanner_presets`, `scanner_rules`, `scanner_columns`, `watchlists`, `watchlist_items`, `workspaces`, `workspace_panels`, `user_settings`, `stock_notes`, `journal_entries`, `alert_rules`, `alert_events`, `trade_tags`.
Extend: `tickers` (+`industry`, `float_shares`, `shares_outstanding`, `exchange`, `market_cap`, `is_active`), `alerts` (rule linkage, cooldown state).
**Not** stored: market ticks (spec §35/§39) — transient state stays in memory/cache.

## 7. Proposed real-time architecture (spec §37)
```
Provider (Polygon/Alpaca)
   ↓  MarketDataProvider interface  ← swappable vendor boundary
Ingestion service (REST poll now; WebSocket when subscribed)
   ↓  Normalization (vendor payload → internal Quote/Bar/Trade)
Real-time state engine (in-memory ring buffers per symbol, NOT the DB)
   ↓  Indicator engine (incremental EMA/VWAP/ATR/velocity)
Scanner engine (rule evaluation over the state snapshot)
   ↓  Setup engine → Alert engine (cooldowns, state-change triggers)
Frontend (SSE/WebSocket push; render-only, virtualized rows)
```
Tiered subscriptions: full universe on daily bars, focused watch-list symbols on the highest-frequency feed available. Never compute every indicator for every symbol every tick.

## 8. Proposed scanner architecture
Rules stored as JSON (`{field, op, value}` + AND/OR groups), evaluated server-side against a snapshot of computed metrics. Fields registry is typed and shared with the Scanner Builder UI so filters and columns cannot drift from the engine. Presets seed defaults; everything user-editable and persisted.

## 9. Proposed chart architecture
`lightweight-charts` (TradingView's open-source library, ~45kB, Apache-2.0 — permitted, not a copy of their product). Overlays: VWAP, EMA 9/20/50/200, volume histogram, MACD/RSI panes, session shading, prev-close/HOD/LOD/premarket lines. Timeframes render whatever the provider supplies; unavailable intraday intervals are disabled with a tooltip explaining why.

## 10. Implementation phases (mapped to spec §55)
- **Phase 1 (this delivery)** — provider abstraction, universes, scanner rule engine + presets + builder schema, watchlists, user settings, market-session calendar, terminal shell.
- **Phase 2** — charts + full indicator surface (MACD/RSI/ATR panes), stock detail panel.
- **Phase 3** — momentum engines A/B, intraday scanners *(gated on §5 upgrade)*.
- **Phase 4** — catalyst classification, SEC filings, dilution flags, halt tracking *(partly gated)*.
- **Phase 5** — setup scoring + explainability ("WHY?"), alert rules + cooldowns.
- **Phase 6** — sector/industry reference data, large-cap engine, relative strength.
- **Phase 7** — paper trading UI, risk calculator, journal, analytics.
- **Phase 8** — broker architecture (Alpaca paper first; **no live execution without explicit authorization**).

## 11. Files modified/created in Phase 1
New: `src/providers/marketData.ts`, `src/providers/polygonProvider.ts`, `src/lib/session.ts`, `src/lib/universe.ts`, `src/lib/scannerRules.ts`, `src/lib/fields.ts`, `src/components/terminal/*`, `db/migrations/0008_terminal_core.sql`.
Modified: `Nav.tsx` → terminal shell, `scanner.ts` (rule-engine driven), `types.ts`, `layout.tsx`.
Preserved untouched: backtest, paper, scoring, setups, vwap, alerts detection math.

## 12. Subscriptions eventually required
Polygon Starter/real-time (intraday+quotes), fundamentals source for float (Polygon reference or FMP), news feed (Polygon news free tier already in use; Benzinga optional), SEC EDGAR (free), broker API (Alpaca free).

## 13. Performance concerns
Row virtualization for scanner tables; push deltas not full snapshots; incremental indicator updates; in-memory transient state (no tick writes to Neon); scanner evaluation server-side; memoized panel rendering; batched DB writes per scan cycle.

## 14. Security concerns
API keys server-side only (already enforced); passcode gate on all pages, `CRON_SECRET` on job routes; per-user row scoping when multi-user lands; no secrets in logs (redaction already implemented); broker credentials isolated from market-data code; `ENABLE_LIVE_TRADING=false` hard default.
