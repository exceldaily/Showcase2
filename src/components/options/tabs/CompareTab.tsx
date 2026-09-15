"use client";

// Up to four contracts side by side, with estimated values at each
// plan target (model ranges, IV +/-10%).

import type { OptionsAnalysis, RankedContract } from "@/lib/optionsTerminal";
import { scenarioPrice } from "@/lib/optionsMath";
import { fmt$, fmtInt } from "@/lib/ui/format";

export default function CompareTab({ analysis, contracts }: { analysis: OptionsAnalysis; contracts: RankedContract[] }) {
  if (contracts.length === 0) {
    return <div className="p-4 text-xs text-ink-muted">Tick contracts in the chain to compare up to four side by side.</div>;
  }
  const targets = analysis.plan?.targets ?? [];
  const scenarioFor = (c: RankedContract, target: number) =>
    scenarioPrice({ side: c.side, strike: c.strike, expiry: c.expiry, iv: c.iv, currentMid: c.mid, underlyingNow: analysis.price ?? 0 }, target, 60);
  const rows: { label: string; get: (c: RankedContract) => string }[] = [
    { label: "Mid", get: (c) => fmt$(c.mid) },
    { label: "Per contract", get: (c) => fmt$(c.mid * 100, 0) },
    { label: "Spread", get: (c) => (c.spreadPct !== null ? `${c.spreadPct}%` : "—") },
    { label: "Delta", get: (c) => String(c.delta ?? "—") },
    { label: "Gamma", get: (c) => String(c.gamma ?? "—") },
    { label: "Theta", get: (c) => String(c.theta ?? "—") },
    { label: "IV", get: (c) => (c.iv !== null ? `${(c.iv * 100).toFixed(0)}%` : "—") },
    { label: "Volume", get: (c) => fmtInt(c.volume) },
    { label: "OI", get: (c) => fmtInt(c.openInterest) },
    { label: "Intr / Extr", get: (c) => `${c.intrinsic.toFixed(2)} / ${c.extrinsic.toFixed(2)}` },
    { label: "Break-even", get: (c) => fmt$(c.breakEven) },
    ...targets.map((t, i) => ({
      label: `Est at T${i + 1} ${fmt$(t)}`,
      get: (c: RankedContract) => {
        const s = scenarioFor(c, t);
        const ret = c.mid > 0 ? ` (${s.midEstimate >= c.mid ? "+" : ""}${(((s.midEstimate - c.mid) / c.mid) * 100).toFixed(0)}%)` : "";
        return `${fmt$(s.low)}–${fmt$(s.high)}${ret}`;
      },
    })),
    { label: "Score", get: (c) => `${c.score}/100` },
  ];
  const bestScore = Math.max(...contracts.map((c) => c.score));
  return (
    <div className="h-full overflow-auto p-2">
      <table className="tbl w-auto">
        <thead>
          <tr>
            <th>Contract</th>
            {contracts.map((c) => (
              <th key={c.symbol} className={`!text-sm !normal-case !tracking-normal ${c.score === bestScore ? "!text-brand-glow" : "!text-ink"}`}>
                <span className="num">{c.strike}{c.side === "call" ? "C" : "P"} {c.expiry.slice(5)}</span>
                {c.score === bestScore && <span className="ml-1 text-2xs uppercase text-brand-glow">best</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="text-ink-faint">{r.label}</td>
              {contracts.map((c) => (
                <td key={c.symbol} className="num text-ink-muted">{r.get(c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-2xs text-ink-faint">Target estimates are model ranges (IV ±10%), not guarantees.</p>
    </div>
  );
}
