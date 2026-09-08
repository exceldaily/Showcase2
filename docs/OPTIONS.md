# Options Command Center

Underlying-first options terminal on Alpaca Algo Trader Plus (SIP stocks + real-time OPRA options). Page: `/options`.

## Pipeline

```
Alpaca SIP/OPRA (server only)
  -> src/providers/alpaca.ts        REST client, TTL cache, request dedup, paper/live guards
  -> src/lib/intraday.ts            sessions (ET), resample, session VWAP, opening ranges,
                                    time-adjusted RVOL, LEVEL ENGINE (candidates -> ATR
                                    clustering -> 0-100 scored zones with reasons), 7-state trend
  -> src/lib/setupMachine.ts        breakout/retest state machine (WATCHING..INVALIDATED),
                                    confirmation checklist + quality, room-to-move, trade plan
                                    (trigger/T1-T3/invalidation), opportunity score
  -> src/lib/optionsMath.ts         OCC, Black-Scholes + greeks, implied vol, scenario ranges
  -> src/lib/optionsScore.ts        0-100 contract score, 4 profiles, stale-quote hard cap
  -> src/lib/optionsTerminal.ts     orchestrator (also powers replay via ?at=)
  -> /api/options/analyze           JSON payload for the UI (site-gated)
  -> src/components/options/*       chart, trade map, chain, compare, calculator, ticket
```

## Environment

| Var | Meaning |
|---|---|
| `ALPACA_API_KEY_ID` / `ALPACA_API_SECRET_KEY` | Server-side only. Never sent to the browser. |
| `ALPACA_PAPER` | `true` (default) = paper-api host. |
| `ENABLE_LIVE_TRADING` | Live orders require `ALPACA_PAPER=false` AND `ENABLE_LIVE_TRADING=true`. Checked on every submit. |

## Honesty rules

- No fake data: disconnected/insufficient states render as such.
- Stale option quotes (>60s while market open) cap the contract score at 25 and are labeled STALE.
- Greeks are tagged `alpaca` or `calculated` (Black-Scholes fallback); scenario outputs are ranges (IV ±10%), never penny estimates.
- Every level/zone, score, and state carries its reasons in the payload and UI.

## Replay

`/api/options/analyze?symbol=NVDA&at=2026-09-04T14:30:00Z` re-runs the identical pipeline with bars truncated at the cutoff (no-lookahead enforced by construction and by tests). The UI exposes this via the Replay picker in the top bar.

## Streaming note

Vercel serverless cannot hold WebSocket connections. Live updates use batched snapshot polling (2-3 Alpaca requests refresh the whole workspace, 5s cadence while the market is open) behind an in-module TTL/dedup layer — far below Algo Trader Plus limits. A dedicated WS worker (local Node process feeding Neon) is the documented upgrade path if sub-second ticks are ever needed.

## Journal

Every order placed through the terminal is written to `option_journal` (migration 0011) with a snapshot of the setup that motivated it (state, trigger, targets, invalidation, trend, RVOL, contract score, greeks) keyed by the idempotent `client_order_id`.

## Strike coach ("why not just buy the cheaper strike?")

`src/lib/strikeCoach.ts` (pure, tested) lays three choices side by side for each side's best contract: **Recommended** (the scored best), **Cheaper** (the strike at the first target), **Safer** (one strike further in the money). For each: cost per contract, value if the stock reaches the first target within the DAY step (30 min), value if it is only at the target when a same-day contract expires (intrinsic), value at the wrong line after an hour, and value after an hour of nothing. Prices are calibrated to the mid actually paid (implied vol solved from the mid) so "sits still" is pure time decay, never a phantom gain from a stale quote. `coachVerdict` writes the one-paragraph answer. Shown in the Best call / Best put cards (`SidesPanel`), in the morning watch strip, and in the morning email.

## Morning watch (top 1-3 to watch into the open)

Each pick carries a beginner **3-step play** on the leaning side (watch the trigger; then buy 1 of the recommended contract, with the cost and expiry; sell at the first target or get out at the wrong line), a "what 1 contract could do" table (reaches target soon / breaks the wrong way / sits still an hour) and the strike table. The email leads with those and keeps the reasons to three bullets. No scores in the email.

The strip at the top of `/options` ranks the megacap + S&P 100 universe premarket and shows the one to three names worth watching, with a lean (calls / puts / either), the current trigger plan, and plain-English reasons.

- **Pass 1 (cheap, one batched snapshot call):** premarket gap vs the last close, premarket volume as a fraction of a normal full day, proximity to yesterday's high (gap up) or low (gap down), liquidity. The level bonus only counts fully once there is some participation (a 0.3%+ gap or 2%+ of a normal day's volume).
- **Pass 2:** the full options pipeline on the top six for the daily/5-minute trend, the trigger + wrong line + first target, the history check (confirmed breaks that reached T1), and the best call/put. Final score = 65% pass-1 + 35% setup quality + a small history bonus.
- **Overnight** (before 4:00 ET) prices are the official close; stray after-hours prints are ignored and the note says so.
- **Locking:** the siren sweep (every minute on weekdays) freezes and emails the list once at or after 9:10 ET on session days. The owner can lock early with the button. `GET /api/options/morning?n=2` returns the locked list, or a live one cached 5 minutes (`&refresh=1` recomputes). `POST` locks (owner session or `Bearer CRON_SECRET`).
- Stored per ET day in `morning_watch` (migration 0016). Pure ranking + wording live in `src/lib/morningWatch.ts` and are unit tested.
