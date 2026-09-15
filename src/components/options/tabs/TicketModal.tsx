"use client";

// Paper order ticket (owner only, Alpaca paper account). Review and
// confirm; nothing is placed automatically. The exit plan is shown as
// model estimates because Alpaca has no stop orders on options.

import { useRef, useState } from "react";
import type { OptionsAnalysis, RankedContract } from "@/lib/optionsTerminal";
import type { Broker } from "../types";
import { scenarioPrice } from "@/lib/optionsMath";
import { roundToTick } from "@/lib/sirenRules";
import { fmt$ } from "@/lib/ui/format";

export default function TicketModal({
  contract, analysis, broker, onClose, onDone,
}: {
  contract: RankedContract;
  analysis: OptionsAnalysis;
  broker: Broker | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [qty, setQty] = useState(1);
  const [type, setType] = useState<"limit" | "market">("limit");
  const [limit, setLimit] = useState(contract.mid > 0 ? contract.mid : contract.ask);
  const [review, setReview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const clientOrderIdRef = useRef(`af-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

  const estDebit = (type === "limit" ? limit : contract.ask) * qty * 100;
  const bp = broker?.account?.optionsBuyingPower ?? broker?.account?.buyingPower ?? null;

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const r = await fetch("/api/broker/order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: contract.symbol, qty, side, type,
          limitPrice: type === "limit" ? Math.round(limit * 100) / 100 : undefined,
          clientOrderId: clientOrderIdRef.current,
          setupSnapshot: {
            underlyingPrice: analysis.price, state: analysis.machine?.state, quality: analysis.machine?.quality,
            trigger: analysis.plan?.trigger, targets: analysis.plan?.targets, invalidation: analysis.plan?.invalidation,
            trend: analysis.trend?.label, rvol: analysis.rvol, contractScore: contract.score,
            delta: contract.delta, iv: contract.iv, opportunity: analysis.opportunity?.total,
          },
        }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string; order?: { status: string } };
      if (!r.ok || !j.ok) throw new Error(j.error ?? "order failed");
      setResult(`Order ${j.order?.status ?? "submitted"} ✔`);
      setTimeout(onDone, 1200);
    } catch (e) {
      setResult(e instanceof Error ? e.message : "order failed");
      setSubmitting(false);
    }
  };

  const exit = analysis.plan && analysis.price !== null ? (() => {
    const inp = { side: contract.side, strike: contract.strike, expiry: contract.expiry, iv: contract.iv, currentMid: contract.mid, underlyingNow: analysis.price };
    const atInv = scenarioPrice(inp, analysis.plan.invalidation, 60);
    const atT1 = scenarioPrice(inp, analysis.plan.targets[0], 60);
    const stop = roundToTick(atInv.midEstimate);
    return { stop, stopLimit: roundToTick(stop * 0.9), target: roundToTick(atT1.midEstimate) };
  })() : null;

  const input = "input w-28 py-0.5 text-sm num";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg bg-bg-card p-4 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-md font-semibold">
            {analysis.symbol} {contract.strike}{contract.side === "call" ? "C" : "P"} {contract.expiry}
          </span>
          <span className={`pill ${broker?.paper === false ? "bg-bear/15 text-bear" : "bg-warn/15 text-warn"}`}>
            {broker?.paper === false ? "LIVE ORDER" : "PAPER"}
          </span>
        </div>
        {!review ? (
          <>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <label className="flex items-center justify-between">Side
                <select value={side} onChange={(e) => setSide(e.target.value as "buy" | "sell")} className={input}>
                  <option value="buy">Buy to open</option>
                  <option value="sell">Sell to close</option>
                </select>
              </label>
              <label className="flex items-center justify-between">Qty
                <input type="number" min={1} max={100} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(100, Number(e.target.value))))} className={input} />
              </label>
              <label className="flex items-center justify-between">Type
                <select value={type} onChange={(e) => setType(e.target.value as "limit" | "market")} className={input}>
                  <option value="limit">Limit</option>
                  <option value="market">Market</option>
                </select>
              </label>
              {type === "limit" && (
                <label className="flex items-center justify-between">Limit
                  <input type="number" step={0.01} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className={input} />
                </label>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-1 font-mono text-xs text-ink-muted">
              <span>Bid {fmt$(contract.bid)} / Ask {fmt$(contract.ask)}</span>
              <span>Spread {contract.spreadPct ?? "—"}%</span>
              <span>Est {side === "buy" ? "debit" : "credit"} {fmt$(estDebit, 0)}</span>
              <span>Options BP {bp !== null ? fmt$(bp, 0) : "—"}</span>
            </div>
            {analysis.plan && (
              <div className="mt-2 text-xs text-ink-faint">
                Setup {analysis.machine?.state} · trigger {fmt$(analysis.plan.trigger)} · T1 {fmt$(analysis.plan.targets[0])} · invalid {fmt$(analysis.plan.invalidation)}
              </div>
            )}
            {exit && analysis.plan && (
              <div className="mt-2 rounded-md bg-bg-elevated px-2 py-1.5 text-xs">
                <div className="stat-label">Exit plan (model estimates)</div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 font-mono text-ink-muted">
                  <span>Stop-limit sell: trigger <span className="text-bear">{fmt$(exit.stop)}</span> / limit {fmt$(exit.stopLimit)}</span>
                  <span>Target sell: <span className="text-bull">{fmt$(exit.target)}</span></span>
                  <span className="text-ink-faint">if {analysis.symbol} reaches {fmt$(analysis.plan.invalidation)}</span>
                  <span className="text-ink-faint">if {analysis.symbol} reaches {fmt$(analysis.plan.targets[0])}</span>
                </div>
                <div className="mt-1 text-2xs text-ink-faint">Alpaca has no stop orders on options, so the stop is your plan. Ranges shift with IV.</div>
              </div>
            )}
            {contract.stale && <div className="mt-2 text-xs font-semibold text-bear">Quote is STALE. Refresh before trading.</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={onClose} className="btn-ghost">Cancel</button>
              <button onClick={() => setReview(true)} disabled={bp !== null && side === "buy" && estDebit > bp} className="btn-primary">Review order</button>
            </div>
            {bp !== null && side === "buy" && estDebit > bp && <div className="mt-1 text-right text-xs text-bear">Insufficient options buying power.</div>}
          </>
        ) : (
          <>
            <div className="rounded-md bg-warn/10 p-2 text-sm text-ink">
              <div className="font-semibold">{side === "buy" ? "BUY TO OPEN" : "SELL TO CLOSE"} {qty} × {contract.symbol}</div>
              <div className="mt-0.5 font-mono text-xs text-ink-muted">
                {type.toUpperCase()}{type === "limit" ? ` @ ${fmt$(limit)}` : ""} · est {side === "buy" ? "debit" : "credit"} {fmt$(estDebit, 0)} · day order
              </div>
            </div>
            {result && <div className={`mt-2 text-sm ${result.includes("✔") ? "text-bull" : "text-bear"}`}>{result}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setReview(false)} className="btn-ghost" disabled={submitting}>Back</button>
              <button onClick={submit} disabled={submitting || Boolean(result?.includes("✔"))} className="btn bg-bull/20 font-semibold text-bull hover:bg-bull/30">
                {submitting ? "Submitting…" : "Confirm paper order"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
