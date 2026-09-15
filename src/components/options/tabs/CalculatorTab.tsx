"use client";

// What-if calculator: Black-Scholes with the trader's own IV, strike,
// expiry and target. Every number is a model estimate.

import { useState } from "react";
import type { OptionsAnalysis } from "@/lib/optionsTerminal";
import { blackScholes, breakEvenAtExpiry, intrinsicValue, scenarioPrice, yearsToExpiry } from "@/lib/optionsMath";
import { fmt$ } from "@/lib/ui/format";
import { KV } from "@/components/ui/primitives";

export default function CalculatorTab({ analysis }: { analysis: OptionsAnalysis }) {
  const [side, setSide] = useState<"call" | "put">("call");
  const [strike, setStrike] = useState(analysis.price ? Math.round(analysis.price) : 100);
  const [expiry, setExpiry] = useState(() => new Date(Date.now() + 7 * 86400e3).toISOString().slice(0, 10));
  const [qty, setQty] = useState(1);
  const [entry, setEntry] = useState(2.5);
  const [target, setTarget] = useState(analysis.plan?.targets[0] ?? (analysis.price ?? 100) * 1.02);
  const [ivPct, setIvPct] = useState(35);

  const T = yearsToExpiry(expiry);
  const iv = ivPct / 100;
  const nowBs = analysis.price ? blackScholes(side, analysis.price, strike, T, iv) : null;
  const est = analysis.price ? scenarioPrice({ side, strike, expiry, iv, currentMid: entry, underlyingNow: analysis.price }, target, 60) : null;
  const cost = entry * qty * 100;
  const be = breakEvenAtExpiry(side, strike, entry);
  const intr = analysis.price ? intrinsicValue(side, strike, analysis.price) : 0;
  const input = "input w-28 py-0.5 text-sm num";

  return (
    <div className="flex h-full flex-wrap gap-8 overflow-auto p-3 text-sm">
      <div className="space-y-1.5">
        <div className="stat-label">Position</div>
        <label className="flex items-center justify-between gap-3">Side
          <select value={side} onChange={(e) => setSide(e.target.value as "call" | "put")} className={input}>
            <option value="call">Call</option><option value="put">Put</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-3">Strike <input type="number" value={strike} onChange={(e) => setStrike(Number(e.target.value))} className={input} /></label>
        <label className="flex items-center justify-between gap-3">Expiry <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={input} /></label>
        <label className="flex items-center justify-between gap-3">Contracts <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value)))} className={input} /></label>
        <label className="flex items-center justify-between gap-3">Option price <input type="number" step={0.05} value={entry} onChange={(e) => setEntry(Number(e.target.value))} className={input} /></label>
        <label className="flex items-center justify-between gap-3">Target stock <input type="number" step={0.1} value={target} onChange={(e) => setTarget(Number(e.target.value))} className={input} /></label>
        <label className="flex items-center justify-between gap-3">IV % <input type="number" min={5} max={300} value={ivPct} onChange={(e) => setIvPct(Number(e.target.value))} className={input} /></label>
      </div>
      <div className="min-w-[260px]">
        <div className="stat-label mb-1">Result (model estimates)</div>
        <KV k="Cost basis" v={fmt$(cost, 0)} />
        <KV k="Underlying now" v={fmt$(analysis.price)} />
        <KV k="Intrinsic now" v={fmt$(intr)} />
        <KV k="Model value now" v={nowBs ? fmt$(nowBs.price) : "—"} />
        {nowBs && <KV k="Model greeks" v={`Δ${nowBs.delta.toFixed(2)} Γ${nowBs.gamma.toFixed(3)} Θ${nowBs.theta.toFixed(2)}/d`} />}
        <KV k="Break-even at expiry" v={fmt$(be)} />
        {est && (
          <>
            <KV k={`Est option at ${fmt$(target)}`} v={`${fmt$(est.low)}–${fmt$(est.high)}`} />
            <KV k="Est position value" v={`${fmt$(est.perContractLow * qty, 0)}–${fmt$(est.perContractHigh * qty, 0)}`} />
            <KV k="Est P/L" v={`${fmt$(est.perContractLow * qty - cost, 0)} to ${fmt$(est.perContractHigh * qty - cost, 0)}`} tone={est.perContractLow * qty - cost >= 0 ? "bull" : "muted"} />
          </>
        )}
        <p className="pt-2 text-2xs text-ink-faint">Black-Scholes with your IV assumption. Early exercise and IV shifts are not predicted; ranges span IV ±10%.</p>
      </div>
    </div>
  );
}
