// Broker summary: connection, paper/live mode, account, positions
// (options enriched with live OPRA marks), open orders. No secrets in
// the response, ever.

import { NextResponse } from "next/server";
import {
  getAccount, getClock, getOptionSnapshots, getOrders, getPositions,
  hasAlpacaKeys, isPaper, liveTradingEnabled,
} from "@/providers/alpaca";
import { parseOcc } from "@/lib/optionsMath";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  if (!hasAlpacaKeys()) {
    return NextResponse.json({
      connected: false, paper: true, liveEnabled: false,
      account: null, clock: null, positions: [], orders: [],
    });
  }
  try {
    const [account, clock, positions, orders] = await Promise.all([
      getAccount(), getClock(), getPositions(), getOrders("all", 25),
    ]);
    // Live marks for option positions.
    const occSymbols = positions.map((p) => p.symbol).filter((s) => parseOcc(s));
    const snaps = occSymbols.length ? await getOptionSnapshots(occSymbols).catch(() => ({})) : {};
    const enriched = positions.map((p) => {
      const s = (snaps as Record<string, { latestQuote?: { bp: number; ap: number; t: string } }>)[p.symbol];
      const occ = parseOcc(p.symbol);
      return {
        symbol: p.symbol,
        underlying: occ?.underlying ?? p.symbol,
        side: occ?.side ?? null,
        strike: occ?.strike ?? null,
        expiry: occ?.expiry ?? null,
        qty: Number(p.qty),
        avgEntry: Number(p.avg_entry_price),
        currentPrice: p.current_price ? Number(p.current_price) : null,
        marketValue: p.market_value ? Number(p.market_value) : null,
        unrealizedPl: p.unrealized_pl ? Number(p.unrealized_pl) : null,
        unrealizedPlPct: p.unrealized_plpc ? Number(p.unrealized_plpc) * 100 : null,
        liveBid: s?.latestQuote?.bp ?? null,
        liveAsk: s?.latestQuote?.ap ?? null,
        quoteTs: s?.latestQuote?.t ?? null,
        assetClass: p.asset_class,
      };
    });
    return NextResponse.json({
      connected: true,
      paper: isPaper(),
      liveEnabled: liveTradingEnabled(),
      account: {
        status: account.status,
        equity: Number(account.equity),
        buyingPower: Number(account.buying_power),
        optionsBuyingPower: account.options_buying_power ? Number(account.options_buying_power) : null,
        optionsLevel: account.options_trading_level ?? null,
      },
      clock: { isOpen: clock.is_open, nextOpen: clock.next_open, nextClose: clock.next_close },
      positions: enriched,
      orders: orders.map((o) => ({
        id: o.id, symbol: o.symbol, qty: Number(o.qty), filledQty: Number(o.filled_qty),
        side: o.side, type: o.type, status: o.status,
        limitPrice: o.limit_price ? Number(o.limit_price) : null,
        filledAvgPrice: o.filled_avg_price ? Number(o.filled_avg_price) : null,
        submittedAt: o.submitted_at,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "broker error";
    return NextResponse.json({ connected: false, error: msg.replace(/APCA[^\s]*/g, "") }, { status: 502 });
  }
}
