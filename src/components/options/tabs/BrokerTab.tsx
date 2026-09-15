"use client";

// Paper account view: positions and orders from the connected Alpaca
// paper account. Read-only for members; the owner can cancel.

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import type { Broker } from "../types";
import { fmt$, pct } from "@/lib/ui/format";
import { StateBox } from "@/components/ui/primitives";

const OPEN_STATUSES = ["new", "accepted", "pending_new", "partially_filled"];

export default function BrokerTab({ broker, refresh, isOwner }: { broker: Broker | null; refresh: () => void; isOwner: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!broker) return <StateBox kind="loading" headline="Loading account" />;
  if (!broker.connected) return <StateBox kind="error" headline="Broker not connected" detail={broker.error ?? null} />;
  const cancel = async (id: string) => {
    setBusy(id);
    await fetch(`/api/broker/order?id=${id}`, { method: "DELETE" }).catch(() => undefined);
    setBusy(null);
    refresh();
  };
  return (
    <div className="grid h-full gap-6 overflow-auto p-3 lg:grid-cols-2">
      <div>
        <div className="mb-1 flex items-center gap-2 stat-label">
          Paper positions <button onClick={refresh} className="btn-quiet h-5 px-1" data-tip="Refresh"><RefreshCw size={10} /></button>
        </div>
        {broker.positions.length === 0 ? (
          <div className="text-sm text-ink-muted">No open positions.</div>
        ) : (
          broker.positions.map((p) => (
            <div key={p.symbol} className="mb-1 rounded-md bg-bg-elevated/60 p-2 text-sm">
              <div className="flex justify-between font-mono font-semibold">
                <span>{p.underlying} {p.strike}{p.side === "call" ? "C" : p.side === "put" ? "P" : ""} {p.expiry?.slice(5) ?? ""} ×{p.qty}</span>
                <span className={p.unrealizedPl !== null && p.unrealizedPl >= 0 ? "text-bull" : "text-bear"}>
                  {p.unrealizedPl !== null ? `${p.unrealizedPl >= 0 ? "+" : ""}$${p.unrealizedPl.toFixed(0)} (${pct(p.unrealizedPlPct)})` : "—"}
                </span>
              </div>
              <div className="mt-0.5 grid grid-cols-3 gap-1 font-mono text-xs text-ink-muted">
                <span>Entry {fmt$(p.avgEntry)}</span>
                <span>Mark {fmt$(p.currentPrice)}</span>
                <span>Bid/Ask {p.liveBid ?? "—"}/{p.liveAsk ?? "—"}</span>
              </div>
            </div>
          ))
        )}
      </div>
      <div>
        <div className="mb-1 stat-label">Orders</div>
        {broker.orders.length === 0 ? (
          <div className="text-sm text-ink-muted">No orders yet.</div>
        ) : (
          broker.orders.map((o) => (
            <div key={o.id} className="mb-0.5 flex items-center justify-between border-b border-border/40 py-0.5 font-mono text-xs">
              <span className="text-ink-muted">
                {o.side.toUpperCase()} {o.qty} {o.symbol} {o.type}{o.limitPrice ? ` @${o.limitPrice}` : ""} · {o.status}
                {o.filledAvgPrice ? ` · filled ${fmt$(o.filledAvgPrice)}` : ""}
              </span>
              {isOwner && OPEN_STATUSES.includes(o.status) && (
                <button onClick={() => cancel(o.id)} disabled={busy === o.id} className="btn-quiet btn-sm text-bear">
                  {busy === o.id ? "…" : "Cancel"}
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
