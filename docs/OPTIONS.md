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
