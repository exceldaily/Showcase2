// Order endpoint. PAPER by default — live requires ALPACA_PAPER=false
// AND ENABLE_LIVE_TRADING=true (re-checked in the provider on every
// call). Client order ids make submissions idempotent; every accepted
// order is journaled with a snapshot of the setup that motivated it.

import { NextResponse } from "next/server";
import { cancelOrder, hasAlpacaKeys, isPaper, submitOrder, AlpacaError } from "@/providers/alpaca";
import { parseOcc } from "@/lib/optionsMath";
import { hasDatabase, query } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface OrderBody {
  symbol?: string;
  qty?: number;
  side?: "buy" | "sell";
  type?: "market" | "limit";
  limitPrice?: number;
  clientOrderId?: string;
  setupSnapshot?: unknown;
}

export async function POST(request: Request) {
  if (!hasAlpacaKeys()) return NextResponse.json({ error: "Alpaca not configured" }, { status: 503 });
  let body: OrderBody;
  try {
    body = (await request.json()) as OrderBody;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const symbol = (body.symbol ?? "").toUpperCase();
  const occ = parseOcc(symbol);
  if (!occ) return NextResponse.json({ error: "orders are limited to option contracts (OCC symbol)" }, { status: 400 });
  if (body.side !== "buy" && body.side !== "sell") return NextResponse.json({ error: "side must be buy or sell" }, { status: 400 });
  if (body.type !== "market" && body.type !== "limit") return NextResponse.json({ error: "type must be market or limit" }, { status: 400 });
  const qty = Number(body.qty);
  const clientOrderId = String(body.clientOrderId ?? "");
  if (!/^[a-zA-Z0-9_-]{8,48}$/.test(clientOrderId)) {
    return NextResponse.json({ error: "clientOrderId required (idempotency)" }, { status: 400 });
  }

  try {
    const order = await submitOrder({
      symbol, qty, side: body.side, type: body.type,
      limitPrice: body.limitPrice, clientOrderId,
    });
    if (hasDatabase()) {
      await query(
        `insert into option_journal (client_order_id, alpaca_order_id, occ_symbol, underlying, side, qty, order_type, limit_price, paper, setup_snapshot)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (client_order_id) do nothing`,
        [
          clientOrderId, order.id, symbol, occ.underlying, body.side, qty, body.type,
          body.limitPrice ?? null, isPaper(),
          JSON.stringify(body.setupSnapshot ?? null),
        ]
      ).catch(() => undefined); // journaling must never block an order response
    }
    return NextResponse.json({ ok: true, order: { id: order.id, status: order.status, symbol: order.symbol } });
  } catch (e) {
    const status = e instanceof AlpacaError ? (e.status === 403 ? 403 : 422) : 500;
    const msg = e instanceof Error ? e.message : "order failed";
    return NextResponse.json({ error: msg.replace(/APCA[^\s]*/g, "") }, { status });
  }
}

export async function DELETE(request: Request) {
  if (!hasAlpacaKeys()) return NextResponse.json({ error: "Alpaca not configured" }, { status: 503 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  try {
    await cancelOrder(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "cancel failed";
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}
