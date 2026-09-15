"use client";

// Trade planner: pick a contract and a size, see the exact plan and the
// deterministic risk numbers before anything is bought anywhere.
// Values at the plan levels are model estimates and are labelled so.

import { useEffect, useMemo, useState } from "react";
import type { OptionsAnalysis, RankedContract } from "@/lib/optionsTerminal";
import { scenarioPrice } from "@/lib/optionsMath";
import type { MyTrade } from "@/lib/positionCoach";
import { evaluateRisk, maxContractsWithinRisk, saveRiskSettings, type RiskSettings } from "@/lib/riskEngine";
import { contractLabel, expiryLabel, fmt$, fmtPnl, pct } from "@/lib/ui/format";
import { signTone, TONE_TEXT, type Tone } from "@/lib/ui/tone";
import { Chip, Disclosure, KV, Stat } from "@/components/ui/primitives";
import type { DecisionRead } from "@/lib/decision/lifecycle";
import { plannedEntry } from "@/lib/planEntry";

export default function TradePlanner({
  analysis, decision, contract, onPickContract, risk, setRisk, myTrade, onRecord,
}: {
  analysis: OptionsAnalysis;
  decision: DecisionRead | null;
  contract: RankedContract | null;
  onPickContract: (symbol: string) => void;
  risk: RiskSettings;
  setRisk: (s: RiskSettings) => void;
  myTrade: MyTrade | null;
  onRecord: (t: MyTrade) => void;
}) {
  const [qty, setQty] = useState(1);
  const [premium, setPremium] = useState<string>("");
  const plan = analysis.plan;
  const price = analysis.price;
  const entry = useMemo(() => (contract ? plannedEntry(contract, plan, price, decision?.lifecycle ?? null) : null), [contract, plan, price, decision?.lifecycle]);
  useEffect(() => { if (entry) setPremium(entry.premium.toFixed(2)); }, [contract?.symbol, entry?.estimated]); // eslint-disable-line react-hooks/exhaustive-deps
  const prem = Number(premium) > 0 ? Number(premium) : entry?.premium ?? contract?.mid ?? 0;
  const baseUnderlying = entry?.underlying ?? price;
  const favored = analysis.direction === "long" ? "call" : "put";
  const choices = useMemo(() => [...analysis.contracts].filter((c) => c.side === favored || c.symbol === contract?.symbol).slice(0, 40), [analysis.contracts, favored, contract?.symbol]);

  const scen = useMemo(() => {
    if (!contract || !plan || !baseUnderlying) return null;
    const inp = { side: contract.side, strike: contract.strike, expiry: contract.expiry, iv: contract.iv, currentMid: prem, underlyingNow: baseUnderlying };
    return {
      inv: scenarioPrice(inp, plan.invalidation, 60),
      t: plan.targets.map((t, i) => scenarioPrice(inp, t, 60 * (i + 1))),
    };
  }, [contract, plan, baseUnderlying, prem]);
  const evalRisk = useMemo(() => contract ? evaluateRisk({
    settings: risk, premium: prem, contracts: qty,
    valueAtInvalidation: scen?.inv.midEstimate ?? null,
    valuesAtTargets: scen ? scen.t.map((s) => s.midEstimate) : [],
    is0dte: contract.dte <= 1,
    openPositions: myTrade && myTrade.contract !== contract.symbol ? [{ premiumTotal: myTrade.entry * 100 * myTrade.qty, is0dte: true, correlated: true }] : [],
    realizedToday: 0, unrealizedToday: 0,
  }) : null, [contract, risk, prem, qty, scen, myTrade]);
  const fit = contract ? maxContractsWithinRisk(risk, prem, scen?.inv.midEstimate ?? null) : null;
  const thetaHr = contract?.theta !== null && contract?.theta !== undefined ? (Math.abs(contract.theta) * 100 * qty) / 6.5 : null;
  const vegaRisk = contract?.vega !== null && contract?.vega !== undefined ? contract.vega * 100 * qty * 10 : null;

  if (!contract) return <div className="p-4 text-sm text-ink-muted">Pick a contract from the chain (Plan) or the best-contract card to plan a trade.</div>;
  const blocked = evalRisk?.breaches.some((b) => b.blocking) ?? false;

  return (
    <div className="grid h-full gap-4 overflow-auto p-3 lg:grid-cols-[1.1fr_1fr_1fr]">
      {/* Plan */}
      <div>
        <div className="stat-label mb-1">Plan</div>
        <div className="rounded-md bg-bg-elevated/60 p-2.5">
          <div className="flex items-baseline justify-between">
            <span className="num text-md font-semibold">{contractLabel(contract.strike, contract.side, analysis.symbol)}</span>
            <span className="text-xs text-ink-muted">{expiryLabel(contract.expiry, contract.dte)}{contract.dte <= 0 ? " (0DTE)" : ""}</span>
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
            <label className="block"><span className="stat-label">Contract</span>
              <select value={contract.symbol} onChange={(e) => onPickContract(e.target.value)} className="select mt-0.5 w-full py-1 font-mono text-xs">
                {choices.map((c) => <option key={c.symbol} value={c.symbol}>{c.strike}{c.side === "call" ? "C" : "P"} {c.expiry.slice(5)} · {c.mid.toFixed(2)} · {c.score}{c.tag ? ` · ${c.tag}` : ""}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="stat-label" data-tip={entry?.estimated ? `Model estimate of the premium if ${analysis.symbol} reaches the trigger ${fmt$(entry.underlying)} within 30 minutes. Live mid now ${fmt$(contract.mid)}.` : "Live mid"}>{entry?.estimated ? "Premium (est. at trigger)" : "Premium"}</span><input value={premium} onChange={(e) => setPremium(e.target.value)} inputMode="decimal" className="input mt-0.5 w-full py-1 font-mono text-xs" /></label>
              <label className="block"><span className="stat-label">Contracts</span><input type="number" min={1} max={100} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} className="input mt-0.5 w-full py-1 font-mono text-xs" /></label>
            </div>
          </div>
          <div className="mt-2 space-y-0">
            <KV k="Direction" v={analysis.direction === "long" ? "CALLS (long)" : "PUTS (short)"} tone={analysis.direction === "long" ? "bull" : "bear"} />
            <KV k="Setup" v={decision?.setup ?? "—"} />
            <KV k="Entry trigger" v={plan ? fmt$(plan.trigger) : "—"} />
            <KV k="Confirmation" v={decision ? decision.confirmation.map((c) => c.text).join(" · ") : "—"} tone="muted" />
            <KV k="Invalidation" v={plan ? fmt$(plan.invalidation) : "—"} tone="bear" />
            {plan?.targets.map((t, i) => <KV key={i} k={`Target ${i + 1}`} v={fmt$(t)} tone="brand" />)}
            <KV k="Premium x contracts" v={`${fmt$(prem)} x ${qty} = ${fmt$(prem * 100 * qty, 0)}`} />
            {entry?.estimated && <div className="pt-1 text-2xs text-ink-faint">Entry assumed at the trigger {fmt$(entry.underlying)}, not the current print {fmt$(price)}. Scenarios start there.</div>}
          </div>
          {!myTrade || myTrade.contract !== contract.symbol ? (
            <button onClick={() => onRecord({ contract: contract.symbol, side: contract.side, strike: contract.strike, expiry: contract.expiry, entry: prem, qty })} className="btn-ghost btn-sm mt-2 text-mine">Record as my trade (manual)</button>
          ) : <div className="mt-2 text-xs text-mine">Recorded as your open trade.</div>}
        </div>
      </div>

      {/* Numbers */}
      <div>
        <div className="stat-label mb-1">Risk (deterministic)</div>
        <div className="rounded-md bg-bg-elevated/60 p-2.5">
          {evalRisk && (
            <>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                <Stat label="Max premium exposure" size="sm">{fmt$(evalRisk.exposureDollars, 0)}{evalRisk.exposurePct !== null && <span className="ml-1 text-xs text-ink-faint">{evalRisk.exposurePct}%</span>}</Stat>
                <Stat label="Allowed risk" size="sm" tone={evalRisk.allowedRiskDollars === null ? "faint" : "ink"}>{evalRisk.allowedRiskDollars !== null ? fmt$(evalRisk.allowedRiskDollars, 0) : "not set"}</Stat>
                <Stat label="Est. loss at invalidation" size="sm" tone="bear">{evalRisk.lossAtInvalidation !== null ? `-${fmt$(evalRisk.lossAtInvalidation, 0)}` : "—"}</Stat>
                <Stat label="Risk / reward (T1)" size="sm" tone={evalRisk.riskReward === null ? "faint" : evalRisk.riskReward >= 2 ? "bull" : evalRisk.riskReward >= 1 ? "warn" : "bear"}>{evalRisk.riskReward !== null ? `${evalRisk.riskReward}R` : "—"}</Stat>
                {evalRisk.rewardAtTargets.map((r, i) => <Stat key={i} label={`Return at T${i + 1}`} size="sm" tone={signTone(r)}>{r !== null ? `${fmtPnl(r)} (${pct(prem > 0 ? (r / (prem * 100 * qty)) * 100 : null, 0)})` : "—"}</Stat>)}
                <Stat label="Theta exposure" size="sm" tone="warn">{thetaHr !== null ? `-${fmt$(thetaHr, 0)}/hr` : "—"}</Stat>
                <Stat label="IV risk (10 pts)" size="sm" tone="muted" hint="Premium change if implied volatility moves 10 points">{vegaRisk !== null ? `±${fmt$(vegaRisk, 0)}` : "—"}</Stat>
                <Stat label="Fits the limit" size="sm" tone={fit === null ? "faint" : fit >= qty ? "bull" : "bear"}>{fit === null ? "set account" : `${fit} contract${fit === 1 ? "" : "s"}`}</Stat>
                <Stat label="Daily loss left" size="sm" tone="muted">{evalRisk.dailyLossRemaining !== null ? fmt$(evalRisk.dailyLossRemaining, 0) : "—"}</Stat>
              </div>
              {evalRisk.breaches.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs">
                  {evalRisk.breaches.map((b) => (
                    <li key={b.key} className={`flex items-start gap-1.5 ${b.blocking ? "text-bear" : "text-warn"}`}>
                      <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${b.blocking ? "bg-bear" : "bg-warn"}`} />{b.blocking ? "WARNING: " : ""}{b.message}
                    </li>
                  ))}
                </ul>
              )}
              {blocked && <div className="mt-1 text-xs font-semibold text-bear">This position exceeds configured risk.</div>}
            </>
          )}
        </div>
        <Disclosure title="Risk limits" defaultOpen={risk.accountSize === null}>
          <RiskForm risk={risk} setRisk={setRisk} />
        </Disclosure>
      </div>

      {/* Scenarios */}
      <div>
        <div className="stat-label mb-1">Scenarios (model estimates)</div>
        <div className="space-y-2">
          {scen && plan ? (
            <>
              <ScenarioCard title="Invalidation case" tone="bear" stock={plan.invalidation} option={scen.inv.midEstimate} range={[scen.inv.low, scen.inv.high]} prem={prem} qty={qty} note="5m close through the wrong line; exit here" />
              <ScenarioCard title="Normal target" tone="brand" stock={plan.targets[0]} option={scen.t[0].midEstimate} range={[scen.t[0].low, scen.t[0].high]} prem={prem} qty={qty} note="Target 1 within about an hour" />
              <ScenarioCard title="Best case" tone="bull" stock={plan.targets[2]} option={scen.t[2].midEstimate} range={[scen.t[2].low, scen.t[2].high]} prem={prem} qty={qty} note="Target 3 within the session" />
            </>
          ) : (
            <div className="rounded-md bg-bg-elevated/60 p-2.5 text-xs text-ink-muted">No plan levels for this symbol yet, so scenarios cannot be estimated.</div>
          )}
          <div className="text-2xs text-ink-faint">Ranges span IV ±10%. Options can lose their entire premium. Nothing is placed anywhere from this screen.</div>
        </div>
      </div>
    </div>
  );
}

function ScenarioCard({ title, tone, stock, option, range, prem, qty, note }: { title: string; tone: Tone; stock: number; option: number; range: [number, number]; prem: number; qty: number; note: string }) {
  const pnl = (option - prem) * 100 * qty;
  return (
    <div className="rounded-md bg-bg-elevated/60 p-2.5">
      <div className="flex items-center justify-between">
        <span className={`text-xs font-semibold uppercase tracking-[0.08em] ${TONE_TEXT[tone]}`}>{title}</span>
        <Chip tone={signTone(pnl)}>{fmtPnl(pnl)}</Chip>
      </div>
      <div className="mt-1 grid grid-cols-3 gap-x-2">
        <Stat label="Stock at" size="sm">{fmt$(stock)}</Stat>
        <Stat label="Option est." size="sm">{fmt$(option)}</Stat>
        <Stat label="Range" size="sm" tone="muted">{fmt$(range[0])}–{fmt$(range[1])}</Stat>
      </div>
      <div className="mt-1 text-2xs text-ink-faint">{note}</div>
    </div>
  );
}

function RiskForm({ risk, setRisk }: { risk: RiskSettings; setRisk: (s: RiskSettings) => void }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const val = (k: keyof RiskSettings) => draft[k] ?? (risk[k] === null ? "" : String(risk[k]));
  const commit = () => {
    const next: RiskSettings = { ...risk };
    for (const [k, v] of Object.entries(draft)) {
      const n = Number(v);
      (next as unknown as Record<string, number | null>)[k] = k === "accountSize" ? (n > 0 ? n : null) : (Number.isFinite(n) ? n : (risk as unknown as Record<string, number>)[k]);
    }
    setRisk(next);
    saveRiskSettings(next);
    setDraft({});
  };
  const field = (k: keyof RiskSettings, label: string, hint: string, step = "1") => (
    <label className="block" key={k}>
      <span className="stat-label" data-tip={hint}>{label}</span>
      <input value={val(k)} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} inputMode="decimal" step={step} className="input mt-0.5 w-full py-1 font-mono text-xs" placeholder={k === "accountSize" ? "10000" : ""} />
    </label>
  );
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {field("accountSize", "Account size $", "Your options trading account value. Risk rules are checked against this.")}
        {field("maxRiskPct", "Max risk / trade %", "Largest estimated loss allowed on one trade, as a percent of the account.", "0.1")}
        {field("maxDailyLossPct", "Max daily loss %", "Stop for the day once realized plus unrealized losses reach this.", "0.1")}
        {field("maxContracts", "Max contracts", "Largest position size in contracts.")}
        {field("max0dtePct", "Max 0DTE allocation %", "Premium tied up in same-day expiries, as a percent of the account.", "0.1")}
        {field("maxSimultaneous", "Max open trades", "How many positions may be open at once.")}
        {field("maxCorrelatedPct", "Max correlated %", "Premium across correlated names (same index or sector).", "0.1")}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button onClick={commit} className="btn-primary btn-sm" disabled={Object.keys(draft).length === 0}>Save limits</button>
        <span className="text-2xs text-ink-faint">Saved on this device. Rules are deterministic; no score overrides them.</span>
      </div>
    </div>
  );
}
