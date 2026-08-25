"use client";

// Position size calculator (spec §41). Live client-side math with the
// same pure function the server uses, so results can't drift.

import { useMemo, useState } from "react";
import { AlertTriangle, Calculator } from "lucide-react";
import { RISK_DISCLAIMER, calculateRisk } from "@/lib/risk";

export default function RiskCalculator({
  defaultEntry,
  defaultStop,
  defaultTarget,
  accountSize = 25000,
  maxRiskPct = 0.5,
}: {
  defaultEntry?: number;
  defaultStop?: number;
  defaultTarget?: number;
  accountSize?: number;
  maxRiskPct?: number;
}) {
  const [account, setAccount] = useState(String(accountSize));
  const [riskPct, setRiskPct] = useState(String(maxRiskPct));
  const [entry, setEntry] = useState(defaultEntry ? String(defaultEntry) : "");
  const [stop, setStop] = useState(defaultStop ? String(defaultStop) : "");
  const [target, setTarget] = useState(defaultTarget ? String(defaultTarget) : "");

  const result = useMemo(
    () =>
      calculateRisk({
        accountSize: Number(account) || 0,
        maxRiskPct: Number(riskPct) || 0,
        entry: Number(entry) || 0,
        stop: Number(stop) || 0,
        target: target ? Number(target) : undefined,
      }),
    [account, riskPct, entry, stop, target]
  );

  const inputs: { label: string; value: string; set: (v: string) => void; step?: string }[] = [
    { label: "Account $", value: account, set: setAccount, step: "100" },
    { label: "Risk %", value: riskPct, set: setRiskPct, step: "0.05" },
    { label: "Entry", value: entry, set: setEntry, step: "0.01" },
    { label: "Stop", value: stop, set: setStop, step: "0.01" },
    { label: "Target", value: target, set: setTarget, step: "0.01" },
  ];

  return (
    <div>
      <div className="flex items-center gap-1 bg-bg-card px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
        <Calculator size={11} /> Position Size
      </div>

      <div className="grid grid-cols-5 gap-1 px-2 py-1.5">
        {inputs.map((f) => (
          <label key={f.label} className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-wide text-ink-faint">{f.label}</span>
            <input
              type="number"
              step={f.step}
              value={f.value}
              onChange={(e) => f.set(e.target.value)}
              className="w-full rounded border border-border bg-bg-elevated px-1 py-0.5 text-right font-mono text-[11px] outline-none focus:border-brand"
            />
          </label>
        ))}
      </div>

      {result.error ? (
        <div className="px-2 pb-2 text-[11px] text-ink-faint">{result.error}</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-x-3 border-t border-border px-2 py-1.5">
            <Cell label="Shares" value={result.shares.toLocaleString()} strong />
            <Cell label="Risk Budget" value={`$${result.riskBudget.toFixed(2)}`} />
            <Cell label="Risk / Share" value={`$${result.riskPerShare.toFixed(2)}`} />
            <Cell label="Position" value={`$${result.positionValue.toLocaleString()}`} />
            <Cell label="% of Acct" value={`${result.positionPctOfAccount.toFixed(1)}%`} />
            <Cell label="Max Loss" value={`-$${result.maxLoss.toFixed(2)}`} tone="bear" />
            <Cell
              label="Potential Gain"
              value={result.potentialGain !== null ? `+$${result.potentialGain.toFixed(2)}` : "—"}
              tone="bull"
            />
            <Cell label="R/R" value={result.riskReward !== null ? `${result.riskReward.toFixed(2)}:1` : "—"} />
            <Cell label="Stop Distance" value={`${result.stopDistancePct.toFixed(2)}%`} />
          </div>

          {result.maxLoss < result.riskBudget - 0.005 && (
            <div className="border-t border-border px-2 py-1 text-[10px] leading-snug text-ink-faint">
              Max loss (${result.maxLoss.toFixed(2)}) is under your ${result.riskBudget.toFixed(2)} budget
              because shares round down to whole numbers: the budget allows{" "}
              {(result.riskBudget / result.riskPerShare).toFixed(2)} shares, so you get {result.shares.toLocaleString()}.
            </div>
          )}

          {result.warnings.length > 0 && (
            <div className="space-y-1 border-t border-warn/20 bg-warn/5 px-2 py-1.5">
              {result.warnings.map((w, i) => (
                <div key={i} className="flex gap-1.5 text-[10px] leading-snug text-warn">
                  <AlertTriangle size={10} className="mt-0.5 shrink-0" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <p className="border-t border-border px-2 py-1 text-[9px] leading-snug text-ink-faint">
        {RISK_DISCLAIMER}
      </p>
    </div>
  );
}

function Cell({ label, value, tone, strong }: { label: string; value: string; tone?: "bull" | "bear"; strong?: boolean }) {
  const cls = tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-ink";
  return (
    <div className="py-0.5">
      <div className="text-[9px] uppercase tracking-wide text-ink-faint">{label}</div>
      <div className={`font-mono ${strong ? "text-[15px] font-bold" : "text-[12px]"} ${cls}`}>{value}</div>
    </div>
  );
}
