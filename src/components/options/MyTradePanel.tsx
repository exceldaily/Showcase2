"use client";

// "My trade": the trader records the contract they actually hold (any
// broker) and the terminal turns the chart's stock levels into option
// dollars for that contract, with one instruction for right now.
// Stored per symbol in localStorage; nothing is sent anywhere.

import { useEffect, useMemo, useState } from "react";
import { Briefcase, Lock, RefreshCw, X } from "lucide-react";
import type { OptionsAnalysis } from "@/lib/optionsTerminal";
import { positionRead, type MyTrade } from "@/lib/positionCoach";
import { parseOcc } from "@/lib/optionsMath";

export function tradeKey(symbol: string): string {
  return `af_trade:${symbol}`;
}

export function loadTrade(symbol: string): MyTrade | null {
  try {
    const raw = localStorage.getItem(tradeKey(symbol));
    return raw ? (JSON.parse(raw) as MyTrade) : null;
  } catch {
    return null;
  }
}

function etTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }) + " ET";
}

export default function MyTradePanel({
  analysis, trade, onChange, isOwner, onRepick,
}: {
  analysis: OptionsAnalysis;
  trade: MyTrade | null;
  onChange: (t: MyTrade | null) => void;
  isOwner: boolean;
  onRepick: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [contract, setContract] = useState<string>("");
  const [entry, setEntry] = useState<string>("");
  const [qty, setQty] = useState<string>("1");

  const options = useMemo(() => {
    const price = analysis.price ?? 0;
    return [...analysis.contracts]
      .filter((c) => price === 0 || Math.abs(c.strike - price) / price < 0.08)
      .sort((a, b) => a.expiry.localeCompare(b.expiry) || a.side.localeCompare(b.side) || a.strike - b.strike);
  }, [analysis.contracts, analysis.price]);

  useEffect(() => {
    if (!editing) return;
    const def = trade?.contract ?? analysis.sides.call.best?.symbol ?? options[0]?.symbol ?? "";
    setContract(def);
    const c = analysis.contracts.find((x) => x.symbol === def);
    setEntry(trade ? String(trade.entry) : c ? c.mid.toFixed(2) : "");
    setQty(trade ? String(trade.qty) : "1");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const live = trade ? analysis.contracts.find((c) => c.symbol === trade.contract) ?? null : null;
  const read = trade && analysis.price !== null
    ? positionRead({
        trade, price: analysis.price, mid: live?.mid ?? null, iv: live?.iv ?? null,
        plan: analysis.plan, state: analysis.machine?.state ?? null, direction: analysis.direction,
      })
    : null;

  function save() {
    const occ = parseOcc(contract);
    const e = Number(entry);
    const q = Math.max(1, Math.floor(Number(qty) || 1));
    if (!occ || !(e > 0)) return;
    onChange({ contract, side: occ.side, strike: occ.strike, expiry: occ.expiry, entry: e, qty: q });
    setEditing(false);
  }

  const lockLine = analysis.lock ? (
    <div className="flex items-center gap-1.5 text-[10px] text-ink-faint">
      <Lock size={10} /> Level locked {etTime(analysis.lock.pickedAt)}
      {analysis.lock.pickedPrice !== null && <span>(price was ${analysis.lock.pickedPrice.toFixed(2)})</span>}
      {isOwner && (
        <button onClick={onRepick} className="ml-1 inline-flex items-center gap-0.5 rounded border border-border px-1 py-px hover:text-ink" title="Drop today's locked level and pick a fresh one from the current structure">
          <RefreshCw size={9} /> re-pick
        </button>
      )}
    </div>
  ) : null;

  return (
    <div className="border-b border-border px-2 py-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint"><Briefcase size={11} /> My trade</span>
        {trade && !editing && (
          <span className="flex items-center gap-2">
            <button onClick={() => setEditing(true)} className="text-[10px] text-ink-faint hover:text-ink">edit</button>
            <button onClick={() => onChange(null)} className="inline-flex items-center gap-0.5 text-[10px] text-ink-faint hover:text-bear" title="I closed it"><X size={10} /> closed it</button>
          </span>
        )}
      </div>
      {lockLine && <div className="mt-1">{lockLine}</div>}

      {!trade && !editing && (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="text-[10px] text-ink-muted">Holding a {analysis.symbol} option? Tell the chart and it will manage it with you.</span>
          <button onClick={() => setEditing(true)} className="shrink-0 rounded bg-brand/20 px-2 py-0.5 text-[10px] font-semibold text-brand-glow hover:bg-brand/30">I&apos;m in a trade</button>
        </div>
      )}

      {editing && (
        <div className="mt-1.5 space-y-1.5 text-[10px]">
          <label className="block">
            <span className="text-ink-faint">Contract</span>
            <select value={contract} onChange={(e) => { setContract(e.target.value); const c = analysis.contracts.find((x) => x.symbol === e.target.value); if (c && !trade) setEntry(c.mid.toFixed(2)); }} className="mt-0.5 w-full rounded border border-border bg-bg-elevated px-1.5 py-1 font-mono text-[10px] outline-none">
              {options.map((c) => (
                <option key={c.symbol} value={c.symbol}>
                  {c.strike}{c.side === "call" ? "C" : "P"} exp {c.expiry.slice(5)} · mid ${c.mid.toFixed(2)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <label className="flex-1">
              <span className="text-ink-faint">Your entry (per share)</span>
              <input value={entry} onChange={(e) => setEntry(e.target.value)} inputMode="decimal" className="mt-0.5 w-full rounded border border-border bg-bg-elevated px-1.5 py-1 font-mono outline-none" placeholder="1.20" />
            </label>
            <label className="w-16">
              <span className="text-ink-faint">Contracts</span>
              <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" className="mt-0.5 w-full rounded border border-border bg-bg-elevated px-1.5 py-1 font-mono outline-none" />
            </label>
          </div>
          <div className="flex gap-1">
            <button onClick={save} className="rounded bg-brand px-2 py-0.5 font-semibold text-white hover:bg-brand-glow">Save</button>
            <button onClick={() => setEditing(false)} className="rounded border border-border px-2 py-0.5 text-ink-muted hover:text-ink">Cancel</button>
          </div>
          <div className="text-ink-faint">Stays in this browser only. Nothing is placed or sent anywhere.</div>
        </div>
      )}

      {trade && !editing && read && (
        <div className="mt-1.5">
          <div className="font-mono text-[11px]">
            <span className="text-ink">{trade.qty}x {analysis.symbol} {trade.strike}{trade.side === "call" ? "C" : "P"}</span>
            <span className="ml-1 text-ink-faint">exp {trade.expiry.slice(5)} · in at ${trade.entry.toFixed(2)}</span>
            {read.mid !== null ? (
              <span className={`ml-2 font-bold ${read.pnlDollars !== null && read.pnlDollars >= 0 ? "text-bull" : "text-bear"}`}>
                now ${read.mid.toFixed(2)} · {read.pnlDollars !== null && read.pnlDollars >= 0 ? "+" : "-"}${Math.abs(Math.round(read.pnlDollars ?? 0))} ({read.pnlPct !== null && read.pnlPct >= 0 ? "+" : ""}{Math.round(read.pnlPct ?? 0)}%)
              </span>
            ) : (
              <span className="ml-2 text-warn">no live quote for this contract</span>
            )}
          </div>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-[11px] leading-snug text-ink">
            {read.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
          <div className="mt-1 grid grid-cols-2 gap-x-2 font-mono text-[10px] text-ink-muted">
            {read.atTarget1 && <div>at ${read.atTarget1.stock.toFixed(2)} (target 1): <span className="text-bull">${read.atTarget1.value.toFixed(2)} ({read.atTarget1.pnlDollars >= 0 ? "+" : "-"}${Math.abs(Math.round(read.atTarget1.pnlDollars))})</span></div>}
            {read.atWrong && <div>at ${read.atWrong.stock.toFixed(2)} (wrong): <span className="text-bear">${read.atWrong.value.toFixed(2)} ({read.atWrong.pnlDollars >= 0 ? "+" : "-"}${Math.abs(Math.round(read.atWrong.pnlDollars))})</span></div>}
            <div>break-even at expiry: ${read.breakEven.toFixed(2)}</div>
            {read.thetaPerHour !== null && <div>sitting still: about -${read.thetaPerHour}/hr</div>}
          </div>
        </div>
      )}
    </div>
  );
}
