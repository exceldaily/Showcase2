"use client";

// Option chain table with filters. Phase 3 replaces this with the
// ranked, virtualized chain; until then it is the existing chain with
// the shared table styling.

import { useMemo, useState } from "react";
import type { OptionsAnalysis, RankedContract } from "@/lib/optionsTerminal";
import { fmtInt } from "@/lib/ui/format";
import { Seg } from "@/components/ui/primitives";

export default function ChainTab({
  analysis, compareSet, setCompareSet, onTicket, canTicket,
}: {
  analysis: OptionsAnalysis;
  compareSet: string[];
  setCompareSet: (fn: (v: string[]) => string[]) => void;
  onTicket: (c: RankedContract) => void;
  canTicket: boolean;
}) {
  const [side, setSide] = useState<"all" | "call" | "put">("all");
  const [expiry, setExpiry] = useState<string>("all");
  const [maxSpread, setMaxSpread] = useState(15);
  const [minOi, setMinOi] = useState(0);
  const [minDelta, setMinDelta] = useState(0);

  const expiries = useMemo(() => Array.from(new Set(analysis.contracts.map((c) => c.expiry))).sort(), [analysis]);
  const rows = useMemo(
    () =>
      analysis.contracts
        .filter((c) => (side === "all" ? true : c.side === side))
        .filter((c) => (expiry === "all" ? true : c.expiry === expiry))
        .filter((c) => c.spreadPct === null || c.spreadPct <= maxSpread)
        .filter((c) => c.openInterest >= minOi)
        .filter((c) => c.delta === null || Math.abs(c.delta) >= minDelta)
        .sort((a, b) => a.strike - b.strike || a.expiry.localeCompare(b.expiry)),
    [analysis, side, expiry, maxSpread, minOi, minDelta]
  );
  const bestCall = analysis.sides.call.best?.symbol;
  const bestPut = analysis.sides.put.best?.symbol;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-2 py-1 text-xs">
        <Seg value={side} onChange={setSide} options={[{ key: "all", label: "All" }, { key: "call", label: "Calls" }, { key: "put", label: "Puts" }]} />
        <select value={expiry} onChange={(e) => setExpiry(e.target.value)} className="select py-0.5 text-xs">
          <option value="all">All expiries</option>
          {expiries.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <label className="flex items-center gap-1 text-ink-faint">
          Max spread <span className="num text-ink-muted">{maxSpread}%</span>
          <input type="range" min={2} max={30} value={maxSpread} onChange={(e) => setMaxSpread(Number(e.target.value))} className="w-20 align-middle accent-brand" />
        </label>
        <label className="flex items-center gap-1 text-ink-faint">
          Min OI <input type="number" value={minOi} onChange={(e) => setMinOi(Number(e.target.value) || 0)} className="input w-16 py-0.5 text-xs" />
        </label>
        <label className="flex items-center gap-1 text-ink-faint">
          Min |Δ| <input type="number" step={0.05} min={0} max={1} value={minDelta} onChange={(e) => setMinDelta(Number(e.target.value) || 0)} className="input w-16 py-0.5 text-xs" />
        </label>
        <span className="ml-auto text-ink-faint">{rows.length} contracts{analysis.indexMode ? " · CBOE delayed" : ""}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="tbl">
          <thead>
            <tr>
              {["", "Type", "Strike", "Exp", "DTE", "Bid", "Ask", "Mid", "Spr%", "Vol", "OI", "IV", "Δ", "Γ", "Θ", "B/E", "Intr", "Extr", "Money", "Score", ""].map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.symbol} className={c.stale ? "opacity-50" : ""} data-on={c.symbol === bestCall || c.symbol === bestPut}>
                <td>
                  <input type="checkbox" className="accent-brand" checked={compareSet.includes(c.symbol)} onChange={() => setCompareSet((v) => (v.includes(c.symbol) ? v.filter((x) => x !== c.symbol) : [...v, c.symbol].slice(-4)))} title="Compare" />
                </td>
                <td className={`font-semibold ${c.side === "call" ? "text-bull" : "text-bear"}`}>{c.side === "call" ? "C" : "P"}</td>
                <td className="num font-semibold">{c.strike}</td>
                <td className="num text-ink-muted">{c.expiry.slice(5)}</td>
                <td className="num text-ink-muted">{c.dte}</td>
                <td className="num">{c.bid.toFixed(2)}</td>
                <td className="num">{c.ask.toFixed(2)}</td>
                <td className="num text-ink-muted">{c.mid.toFixed(2)}</td>
                <td className={`num ${c.spreadPct !== null && c.spreadPct > 8 ? "text-warn" : "text-ink-muted"}`}>{c.spreadPct ?? "—"}</td>
                <td className="num text-ink-muted">{fmtInt(c.volume)}</td>
                <td className="num text-ink-muted">{fmtInt(c.openInterest)}</td>
                <td className="num text-ink-muted">{c.iv !== null ? `${(c.iv * 100).toFixed(0)}%` : "—"}</td>
                <td className="num">{c.delta ?? "—"}</td>
                <td className="num text-ink-muted">{c.gamma ?? "—"}</td>
                <td className="num text-ink-muted">{c.theta ?? "—"}</td>
                <td className="num text-ink-muted">{c.breakEven.toFixed(2)}</td>
                <td className="num text-ink-muted">{c.intrinsic.toFixed(2)}</td>
                <td className="num text-ink-muted">{c.extrinsic.toFixed(2)}</td>
                <td className={`text-2xs font-semibold ${c.moneyness === "ITM" ? "text-bull" : c.moneyness === "ATM" ? "text-brand-glow" : "text-ink-faint"}`}>{c.moneyness}</td>
                <td className="num font-semibold">{c.stale ? <span className="text-bear">STALE</span> : c.score}</td>
                <td>
                  {canTicket && <button onClick={() => onTicket(c)} className="btn-quiet btn-sm">Ticket</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="p-4 text-center text-xs text-ink-muted">No contracts pass the filters.</div>}
      </div>
    </div>
  );
}
