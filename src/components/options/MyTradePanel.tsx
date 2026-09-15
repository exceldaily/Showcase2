"use client";

// "My trade": the trader records the contract they actually hold (any
// broker) and the terminal turns the chart's stock levels into option
// dollars for that contract, with one instruction for right now.
// Stored per symbol in localStorage; nothing is sent anywhere.

import { useEffect, useMemo, useState } from "react";
import { Lock, RefreshCw, X } from "lucide-react";
import type { OptionsAnalysis } from "@/lib/optionsTerminal";
import { positionRead, type MyTrade } from "@/lib/positionCoach";
import { parseOcc } from "@/lib/optionsMath";
import { etTime, fmt$, fmtPnl } from "@/lib/ui/format";
import { Stat } from "@/components/ui/primitives";

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
        plan: analysis.plan, state: analysis.machine?.state ?? null, direction: analysis.direction, slot: analysis.slot,
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

  return (
    <div className="px-3">
      <div className="flex h-8 items-center justify-between">
        <span className="panel-title text-mine">My trade</span>
        <span className="flex items-center gap-2 text-xs">
          {analysis.lock && (
            <span className="flex items-center gap-1 text-ink-faint" title={`Level locked ${etTime(analysis.lock.pickedAt)}${analysis.lock.pickedPrice !== null ? ` at ${fmt$(analysis.lock.pickedPrice)}` : ""}`}>
              <Lock size={10} /> {etTime(analysis.lock.pickedAt)}
              {isOwner && <button onClick={onRepick} className="btn-quiet h-5 px-1" data-tip="Drop the locked level and pick a fresh one"><RefreshCw size={9} /></button>}
            </span>
          )}
          {trade && !editing && (
            <>
              <button onClick={() => setEditing(true)} className="btn-quiet btn-sm">edit</button>
              <button onClick={() => onChange(null)} className="btn-quiet btn-sm hover:text-bear" title="I closed it"><X size={10} /> closed</button>
            </>
          )}
        </span>
      </div>

      {!trade && !editing && (
        <div className="flex items-center justify-between gap-2 rounded-md bg-bg-elevated/60 px-2.5 py-2">
          <span className="text-xs text-ink-muted">Holding a {analysis.symbol} option? Record it and the panel manages it with you.</span>
          <button onClick={() => setEditing(true)} className="btn-ghost btn-sm shrink-0 text-mine">I&apos;m in</button>
        </div>
      )}

      {editing && (
        <div className="space-y-1.5 rounded-md bg-bg-elevated/60 p-2.5 text-xs">
          <label className="block">
            <span className="stat-label">Contract</span>
            <select value={contract} onChange={(e) => { setContract(e.target.value); const c = analysis.contracts.find((x) => x.symbol === e.target.value); if (c && !trade) setEntry(c.mid.toFixed(2)); }} className="select mt-0.5 w-full py-1 font-mono text-xs">
              {options.map((c) => (
                <option key={c.symbol} value={c.symbol}>{c.strike}{c.side === "call" ? "C" : "P"} exp {c.expiry.slice(5)} · mid ${c.mid.toFixed(2)}</option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <label className="flex-1">
              <span className="stat-label">Entry (per share)</span>
              <input value={entry} onChange={(e) => setEntry(e.target.value)} inputMode="decimal" className="input mt-0.5 w-full py-1 font-mono" placeholder="1.20" />
            </label>
            <label className="w-20">
              <span className="stat-label">Contracts</span>
              <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" className="input mt-0.5 w-full py-1 font-mono" />
            </label>
          </div>
          <div className="flex gap-1">
            <button onClick={save} className="btn-primary btn-sm">Save</button>
            <button onClick={() => setEditing(false)} className="btn-ghost btn-sm">Cancel</button>
            <span className="ml-auto self-center text-2xs text-ink-faint">stays in this browser</span>
          </div>
        </div>
      )}

      {trade && !editing && read && (
        <div className="rounded-md bg-mine/5 p-2.5">
          <div className="flex items-baseline justify-between">
            <span className="num text-md font-semibold text-ink">{trade.qty}x {trade.strike}{trade.side === "call" ? "C" : "P"} <span className="text-xs font-normal text-ink-faint">exp {trade.expiry.slice(5)} · in {fmt$(trade.entry)}</span></span>
            {read.mid !== null ? (
              <span className={`num text-md font-semibold ${read.pnlDollars !== null && read.pnlDollars >= 0 ? "text-bull" : "text-bear"}`}>
                {fmtPnl(read.pnlDollars)} <span className="text-xs font-normal">({read.pnlPct !== null && read.pnlPct >= 0 ? "+" : ""}{Math.round(read.pnlPct ?? 0)}%)</span>
              </span>
            ) : (
              <span className="text-xs text-warn">no live quote</span>
            )}
          </div>
          <div className="mt-1.5 text-sm font-semibold text-ink">{read.headline}</div>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-xs leading-snug text-ink-muted">
            {read.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
          <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1.5">
            {read.atTarget1 && <Stat label={`At ${fmt$(read.atTarget1.stock)} (T1)`} size="sm" tone="bull">{fmt$(read.atTarget1.value)} <span className="text-xs">{fmtPnl(read.atTarget1.pnlDollars)}</span></Stat>}
            {read.atWrong && <Stat label={`At ${fmt$(read.atWrong.stock)} (wrong)`} size="sm" tone="bear">{fmt$(read.atWrong.value)} <span className="text-xs">{fmtPnl(read.atWrong.pnlDollars)}</span></Stat>}
            <Stat label="Break-even at expiry" size="sm" tone="muted">{fmt$(read.breakEven)}</Stat>
            {read.thetaPerHour !== null && <Stat label="Sitting still" size="sm" tone="warn">-${read.thetaPerHour}/hr</Stat>}
          </div>
        </div>
      )}
    </div>
  );
}
